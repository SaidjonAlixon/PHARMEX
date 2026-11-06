@echo off
chcp 65001 >nul
rem Kompyuter yoqilganda agent oynasiz (trayda) o'zi ishga tushadi
set "EXE=%~dp0PHARMEX-FOM-Agent.exe"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\PHARMEX FOM Agent.lnk'); $s.TargetPath='%EXE%'; $s.Arguments='--hidden'; $s.WorkingDirectory='%~dp0'; $s.Save()"
echo.
echo Tayyor: kompyuter yoqilganda PHARMEX FOM Agent o'zi ishga tushadi.
echo O'chirish: Win+R -^> shell:startup -^> "PHARMEX FOM Agent" ni o'chiring.
pause
