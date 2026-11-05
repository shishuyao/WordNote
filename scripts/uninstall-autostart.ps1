<# 卸载自启：删除两个计划任务（不会停掉正在跑的服务） #>
$ErrorActionPreference = "SilentlyContinue"
foreach ($name in @("Wordnote-Start", "Wordnote-Guard")) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  Write-Host "已删除计划任务：$name"
}
Write-Host "正在运行的服务未受影响；要停服务请手动结束 python.exe / audiocpp_server.exe。"