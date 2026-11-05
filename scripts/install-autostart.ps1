<#
  注册开机自启（两个计划任务，均为用户登录时启动、无时间限制）：
  - Wordnote-Start：静默启动 Supertonic + watchdog + Wordnote（幂等，已在跑就跳过）
  - Wordnote-Guard：常驻守护循环，每 5 分钟巡检，挂了自动拉起

  卸载：scripts\uninstall-autostart.ps1
  手动看状态：scripts\status.ps1
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot "start-all.ps1"
$guardScript = Join-Path $PSScriptRoot "guard.ps1"
$pwsh = (Get-Command powershell.exe).Source

function Register-Task([string]$name, [string]$script, [string]$desc) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue

  $action = New-ScheduledTaskAction -Execute $pwsh `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" `
    -WorkingDirectory $PSScriptRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Description $desc | Out-Null
  Write-Host "已注册计划任务：$name"
}

Register-Task "Wordnote-Start" $startScript "词笺 Wordnote 常驻服务（Supertonic 3 发音 + 摘抄复习）"
Register-Task "Wordnote-Guard" $guardScript "词笺 Wordnote 守护：每 5 分钟巡检并自动拉起"

Write-Host ""
Write-Host "现在先立即启动一次……"
& $startScript

Write-Host ""
Write-Host "计划任务："
Get-ScheduledTask -TaskName "Wordnote-*" | Select-Object TaskName, State | Format-Table -AutoSize
Write-Host "本机访问   http://127.0.0.1:8100"
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -notlike "100.*" } | Select-Object -First 1).IPAddress
if ($lanIp) { Write-Host "局域网访问 http://${lanIp}:8100" }