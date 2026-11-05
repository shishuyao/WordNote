<#
  守护进程：常驻循环，每 5 分钟巡检一次（计划任务在登录时拉起它）。
  巡检三件事：
    1) Wordnote /api/health 是否正常
    2) Supertonic(8090) 端口是否在听
    3) Supertonic watchdog 进程是否活着
  任何一项异常才调用 start-all.ps1（避免无谓重启）。

  手动跑一次（调试用）：
    powershell -ExecutionPolicy Bypass -File scripts\guard.ps1 -Once
#>
param([switch]$Once)

$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "guard.log"

function Log([string]$msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg) -Encoding UTF8
}

function Get-AppOk {
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8100/api/health" -TimeoutSec 6
    return [bool]$h.ok
  } catch { return $false }
}

function Get-TtsOk {
  return [bool](Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue)
}

function Get-WatchdogOk {
  return [bool](Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*supertonic*watchdog.py*" })
}

# 单实例：已有别的 guard 在跑就直接退出（-Once 手动测试除外）
if (-not $Once) {
  $self = $PID
  $others = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $self -and
      $_.CommandLine -like "*guard.ps1*" -and
      $_.CommandLine -notlike "*-Once*"
    }
  if ($others) { exit 0 }
}
Log "guard 启动（每 5 分钟巡检）"
while ($true) {
  $appOk = Get-AppOk
  $ttsOk = Get-TtsOk
  $watchdogOk = Get-WatchdogOk

  if (-not $appOk -or -not $ttsOk -or -not $watchdogOk) {
    Log ("异常：app=$appOk tts=$ttsOk watchdog=$watchdogOk → 调 start-all.ps1")
    & (Join-Path $PSScriptRoot "start-all.ps1") | Out-Null
    try {
      $h = Invoke-RestMethod -Uri "http://127.0.0.1:8100/api/health" -TimeoutSec 8
      Log ("修复后：ok=" + $h.ok + " tts=" + $h.tts.alive + " model=" + $h.tts.model_loaded)
    } catch {
      Log ("修复失败：" + $_.Exception.Message)
    }
  }

  foreach ($f in @($log, (Join-Path $logDir "start-all.log"))) {
    if ((Test-Path $f) -and ((Get-Item $f).Length -gt 2MB)) {
      $tail = Get-Content $f -Tail 800
      Set-Content -Path $f -Value $tail -Encoding UTF8
    }
  }

  if ($Once) { break }
  Start-Sleep -Seconds 300
}