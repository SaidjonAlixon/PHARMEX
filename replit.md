# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The Railway database is shared with another app. `drizzle-kit push` ignores `tablesFilter` for sequences and tries to drop the other app's `*_id_seq`; do not run `push` against it. Generate SQL with `drizzle-kit generate` and apply only `pharmacy_*` statements.
- Auth without Clerk: set `AUTH_MODE=local` + `SESSION_SECRET` (32+ chars) on the API and `VITE_AUTH_MODE=local` on the web app. `ADMIN_USERNAME` / `ADMIN_PASSWORD` create the first admin on startup if it doesn't exist (never overwritten).
- Locally the web app reaches the API through the Vite proxy: set `API_PROXY_TARGET=http://localhost:8080`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
