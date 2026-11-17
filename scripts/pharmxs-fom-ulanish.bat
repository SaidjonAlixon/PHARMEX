@echo off
setlocal EnableExtensions
title PHARMXS FOM ulanish (VPN siz)
cd /d "%~dp0"

net session >nul 2>&1
if not "%errorLevel%"=="0" (
  echo Admin huquq so'ralmoqda...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo === PHARMXS: lokal REPORT → pharmxs.uz ===
echo REPORT.exe / SERVICEREPORTS (8084) yoqilgan bo'lsin.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fom-first-run.ps1"
set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" (
  echo [X] Xato kodi: %ERR%
) else (
  echo [OK] Tayyor. Sozlamalar sahifasida foizni kuzating.
)
pause
endlocal
