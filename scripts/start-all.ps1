<#
  一键启动 / 守护（Windows）。
    1) 确保 Supertonic 3（audiocpp，默认 127.0.0.1:8090）在跑并加载模型
    2) 确保 Supertonic 的看护进程（可选）在跑
    3) 确保 Wordnote 后端（0.0.0.0:8100）在跑
  已在跑的服务不会重复启动；日志写到 data/logs/。

  发音相关路径从 data/local.json（参考 local.example.json）读取，也可用环境变量
  ST_EXE / ST_CLI / ST_MODEL_PATH / ST_WATCHDOG / ST_WATCHDOG_PY 覆盖。
  没配置 Supertonic 时只影响"发音"，其它功能照常。
#>
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$serverDir = Join-Path $root "server"
$logDir = Join-Path $root "data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$webPort = if ($env:WORDNOTE_PORT) { [int]$env:WORDNOTE_PORT } else { 8100 }
$ttsPort = 8090

# ---------- 读本机配置 ----------
$localCfg = @{}
$localPath = Join-Path $root "data\local.json"
if (Test-Path $localPath) {
  try {
    $cfg = Get-Content $localPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfg.speech) { $localCfg = $cfg.speech }
  } catch {
    Write-Host "data/local.json 解析失败，按环境变量/默认值启动"
  }
}

function Pick([string]$envName, [string]$cfgKey) {
  if ($envName -and (Get-Item "Env:\$envName" -ErrorAction SilentlyContinue)) { return (Get-Item "Env:\$envName").Value }
  if ($cfgKey -and $localCfg.PSObject.Properties.Name -contains $cfgKey) { return $localCfg.$cfgKey }
  return ""
}

$audiocppExe = Pick "ST_EXE" "server"
$audiocppCli = Pick "ST_CLI" "cli"
$audiocppModel = Pick "ST_MODEL_PATH" "model_path"
$watchdogScript = Pick "ST_WATCHDOG" "watchdog"
$watchdogPython = Pick "ST_WATCHDOG_PY" "watchdog_python"

function Test-Listening([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Get-LanIp {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -notlike "100.*" } |
    Select-Object -First 1).IPAddress
  if ($ip) { return $ip } else { return "127.0.0.1" }
}

function Write-Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path (Join-Path $logDir "start-all.log") -Value $line -Encoding UTF8
  Write-Host $line
}

# ---------- Supertonic 3 ----------
if (Test-Listening $ttsPort) {
  Write-Log "audiocpp 已在监听 $ttsPort，跳过启动"
} elseif ($audiocppExe -and (Test-Path $audiocppExe)) {
  Write-Log "启动 audiocpp: $audiocppExe"
  Start-Process -FilePath $audiocppExe -WindowStyle Hidden `
    -WorkingDirectory (Split-Path -Parent $audiocppExe) `
    -ArgumentList @("--ui", "--backend", "cpu", "--host", "127.0.0.1", "--port", "$ttsPort", "--threads", "8", "--ui-management")
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Listening $ttsPort) { break }
  }
} else {
  Write-Log "未配置 Supertonic（data/local.json 的 speech.server 为空），跳过；发音功能不可用，其它正常"
}

if ((Test-Listening $ttsPort) -and $audiocppModel) {
  try {
    $models = Invoke-RestMethod -Uri "http://127.0.0.1:$ttsPort/v1/models" -TimeoutSec 5
    if (-not ($models.data | Where-Object { $_.id -eq "supertonic" })) {
      $body = @{
        id      = "supertonic"
        path    = $audiocppModel.Replace("\", "/")
        family  = "supertonic"
        backend = "cpu"
      } | ConvertTo-Json
      Invoke-RestMethod -Uri "http://127.0.0.1:$ttsPort/v1/models/load" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 180 | Out-Null
      Write-Log "Supertonic 模型已加载"
    } else {
      Write-Log "Supertonic 模型已在内存中"
    }
  } catch {
    Write-Log ("加载 Supertonic 模型失败: " + $_.Exception.Message)
  }
}

# ---------- Supertonic watchdog（可选） ----------
$watchdogRunning = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*watchdog.py*" }
if ($watchdogRunning) {
  Write-Log "Supertonic watchdog 已在运行（PID $($watchdogRunning[0].ProcessId)）"
} elseif ($watchdogScript -and $watchdogPython -and (Test-Path $watchdogScript) -and (Test-Path $watchdogPython)) {
  Write-Log "启动 Supertonic watchdog: $watchdogScript"
  Start-Process -FilePath $watchdogPython -WindowStyle Hidden -ArgumentList @($watchdogScript)
} else {
  Write-Log "未配置 watchdog（可忽略）"
}

# ---------- Wordnote ----------
if (Test-Listening $webPort) {
  Write-Log "Wordnote 已在监听 $webPort，跳过启动"
} else {
  if (-not (Test-Path $venvPython)) { Write-Log "找不到 venv Python：$venvPython（先跑一次 uv venv + uv pip install）"; exit 1 }
  Write-Log "启动 Wordnote（python -m uvicorn app.main:app --port $webPort）"
  Start-Process -FilePath $venvPython -WindowStyle Hidden `
    -WorkingDirectory $serverDir `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "$webPort") `
    -RedirectStandardOutput (Join-Path $logDir "wordnote.out.log") `
    -RedirectStandardError (Join-Path $logDir "wordnote.err.log")
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $h = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/api/health" -TimeoutSec 3
      if ($h.ok) { break }
    } catch { }
  }
}

try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/api/health" -TimeoutSec 5
  Write-Log ("Wordnote 正常：version=" + $h.version + " tts_alive=" + $h.tts.alive + " model_loaded=" + $h.tts.model_loaded)
  Write-Log ("本机访问 http://127.0.0.1:$webPort    局域网 http://" + (Get-LanIp) + ":$webPort")
} catch {
  Write-Log ("Wordnote 健康检查失败：" + $_.Exception.Message)
  exit 1
}