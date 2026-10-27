@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PHARMEX FOM Agent
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PHARMEX-FOM-Agent.ps1"
echo.
pause
