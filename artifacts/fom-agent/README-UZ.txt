PHARMEX FOM Agent — IFOR PHARMA
================================

Bu dastur F-APTEKA o'rnatilgan APTEKA KOMPYUTERIGA qo'yiladi.
U lokal REPORT.exe (http://127.0.0.1:8084) dan savdo, kirim, qoldiq va
boshqa hisobotlarni o'qiydi va https://pharmex-navy.vercel.app ga yuboradi.

TALABLAR
--------
1. Windows 10/11 (PowerShell)
2. SERVICEREPORTS / REPORT.exe — FOM GROUP 8084 portda o'rnatadi
   Tekshiruv: brauzerda http://127.0.0.1:8084 ochilishi kerak
3. Internet

O'RNATISH (apteka kompyuterida)
-------------------------------
1. Ushbu papkani flashka / Telegram orqali apteka kompyuteriga nusxalang
2. start.bat ni ikki marta bosing — birinchi sinov
   YOKI install.ps1 ni Administrator sifatida ishga tushiring (avto-start)
3. config.ini da TOKEN = Vercel dagi FOM_SITE_TOKEN bilan bir xil

Agar REPORT.exe hali yo'q bo'lsa, agent xato yozadi va keyinroq qayta urinadi.
FOM texnigi REPORT.exe ni o'rnatgan zahoti ma'lumot o'zi keladi.

config.ini
----------
[CLOUD]
URL=https://pharmex-navy.vercel.app
TOKEN=v-D6bFpxGK-UJLpu2oFR8MUBwrmlfNck

[FOM]
REPORT_URL=http://127.0.0.1:8084
FILIAL_IDS=1
INITIAL_DAYS=90
INTERVAL_MIN=5

IFOR PHARMA · FOM_ID 16372 · INN 309431812
