<#
  状态检查（只读）：两个服务的端口 / 健康 / 模型 / 数据规模
#>
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
$db = Join-Path $root "data\wordnote.db"
$audio = Join-Path $root "data\audio"

function Show-Port([string]$name, [int]$port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($c) {
    $p = Get-Process -Id $c[0].OwningProcess -ErrorAction SilentlyContinue
    "{0,-12} {1,5}  监听中 (PID {2}, {3})" -f $name, $port, $c[0].OwningProcess, $p.ProcessName
  } else {
    "{0,-12} {1,5}  未监听" -f $name, $port
  }
}

Show-Port "Wordnote" 8100
Show-Port "Supertonic" 8090

try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:8100/api/health" -TimeoutSec 5
  Write-Host ("健康检查    {0}" -f $(if ($h.ok) { "正常 · app " + $h.app + " " + $h.version } else { "异常" }))
  Write-Host ("发音服务    alive={0} model_loaded={1}" -f $h.tts.alive, $h.tts.model_loaded)
} catch {
  Write-Host "健康检查    失败（服务未启动？跑 scripts\start-all.ps1）"
}

if (Test-Path $db) {
  $size = [math]::Round((Get-Item $db).Length / 1MB, 2)
  Write-Host ("数据库      {0}  ({1} MB)" -f $db, $size)
}
if (Test-Path $audio) {
  $files = Get-ChildItem $audio -Filter *.wav -ErrorAction SilentlyContinue
  $mb = [math]::Round((($files | Measure-Object Length -Sum).Sum) / 1MB, 1)
  Write-Host ("音频缓存    {0} 个 / {1} MB" -f $files.Count, $mb)
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -notlike "100.*" } | Select-Object -First 1).IPAddress
Write-Host ""
Write-Host ("本机访问    http://127.0.0.1:8100") -ForegroundColor Green
if ($ip) { Write-Host ("局域网访问  http://{0}:8100" -f $ip) -ForegroundColor Green }
Write-Host ""
Get-ScheduledTask -TaskName "Wordnote-*" -ErrorAction SilentlyContinue |
  Select-Object TaskName, State | Format-Table -AutoSize
