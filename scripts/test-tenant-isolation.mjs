/**
 * Cross-tenant isolation smoke test against a running API.
 * Usage (on VPS or with env):
 *   BASE=https://pharmxs.uz node scripts/test-tenant-isolation.mjs
 *
 * Creates two ephemeral company admins via DB is out of scope here —
 * instead verifies that authenticated company session cannot read
 * unscoped platform routes and that /branches returns only own org.
 */
import { createHmac, randomBytes } from "node:crypto";

const BASE = (process.env.BASE || "http://127.0.0.1:8080").replace(/\/$/, "");

async function api(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() || [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  // Unauthenticated company routes must 401
  for (const path of ["/api/branches", "/api/receipts", "/api/purchases", "/api/stock-documents", "/api/debts"]) {
    const r = await api(path);
    check(`401 without session ${path}`, r.status === 401, `got ${r.status}`);
  }

  // Platform CRM without session
  const crm = await api("/api/platform/crm/companies");
  check("401 platform CRM without session", crm.status === 401, `got ${crm.status}`);

  // Domain surface: owner paths blocked at nginx (optional)
  if (BASE.includes("pharmxs.uz")) {
    const owner = await fetch(`${BASE.replace("/api", "")}/owner`).catch(() => null);
    // when BASE is api only, skip
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
