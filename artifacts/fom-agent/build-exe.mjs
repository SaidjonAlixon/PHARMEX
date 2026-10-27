import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

const install = spawnSync("pnpm", ["install"], { cwd: root, shell: true, stdio: "inherit" });
if (install.status !== 0) process.exit(install.status ?? 1);

const out = join(dist, "PHARMEX-FOM-Agent.exe");
const pkg = spawnSync(
  "pnpm",
  ["exec", "pkg", "agent.mjs", "--targets", "node20-win-x64", "--output", out, "--compress", "GZip"],
  { cwd: root, shell: true, stdio: "inherit" },
);
if (pkg.status !== 0) process.exit(pkg.status ?? 1);

copyFileSync(join(root, "config.example.ini"), join(dist, "config.example.ini"));
if (!existsSync(join(dist, "config.ini"))) {
  copyFileSync(join(root, "config.example.ini"), join(dist, "config.ini"));
}
copyFileSync(join(root, "install.ps1"), join(dist, "install.ps1"));
copyFileSync(join(root, "README-UZ.txt"), join(dist, "README-UZ.txt"));
writeFileSync(join(dist, "start.bat"), `@echo off\r\ncd /d "%~dp0"\r\nPHARMEX-FOM-Agent.exe\r\npause\r\n`, "utf8");
console.log(`\nTayyor: ${out}`);
console.log("Apteka kompyuteriga dist/ papkasini nusxalang va install.ps1 ni ishga tushiring.");
