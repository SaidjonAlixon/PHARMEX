import { randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Request } from "express";
import { appUsersTable, authCodesTable, db, integrationSettingsTable } from "@workspace/db";
import { keyedHash } from "./localAuth";

export type AccountStatus = "active" | "pending" | "rejected" | "disabled";
export type SignupMethod = "admin" | "google" | "email" | "request";
export type AuthPolicy = { autoApproveVerified: boolean };

const POLICY_KEY = "auth_policy";
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_RESEND_MS = 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function loadAuthPolicy(): Promise<AuthPolicy> {
  const [row] = await db
    .select({ value: integrationSettingsTable.value })
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.key, POLICY_KEY))
    .limit(1);
  try {
    const parsed = row ? (JSON.parse(row.value) as Partial<AuthPolicy>) : {};
    return { autoApproveVerified: parsed.autoApproveVerified === true };
  } catch {
    return { autoApproveVerified: false };
  }
}

export async function saveAuthPolicy(policy: AuthPolicy): Promise<AuthPolicy> {
  const value = JSON.stringify({ autoApproveVerified: policy.autoApproveVerified });
  await db
    .insert(integrationSettingsTable)
    .values({ key: POLICY_KEY, value })
    .onConflictDoUpdate({ target: integrationSettingsTable.key, set: { value, updatedAt: new Date() } });
  return loadAuthPolicy();
}

// --- validation ---------------------------------------------------------

export const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isEmail = (value: string) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value);

export const cleanName = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 60) : "";

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 9) digits = `998${digits}`;
  if (digits.length < 9 || digits.length > 15) return null;
  return `+${digits}`;
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 8) return "Parol kamida 8 belgidan iborat boʻlsin.";
  if (password.length > 128) return "Parol juda uzun.";
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return "Parolda kamida bitta harf va bitta raqam boʻlsin.";
  return null;
}

export async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(appUsersTable)
    .where(and(sql`lower(${appUsersTable.email}) = ${email}`, sql`${appUsersTable.email} <> ''`))
    .limit(1);
  return user;
}

// --- one-time codes -----------------------------------------------------

export function generateCode(): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (/[A-Z]/.test(code) && /\d/.test(code)) return code;
  }
}

const codeHash = (email: string, code: string) => keyedHash("signup-code", `${email}|${code.toUpperCase()}`);

export async function latestCode(email: string, purpose: string) {
  const [row] = await db
    .select()
    .from(authCodesTable)
    .where(and(eq(authCodesTable.email, email), eq(authCodesTable.purpose, purpose), isNull(authCodesTable.consumedAt)))
    .orderBy(desc(authCodesTable.createdAt))
    .limit(1);
  return row;
}

export async function codesSentSince(email: string, purpose: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(authCodesTable)
    .where(and(eq(authCodesTable.email, email), eq(authCodesTable.purpose, purpose), gt(authCodesTable.createdAt, since)));
  return row?.n ?? 0;
}

export async function issueCode(email: string, purpose: string, payload: object): Promise<string> {
  const code = generateCode();
  await db.transaction(async (tx) => {
    await tx
      .update(authCodesTable)
      .set({ consumedAt: new Date() })
      .where(and(eq(authCodesTable.email, email), eq(authCodesTable.purpose, purpose), isNull(authCodesTable.consumedAt)));
    await tx.insert(authCodesTable).values({
      email,
      purpose,
      codeHash: codeHash(email, code),
      payload: JSON.stringify(payload),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
  });
  return code;
}

export type CodeCheck =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: "missing" | "expired" | "locked" | "wrong"; attemptsLeft?: number };

export async function consumeCode(email: string, purpose: string, code: string): Promise<CodeCheck> {
  const row = await latestCode(email, purpose);
  if (!row) return { ok: false, reason: "missing" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (row.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, reason: "locked" };

  const expected = Buffer.from(row.codeHash);
  const actual = Buffer.from(codeHash(email, code));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    const [updated] = await db
      .update(authCodesTable)
      .set({ attempts: sql`${authCodesTable.attempts} + 1` })
      .where(eq(authCodesTable.id, row.id))
      .returning({ attempts: authCodesTable.attempts });
    const left = CODE_MAX_ATTEMPTS - (updated?.attempts ?? CODE_MAX_ATTEMPTS);
    return left > 0 ? { ok: false, reason: "wrong", attemptsLeft: left } : { ok: false, reason: "locked" };
  }

  const [claimed] = await db
    .update(authCodesTable)
    .set({ consumedAt: new Date() })
    .where(and(eq(authCodesTable.id, row.id), isNull(authCodesTable.consumedAt)))
    .returning({ id: authCodesTable.id });
  if (!claimed) return { ok: false, reason: "missing" };
  try {
    return { ok: true, payload: JSON.parse(row.payload) as Record<string, unknown> };
  } catch {
    return { ok: true, payload: {} };
  }
}

// --- simple in-memory rate limiting --------------------------------------

const buckets = new Map<string, number[]>();

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

// --- email templates ----------------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#eef3f9;font-family:Segoe UI,Arial,sans-serif;color:#0b1e4a">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 40px -18px rgba(11,30,74,.35)">
<tr><td style="background:linear-gradient(135deg,#0fb3c7,#2fcf5a);padding:22px 28px;color:#fff;font-size:20px;font-weight:800;letter-spacing:.04em">PHARMEX</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h1>
${body}
<p style="margin:26px 0 0;font-size:12px;color:#7b8aa5">Bu xat PHARMEX tizimi tomonidan avtomatik yuborildi. Agar siz soʻramagan boʻlsangiz, eʼtibor bermang.</p>
</td></tr></table></td></tr></table></body></html>`;
}

export function signupCodeMail(name: string, code: string) {
  const minutes = Math.round(CODE_TTL_MS / 60000);
  return {
    subject: `PHARMEX tasdiqlash kodi: ${code}`,
    text: `Assalomu alaykum, ${name}!\n\nPHARMEX da roʻyxatdan oʻtish uchun tasdiqlash kodingiz: ${code}\n\nKod ${minutes} daqiqa amal qiladi. Uni hech kimga bermang.`,
    html: layout(
      "Tasdiqlash kodi",
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#3d4f70">Assalomu alaykum, ${escapeHtml(name)}! PHARMEX da roʻyxatdan oʻtishni yakunlash uchun quyidagi kodni kiriting:</p>
<div style="text-align:center;margin:8px 0 18px"><span style="display:inline-block;padding:14px 22px;border-radius:14px;background:#f1f7fc;border:1px solid #d6e3f2;font:800 30px/1 Consolas,monospace;letter-spacing:10px;color:#0b1e4a">${escapeHtml(code)}</span></div>
<p style="margin:0;font-size:13px;color:#5b6b88">Kod ${minutes} daqiqa amal qiladi. Uni hech kimga bermang — PHARMEX xodimlari kodni soʻramaydi.</p>`,
    ),
  };
}

export function reviewMail(name: string, approved: boolean, loginUrl: string) {
  return approved
    ? {
        subject: "PHARMEX: akkauntingiz tasdiqlandi",
        text: `Assalomu alaykum, ${name}!\n\nAdministrator akkauntingizni tasdiqladi. Endi tizimga kirishingiz mumkin: ${loginUrl}`,
        html: layout(
          "Akkauntingiz tasdiqlandi",
          `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#3d4f70">Assalomu alaykum, ${escapeHtml(name)}! Administrator akkauntingizni tasdiqladi.</p>
<a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#0fb3c7;color:#fff;font-weight:700;text-decoration:none">Tizimga kirish</a>`,
        ),
      }
    : {
        subject: "PHARMEX: roʻyxatdan oʻtish arizasi",
        text: `Assalomu alaykum, ${name}!\n\nAfsuski, roʻyxatdan oʻtish arizangiz administrator tomonidan rad etildi.`,
        html: layout(
          "Ariza rad etildi",
          `<p style="margin:0;font-size:15px;line-height:1.6;color:#3d4f70">Assalomu alaykum, ${escapeHtml(name)}! Afsuski, roʻyxatdan oʻtish arizangiz administrator tomonidan rad etildi. Savollar boʻlsa, administratorga murojaat qiling.</p>`,
        ),
      };
}

// --- Google OAuth -------------------------------------------------------

export function requestOrigin(req: Request): string {
  const fixed = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (fixed) return fixed;
  const proto = (req.get("x-forwarded-proto") ?? req.protocol).split(",")[0]!.trim();
  const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "localhost").split(",")[0]!.trim();
  return `${proto}://${host}`;
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export type GoogleProfile = { sub: string; email: string; name: string; givenName: string; familyName: string };

export async function exchangeGoogleCode(code: string, redirectUri: string, nonce: string): Promise<GoogleProfile> {
  const cfg = googleConfig();
  if (!cfg) throw new Error("Google kirish sozlanmagan");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!response.ok || !body.id_token) throw new Error(`Google token: ${body.error ?? response.status}`);

  // The ID token comes straight from Google's token endpoint over TLS, so its claims can be trusted without re-verifying the signature (OpenID Connect Core 3.1.3.7).
  const claims = JSON.parse(Buffer.from(body.id_token.split(".")[1] ?? "", "base64url").toString()) as Record<string, unknown>;
  if (claims.aud !== cfg.clientId) throw new Error("Google token boshqa ilova uchun");
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw new Error("Google token manbasi notoʻgʻri");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) throw new Error("Google token muddati tugagan");
  if (claims.nonce !== nonce) throw new Error("Google token nonce mos emas");
  if (claims.email_verified !== true || typeof claims.email !== "string") throw new Error("Google email tasdiqlanmagan");

  const email = claims.email.toLowerCase();
  const givenName = cleanName(claims.given_name);
  const familyName = cleanName(claims.family_name);
  return {
    sub: String(claims.sub),
    email,
    givenName,
    familyName,
    name: cleanName(claims.name) || [givenName, familyName].filter(Boolean).join(" ") || email.split("@")[0]!,
  };
}
