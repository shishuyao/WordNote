<# 停掉 Wordnote（可选：连同 Supertonic 一起停）
   venv 的 python.exe 会再拉起一个 base python 子进程，所以按命令行匹配杀，不按路径。
#>
param([switch]$All)

$ErrorActionPreference = "SilentlyContinue"

Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match "wordnote" -or $_.CommandLine -match "run\.py|app\.main:app" } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "已停止 Wordnote（PID $($_.ProcessId)）"
  }

if ($All) {
  Get-Process audiocpp_server | ForEach-Object {
    Stop-Process -Id $_.Id -Force
    Write-Host "已停止 audiocpp_server（PID $($_.Id)）"
  }
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like "*supertonic*watchdog.py*" } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force
      Write-Host "已停止 Supertonic watchdog（PID $($_.ProcessId)）"
    }
}

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like "*wordnote*guard.ps1*" -and $_.CommandLine -notlike "*stop-all*" } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force
    Write-Host "已停止 guard（PID $($_.ProcessId)）"
  }