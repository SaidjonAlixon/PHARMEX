# PHARMEX FOM Agent — o'rnatish (Administrator sifatida ishga tushiring)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = "C:\PHARMEX-FOM-Agent"

Write-Host "PHARMEX FOM Agent o'rnatilmoqda → $dest" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $dest | Out-Null

foreach ($name in @(
  "PHARMEX-FOM-Agent.ps1",
  "agent.mjs",
  "config.example.ini",
  "config.ini",
  "start.bat",
  "README-UZ.txt"
)) {
  $src = Join-Path $here $name
  if (Test-Path $src) { Copy-Item $src (Join-Path $dest $name) -Force }
}
if (-not (Test-Path (Join-Path $dest "config.ini"))) {
  Copy-Item (Join-Path $dest "config.example.ini") (Join-Path $dest "config.ini") -Force
}

$ps1 = Join-Path $dest "PHARMEX-FOM-Agent.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "PHARMEX-FOM-Agent" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host ""
Write-Host "Tayyor." -ForegroundColor Green
Write-Host "1) $dest\config.ini — TOKEN ni tekshiring"
Write-Host "2) REPORT.exe (8084) FOM texnigi o'rnatishi kerak"
Write-Host "3) start.bat ni ishga tushiring yoki kompyuterni qayta yoqing"
Write-Host ""
Start-Process notepad (Join-Path $dest "config.ini")
