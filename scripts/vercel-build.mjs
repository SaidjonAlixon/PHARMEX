// Produces .vercel/output (Vercel Build Output API v3): the web app as static files and the
// whole Express API as one Node function at /api. Run from the repo root: node scripts/vercel-build.mjs
import { execSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".vercel", "output");
const web = path.join(root, "artifacts", "dorixona-moliya");
const api = path.join(root, "artifacts", "api-server");
const funcDir = path.join(out, "functions", "api.func");

const run = (command, cwd, env = {}) =>
  execSync(command, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

await rm(out, { recursive: true, force: true });

console.log("\n▶ Web app (vite build)");
run("pnpm exec vite build --config vite.config.ts", web, {
  NODE_ENV: "production",
  PORT: process.env.PORT || "5173",
  BASE_PATH: process.env.BASE_PATH || "/",
  VITE_AUTH_MODE: process.env.VITE_AUTH_MODE || "local",
});
await mkdir(out, { recursive: true });
await cp(path.join(web, "dist", "public"), path.join(out, "static"), { recursive: true });

console.log("\n▶ API function (esbuild)");
run(`node build.mjs --vercel "${funcDir}"`, api, { NODE_ENV: "production" });
await writeFile(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "vercel.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 60,
    },
    null,
    2,
  ),
);

await writeFile(
  path.join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/api(?:/.*)?$", dest: "/api" },
        {
          src: "^/assets/(.*)$",
          headers: { "cache-control": "public, max-age=31536000, immutable" },
          continue: true,
        },
        { handle: "filesystem" },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);

console.log(`\n✔ Vercel output ready: ${out}`);
