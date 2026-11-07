# PHARMEX — Dorixona moliyaviy boshqaruvi

Dorixonalar tarmogʻi uchun savdo, kassa, zaxira, qarz va foyda-zarar hisobi; FOM GROUP (F-APTEKA) bilan integratsiya.

## Ishga tushirish

- `pnpm install` — bogʻliqliklar
- `pnpm --filter @workspace/api-server run build` va `run start` — API server (`.env` dagi `PORT`)
- `pnpm --filter @workspace/dorixona-moliya run dev` — veb ilova (Vite, `WEB_PORT`)
- `pnpm run typecheck` — barcha paketlarni tekshirish
- `pnpm --filter @workspace/api-spec run codegen` — OpenAPI dan API hook va Zod sxemalarini qayta yaratish

## Serverda (VPS) ishga tushirish

1. `pnpm install`
2. Ildizga `.env` qoʻying (`.env.example` dan). `PUBLIC_APP_URL` — saytning ochiq manzili; Google uchun redirect URI: `<PUBLIC_APP_URL>/api/auth/google/callback`.
3. `pnpm run build` — veb ilova (`artifacts/dorixona-moliya/dist/public`) va API (`artifacts/api-server/dist`).
4. `pnpm start` — bitta jarayon: API `/api` da, veb ilova qolgan manzillarda (`PORT`). Doimiy ishlashi uchun pm2 yoki systemd, HTTPS uchun oldiga nginx/Caddy qoʻying.

Sozlamalar namunasi: `.env.example`.

## Stek

- pnpm workspaces, Node.js 22+, TypeScript 5.9
- API: Express 5, PostgreSQL + Drizzle ORM, Zod
- Veb: React 19, Vite, wouter, TanStack Query
- Build: esbuild (API), Vite (veb)

## Muhim

- Railway bazasi boshqa ilova bilan umumiy. `drizzle-kit push` ishlatmang: u boshqa ilovaning `*_id_seq` larini oʻchirishga urinadi. SQL ni `drizzle-kit generate` bilan yarating va faqat `pharmacy_*` buyruqlarini qoʻllang.
- Lokal kirish (Clerk siz): API da `AUTH_MODE=local` + `SESSION_SECRET` (32+ belgi), veb ilovada `VITE_AUTH_MODE=local`. `ADMIN_USERNAME` / `ADMIN_PASSWORD` birinchi administratorni yaratadi (mavjud boʻlsa oʻzgartirilmaydi).
- Lokal rejimda veb ilova API ga Vite proxy orqali ulanadi: `API_PROXY_TARGET=http://localhost:8080`.
- FOM REPORT.exe avtomatik sinxronizatsiyasi API jarayoni ichida ishlaydi (`FOM_SYNC_INTERVAL_MIN`); server REPORT.exe manziliga tarmoq orqali yetishi kerak.
