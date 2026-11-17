#Requires -RunAsAdministrator
<#
  FOM PC da ishga tushiring (Admin).
  Buzilgan @@AGENT_PORT@@ worker ni o'chirib, Sozlamalar .bat kabi qayta ulaydi.
#>
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Platform = "https://pharmxs.uz"
$InstallDir = Join-Path $env:ProgramData "PHARMXS"
$TokenFile = Join-Path $InstallDir "agent.token"

Write-Host "=== PHARMXS agent ta'mirlash ===" -ForegroundColor Cyan
Get-CimInstance Win32_Process -EA SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -like '*fom-agent-worker*' -or $_.CommandLine -like '*fom-worker*' -or $_.CommandLine -like '*fom-first-run*') } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue } catch {} }

foreach ($name in @('fom-agent-worker.ps1','fom-worker.ps1')) {
  $p = Join-Path $InstallDir $name
  if (Test-Path $p) {
    Remove-Item $p -Force -EA SilentlyContinue
    Write-Host "O'chirildi: $p" -ForegroundColor Yellow
  }
}

if (-not (Test-Path $TokenFile)) {
  Write-Host "Token yo'q. Sozlamalar → FOM → .bat ni qayta yuklab Admin oching." -ForegroundColor Red
  exit 1
}

$batUrl = "$Platform/api/fom/agent/install.bat"
$batPath = Join-Path $env:TEMP "pharmxs-fom-repair.bat"
Invoke-WebRequest -Uri $batUrl -OutFile $batPath -UseBasicParsing
Write-Host "Yuklandi: $batPath" -ForegroundColor Green
Write-Host "MUHIM: REPORT.exe (http://127.0.0.1:8084) ishlayotgan bo'lsin." -ForegroundColor Yellow
Write-Host "Endi .bat Admin ochiladi — agent v10: 8084 bort + ServiceReports.ini orqali cheklar." -ForegroundColor Cyan
Start-Process -FilePath $batPath -Verb RunAs
