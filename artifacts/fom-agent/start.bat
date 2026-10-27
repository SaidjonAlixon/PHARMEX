@echo off
cd /d "%~dp0"
if exist "PHARMEX-FOM-Agent.exe" (
  start "" "PHARMEX-FOM-Agent.exe"
) else if exist "dist\PHARMEX-FOM-Agent.exe" (
  start "" "dist\PHARMEX-FOM-Agent.exe"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PHARMEX-FOM-Agent.ps1"
  pause
)
