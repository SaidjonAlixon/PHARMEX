# PHARMEX — Dorixona moliyaviy boshqaruvi

Dorixonalar tarmogʻi uchun savdo, kassa, zaxira, qarz va foyda-zarar hisobi; FOM GROUP (F-APTEKA) bilan integratsiya.

## Ishga tushirish

- `pnpm install` — bogʻliqliklar
- `pnpm --filter @workspace/api-server run build` va `run start` — API server (`.env` dagi `PORT`)
- `pnpm --filter @workspace/dorixona-moliya run dev` — veb ilova (Vite, `WEB_PORT`)
- `pnpm run typecheck` — barcha paketlarni tekshirish
- `pnpm --filter @workspace/api-spec run codegen` — OpenAPI dan API hook va Zod sxemalarini qayta yaratish
- `node scripts/vercel-build.mjs` — Vercel uchun `.vercel/output` (statik sayt + `/api` funksiyasi)

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
- Vercel da FOM REPORT.exe avtomatik sinxronizatsiyasi ishlamaydi (doimiy jarayon yoʻq); uni lokal API server bajaradi.
