import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "dist");
fs.mkdirSync(dist, { recursive: true });

const ui = fs.readFileSync(path.join(__dirname, "src", "ui.html"), "utf8");
fs.writeFileSync(path.join(dist, "ui.html"), ui, "utf8");

let agent = fs.readFileSync(path.join(__dirname, "src", "agent.js"), "utf8");
agent = agent.replace(
  /function uiHtml\(\) \{[\s\S]*?\n\}/,
  `function uiHtml() {\n  return ${JSON.stringify(ui)};\n}`,
);

fs.writeFileSync(path.join(dist, "agent.cjs"), "#!/usr/bin/env node\n" + agent, "utf8");
console.log("built dist/agent.cjs + ui.html");
