import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { appUsersTable, db } from "@workspace/db";
import { logger } from "./logger";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export const localAuthEnabled = process.env.AUTH_MODE === "local";
export const SESSION_COOKIE = "pharmex_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_MODE=local requires SESSION_SECRET of at least 32 characters.",
    );
  }
  return secret;
}

export function assertLocalAuthConfig(): void {
  sessionSecret();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  const [algorithm, salt, key] = (stored ?? "").split("$");
  if (algorithm !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(expected, actual);
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function keyedHash(purpose: string, value: string): string {
  return createHmac("sha256", sessionSecret()).update(`${purpose}\0${value}`).digest("base64url");
}

export function signJson(value: object): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(`json:${payload}`)}`;
}

export function readSignedJson<T>(token: unknown): T | null {
  if (typeof token !== "string") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(`json:${payload}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

export function createSessionToken(appUserId: number): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: appUserId, exp: Date.now() + SESSION_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token: unknown): number | null {
  if (typeof token !== "string") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof uid !== "number" || typeof exp !== "number" || exp < Date.now()) {
      return null;
    }
    return uid;
  } catch {
    return null;
  }
}

// Creates the initial administrator from ADMIN_USERNAME / ADMIN_PASSWORD; never overwrites an existing account.
export async function ensureBootstrapAdmin(): Promise<void> {
  const username = process.env.ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  if (password.length < 10) {
    throw new Error("ADMIN_PASSWORD must be at least 10 characters.");
  }

  const [existing] = await db
    .select({ id: appUsersTable.id })
    .from(appUsersTable)
    .where(eq(appUsersTable.username, username))
    .limit(1);
  if (existing) return;

  await db.insert(appUsersTable).values({
    clerkUserId: `local:${username}`,
    username,
    passwordHash: await hashPassword(password),
    displayName: "Administrator",
    role: "admin",
  });
  logger.info({ username }, "Bootstrap administrator created");
}
