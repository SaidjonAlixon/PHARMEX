#Requires -RunAsAdministrator
# Eski nom — endi VPN/firewall ochish shart emas.
# To‘g‘ridan-to‘g‘ri birinchi ishga tushirish skriptiga o‘ting:
Write-Host "Radmin/VPN kerak emas. Ishlatng:" -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File .\fom-first-run.ps1" -ForegroundColor Green
& "$PSScriptRoot\fom-first-run.ps1" @args
