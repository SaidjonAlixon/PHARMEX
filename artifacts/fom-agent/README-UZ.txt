PHARMEX FOM Agent — QO'LLANMA (IFOR PHARMA)
============================================

Bu dastur apteka kompyuteridagi FOM (ServiceReports, port 8084) dan
BARCHA ma'lumotni tortib, https://pharmex-navy.vercel.app ga yuboradi:
  - tashkilotlar va filiallar
  - tovarlar
  - qoldiqlar
  - kirim, yetkazib beruvchiga qaytarish, hisobdan chiqarish
  - chakana va sug'urta savdolari


1. O'RNATISH (bir marta)
------------------------
1) Zip ni ServiceReports o'rnatilgan kompyuterga oching,
   masalan:  D:\PHARMEX-Agent\
2) PHARMEX-FOM-Agent.exe ni ikki marta bosing.
   Tugma bosish shart emas — o'zi ulanib, tortishni boshlaydi.
3) Avto-start.bat ni bir marta bosing — endi kompyuter yoqilganda
   agent o'zi (trayda, oynasiz) ishga tushadi.


2. NIMA BO'LADI
---------------
- Agent ServiceReports manzilini o'zi topadi
  (D:\ServiceReports\*.ini dagi Host=http://127.0.0.1:8084).
- Birinchi marta: oxirgi INITIAL_DAYS kun (config.ini, standart 365)
  to'liq tortiladi. Bu 10–40 daqiqa davom etishi mumkin — oynani yopmang
  (yopsangiz trayda ishlashda davom etadi).
- Keyin har 5 daqiqada: qoldiqlar + oxirgi 3 kunlik hujjatlar,
  har soatda tovarlar va tashkilotlar yangilanadi.
- Filiallar (pFilial_id) avtomatik topiladi.


3. TEKSHIRISH
-------------
- Oynada "Ulangan · oxirgi: HH:MM" — hammasi joyida.
- Saytda: Sozlamalar → FOM — "Maʼlumot kelyapti".
- Jurnal: agent.log (shu papkada).


4. MUAMMO BO'LSA
----------------
- "FOM eshigiga ulanib bo'lmadi" — ServiceReports xizmati to'xtagan.
  D:\ServiceReports\ServiceReports_Install.bat ni Administrator sifatida
  ishga tushiring yoki brauzerda http://127.0.0.1:8084 ni oching
  ("200 OK" chiqishi kerak).
- "PHARMEX: Invalid token" — config.ini dagi TOKEN noto'g'ri.
- Hammasini qaytadan to'liq tortish: full-sync-done.txt ni o'chirib,
  agentni qayta oching.
- Oynasiz bir marta tortish:  PHARMEX-FOM-Agent.exe --once


config.ini
----------
[CLOUD]   URL, TOKEN (Vercel dagi FOM_SITE_TOKEN; ODJX_ EMAS)
[FOM]     REPORT_URL=auto, INITIAL_DAYS=365, INTERVAL_MIN=5

IFOR PHARMA · FOM_ID 16372
