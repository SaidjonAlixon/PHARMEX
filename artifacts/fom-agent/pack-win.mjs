/**
 * Build a Windows .exe with @yao-pkg/pkg (downloaded on demand).
 * Output: release/PHARMXS-FOM-Agent.exe (+ ui.html beside it for safety)
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const release = path.join(__dirname, "release");
fs.mkdirSync(release, { recursive: true });

const agent = path.join(__dirname, "dist", "agent.cjs");
if (!fs.existsSync(agent)) {
  console.error("Run build first");
  process.exit(1);
}

const out = path.join(release, "PHARMXS-FOM-Agent.exe");
const r = spawnSync(
  "npx",
  ["--yes", "@yao-pkg/pkg@5.16.1", agent, "--targets", "node18-win-x64", "--output", out, "--compress", "GZip"],
  { stdio: "inherit", shell: true, cwd: __dirname },
);
if (r.status !== 0) process.exit(r.status || 1);

fs.copyFileSync(path.join(__dirname, "dist", "ui.html"), path.join(release, "ui.html"));
console.log("packed", out);
