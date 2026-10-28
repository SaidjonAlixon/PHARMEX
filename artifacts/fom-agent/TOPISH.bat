@echo off
chcp 65001 >nul
echo === PHARMEX: FOM baza qidiruv ===
echo.
echo [1] REPORT / SITE / NServis jarayonlari:
tasklist | findstr /I "REPORT SITE NServis FAPTEKA SERVICEREPORT"
echo.
echo [2] MDF fayllar (C:\FAPTEKA):
dir /s /b C:\FAPTEKA\*.mdf 2>nul
dir /s /b D:\FAPTEKA\*.mdf 2>nul
echo.
echo [3] SQL Server xizmatlari:
sc query type= service state= all | findstr /I "SQL"
echo.
echo [4] Ochilgan portlar (8084, 28887, 1433):
netstat -ano | findstr ":8084 :28887 :1433 :18784"
echo.
echo Natijani agent.log bilan yuboring.
pause
