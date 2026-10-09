import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { appUsersTable, db } from "@workspace/db";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  hashPassword,
  readSessionToken,
  readSignedJson,
  signJson,
  verifyPassword,
} from "../lib/localAuth";
import {
  CODE_MAX_ATTEMPTS,
  CODE_RESEND_MS,
  CODE_TTL_MS,
  cleanName,
  codesSentSince,
  consumeCode,
  exchangeGoogleCode,
  findUserByEmail,
  googleConfig,
  isEmail,
  issueCode,
  latestCode,
  loadAuthPolicy,
  normalizeEmail,
  normalizePhone,
  passwordProblem,
  rateLimited,
  requestOrigin,
  signupCodeMail,
  type AccountStatus,
} from "../lib/accounts";
import { mailConfigured, mailDevFallback, sendMail } from "../lib/mailer";

const router: IRouter = Router();

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const OAUTH_COOKIE = "pharmex_oauth";
const SIGNUP_PURPOSE = "signup";
const HOUR = 60 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();
const appBase = (process.env.BASE_PATH || "/").replace(/\/?$/, "/");

function isLocked(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (entry.resetAt < Date.now()) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const entry = failures.get(key);
  if (!entry || entry.resetAt < Date.now()) {
    failures.set(key, { count: 1, resetAt: Date.now() + FAILURE_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

type AppUser = typeof appUsersTable.$inferSelect;

function publicUser(user: AppUser) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

const blockedMessages: Record<Exclude<AccountStatus, "active">, string> = {
  pending: "Akkauntingiz administrator tasdigʻini kutmoqda. Tasdiqlangach kirishingiz mumkin.",
  rejected: "Roʻyxatdan oʻtish arizangiz administrator tomonidan rad etilgan.",
  disabled: "Akkauntingiz bloklangan. Administratorga murojaat qiling.",
};

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

async function startSession(res: Response, user: AppUser): Promise<void> {
  setSessionCookie(res, createSessionToken(user.id));
  await db.update(appUsersTable).set({ lastLoginAt: new Date() }).where(eq(appUsersTable.id, user.id));
}

const isUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { code, cause } = error as { code?: string; cause?: unknown };
  return code === "23505" || isUniqueViolation(cause);
};

async function createAccount(values: {
  email: string;
  displayName: string;
  phone?: string;
  passwordHash?: string | null;
  googleSub?: string;
  signupMethod: "google" | "email" | "request";
  emailVerified: boolean;
  status: AccountStatus;
}): Promise<AppUser | "exists"> {
  try {
    const [user] = await db
      .insert(appUsersTable)
      .values({
        clerkUserId: `local:${randomUUID()}`,
        email: values.email,
        displayName: values.displayName,
        phone: values.phone ?? "",
        passwordHash: values.passwordHash ?? null,
        googleSub: values.googleSub ?? null,
        signupMethod: values.signupMethod,
        emailVerifiedAt: values.emailVerified ? new Date() : null,
        status: values.status,
        role: "viewer",
      })
      .returning();
    return user!;
  } catch (error) {
    if (isUniqueViolation(error)) return "exists";
    throw error;
  }
}

async function notifyAdmin(user: AppUser, req: Request): Promise<void> {
  const to = process.env.ADMIN_NOTIFY_EMAIL?.trim();
  if (!to || !mailConfigured()) return;
  const methods = { google: "Google", email: "Email + kod", request: "Ariza" } as Record<string, string>;
  await sendMail({
    to,
    subject: `PHARMEX: yangi foydalanuvchi tasdiq kutmoqda — ${user.displayName}`,
    text: `${user.displayName} (${user.email}${user.phone ? `, ${user.phone}` : ""}) ${methods[user.signupMethod] ?? user.signupMethod} orqali roʻyxatdan oʻtdi va tasdiq kutmoqda. Foydalanuvchilar boʻlimida koʻrib chiqing.`,
    html: `<p><b>${user.displayName}</b> (${user.email}${user.phone ? `, ${user.phone}` : ""}) ${methods[user.signupMethod] ?? user.signupMethod} orqali roʻyxatdan oʻtdi va tasdiq kutmoqda.</p><p>PHARMEX → Foydalanuvchilar boʻlimida koʻrib chiqing.</p>`,
  }).catch((err) => req.log.warn({ err }, "Admin notification failed"));
}

// --- public options -----------------------------------------------------

router.get("/auth/options", async (_req, res): Promise<void> => {
  const policy = await loadAuthPolicy();
  res.json({
    google: googleConfig() !== null,
    emailCode: mailConfigured() || mailDevFallback(),
    emailDevMode: mailDevFallback(),
    autoApprove: policy.autoApproveVerified,
    codeLength: 6,
    codeTtlMinutes: Math.round(CODE_TTL_MS / 60000),
    resendSeconds: Math.round(CODE_RESEND_MS / 1000),
  });
});

// --- password login (username or email) ---------------------------------

router.post("/auth/login", async (req, res): Promise<void> => {
  const raw = req.body?.identifier ?? req.body?.username;
  const identifier = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!identifier || !password) {
    res.status(400).json({ error: "Email (yoki login) va parolni kiriting." });
    return;
  }

  const key = `${req.ip}|${identifier}`;
  if (isLocked(key)) {
    res.status(429).json({ error: "Juda koʻp notoʻgʻri urinish. 15 daqiqadan soʻng qayta urinib koʻring." });
    return;
  }

  const user = identifier.includes("@")
    ? await findUserByEmail(identifier)
    : (await db.select().from(appUsersTable).where(eq(appUsersTable.username, identifier)).limit(1))[0];

  if (user && !user.passwordHash && user.googleSub) {
    res.status(400).json({ error: "Bu akkaunt Google orqali ochilgan. «Google bilan kirish» tugmasidan foydalaning.", code: "google_only" });
    return;
  }
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    recordFailure(key);
    res.status(401).json({ error: "Email (login) yoki parol notoʻgʻri." });
    return;
  }
  failures.delete(key);

  if (user.status !== "active") {
    const status = user.status as Exclude<AccountStatus, "active">;
    res.status(403).json({ error: blockedMessages[status] ?? blockedMessages.disabled, code: status });
    return;
  }
  await startSession(res, user);
  res.json(publicUser(user));
});

router.post("/auth/logout", (_req, res): void => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

router.get("/auth/session", async (req, res): Promise<void> => {
  const appUserId = readSessionToken(req.cookies?.[SESSION_COOKIE]);
  const [user] = appUserId
    ? await db.select().from(appUsersTable).where(eq(appUsersTable.id, appUserId)).limit(1)
    : [];
  if (!user || user.status !== "active") {
    res.status(401).json({ error: "Kirish talab qilinadi." });
    return;
  }
  res.json(publicUser(user));
});

// --- method 2: email + password, confirmed with a 6-character code ------

type SignupPayload = { firstName: string; lastName: string; passwordHash: string };

async function sendSignupCode(email: string, payload: SignupPayload): Promise<void> {
  const code = await issueCode(email, SIGNUP_PURPOSE, payload);
  const mail = signupCodeMail(payload.firstName || email, code);
  await sendMail({ to: email, ...mail });
}

router.post("/auth/register/email/start", async (req, res): Promise<void> => {
  const email = normalizeEmail(req.body?.email);
  const firstName = cleanName(req.body?.firstName);
  const lastName = cleanName(req.body?.lastName);
  const password = req.body?.password;

  if (!firstName || !lastName) {
    res.status(400).json({ error: "Ism va familiyani kiriting." });
    return;
  }
  if (!isEmail(email)) {
    res.status(400).json({ error: "Email manzili notoʻgʻri." });
    return;
  }
  const weak = passwordProblem(password);
  if (weak) {
    res.status(400).json({ error: weak });
    return;
  }
  if (!mailConfigured() && !mailDevFallback()) {
    res.status(503).json({ error: "Email orqali kod yuborish hozircha sozlanmagan. Boshqa usuldan foydalaning." });
    return;
  }
  if (await findUserByEmail(email)) {
    res.status(409).json({ error: "Bu email bilan akkaunt allaqachon mavjud. Kirish sahifasidan foydalaning." });
    return;
  }
  if (rateLimited(`code-ip:${req.ip}`, 15, HOUR) || (await codesSentSince(email, SIGNUP_PURPOSE, new Date(Date.now() - HOUR))) >= 5) {
    res.status(429).json({ error: "Juda koʻp kod soʻraldi. Birozdan soʻng qayta urinib koʻring." });
    return;
  }
  const previous = await latestCode(email, SIGNUP_PURPOSE);
  if (previous && Date.now() - previous.createdAt.getTime() < CODE_RESEND_MS) {
    const wait = Math.ceil((CODE_RESEND_MS - (Date.now() - previous.createdAt.getTime())) / 1000);
    res.status(429).json({ error: `Kod yaqinda yuborildi. ${wait} soniyadan soʻng qayta soʻrang.`, retryAfter: wait });
    return;
  }

  try {
    await sendSignupCode(email, { firstName, lastName, passwordHash: await hashPassword(password as string) });
  } catch (err) {
    req.log.error({ err }, "Signup code email failed");
    res.status(502).json({ error: "Kodni emailga yuborib boʻlmadi. Birozdan soʻng qayta urinib koʻring." });
    return;
  }
  res.json({ email, expiresIn: Math.round(CODE_TTL_MS / 1000), resendIn: Math.round(CODE_RESEND_MS / 1000) });
});

router.post("/auth/register/email/resend", async (req, res): Promise<void> => {
  const email = normalizeEmail(req.body?.email);
  const previous = isEmail(email) ? await latestCode(email, SIGNUP_PURPOSE) : undefined;
  if (!previous) {
    res.status(400).json({ error: "Avval roʻyxatdan oʻtish formasini toʻldiring." });
    return;
  }
  const elapsed = Date.now() - previous.createdAt.getTime();
  if (elapsed < CODE_RESEND_MS) {
    const wait = Math.ceil((CODE_RESEND_MS - elapsed) / 1000);
    res.status(429).json({ error: `${wait} soniyadan soʻng qayta yuborish mumkin.`, retryAfter: wait });
    return;
  }
  if (rateLimited(`code-ip:${req.ip}`, 15, HOUR) || (await codesSentSince(email, SIGNUP_PURPOSE, new Date(Date.now() - HOUR))) >= 5) {
    res.status(429).json({ error: "Juda koʻp kod soʻraldi. Birozdan soʻng qayta urinib koʻring." });
    return;
  }
  try {
    await sendSignupCode(email, JSON.parse(previous.payload) as SignupPayload);
  } catch (err) {
    req.log.error({ err }, "Signup code resend failed");
    res.status(502).json({ error: "Kodni emailga yuborib boʻlmadi. Birozdan soʻng qayta urinib koʻring." });
    return;
  }
  res.json({ email, expiresIn: Math.round(CODE_TTL_MS / 1000), resendIn: Math.round(CODE_RESEND_MS / 1000) });
});

router.post("/auth/register/email/verify", async (req, res): Promise<void> => {
  const email = normalizeEmail(req.body?.email);
  const code = typeof req.body?.code === "string" ? req.body.code.replace(/[\s-]/g, "").toUpperCase() : "";
  if (!isEmail(email) || !/^[A-Z0-9]{6}$/.test(code)) {
    res.status(400).json({ error: "6 xonali kodni toʻliq kiriting." });
    return;
  }
  if (rateLimited(`verify-ip:${req.ip}`, 30, 15 * 60 * 1000)) {
    res.status(429).json({ error: "Juda koʻp urinish. Birozdan soʻng qayta urinib koʻring." });
    return;
  }

  const check = await consumeCode(email, SIGNUP_PURPOSE, code);
  if (!check.ok) {
    const messages = {
      missing: "Faol kod topilmadi. Yangi kod soʻrang.",
      expired: "Kod muddati tugagan. «Kodni qayta yuborish» tugmasini bosing.",
      locked: `${CODE_MAX_ATTEMPTS} marta notoʻgʻri kiritildi. Yangi kod soʻrang.`,
      wrong: `Kod notoʻgʻri. Yana ${check.attemptsLeft ?? 0} ta urinish qoldi.`,
    };
    res.status(400).json({ error: messages[check.reason], code: check.reason, attemptsLeft: check.attemptsLeft });
    return;
  }

  const payload = check.payload as Partial<SignupPayload>;
  if (!payload.passwordHash) {
    res.status(400).json({ error: "Roʻyxatdan oʻtish maʼlumotlari topilmadi. Qaytadan boshlang." });
    return;
  }
  const policy = await loadAuthPolicy();
  const created = await createAccount({
    email,
    displayName: [payload.firstName, payload.lastName].filter(Boolean).join(" ") || email,
    passwordHash: payload.passwordHash,
    signupMethod: "email",
    emailVerified: true,
    status: policy.autoApproveVerified ? "active" : "pending",
  });
  if (created === "exists") {
    res.status(409).json({ error: "Bu email bilan akkaunt allaqachon mavjud. Kirish sahifasidan foydalaning." });
    return;
  }
  if (created.status === "active") {
    await startSession(res, created);
    res.json({ status: "active", user: publicUser(created) });
    return;
  }
  void notifyAdmin(created, req);
  res.json({ status: "pending" });
});

// --- method 3: application reviewed by an administrator -----------------

router.post("/auth/register/request", async (req, res): Promise<void> => {
  const email = normalizeEmail(req.body?.email);
  const firstName = cleanName(req.body?.firstName);
  const lastName = cleanName(req.body?.lastName);
  const phone = normalizePhone(req.body?.phone);
  const password = req.body?.password;

  if (!firstName || !lastName) {
    res.status(400).json({ error: "Ism va familiyani kiriting." });
    return;
  }
  if (!phone) {
    res.status(400).json({ error: "Telefon raqami notoʻgʻri. Masalan: +998 90 123 45 67" });
    return;
  }
  if (!isEmail(email)) {
    res.status(400).json({ error: "Email manzili notoʻgʻri." });
    return;
  }
  const weak = passwordProblem(password);
  if (weak) {
    res.status(400).json({ error: weak });
    return;
  }
  if (rateLimited(`request-ip:${req.ip}`, 5, HOUR)) {
    res.status(429).json({ error: "Juda koʻp ariza yuborildi. Birozdan soʻng qayta urinib koʻring." });
    return;
  }

  const created = await createAccount({
    email,
    displayName: `${firstName} ${lastName}`,
    phone,
    passwordHash: await hashPassword(password as string),
    signupMethod: "request",
    emailVerified: false,
    status: "pending",
  });
  if (created === "exists") {
    res.status(409).json({ error: "Bu email bilan akkaunt yoki ariza allaqachon mavjud." });
    return;
  }
  void notifyAdmin(created, req);
  res.status(201).json({ status: "pending" });
});

// --- method 1: Google ---------------------------------------------------

type OAuthState = { state: string; nonce: string; redirectUri: string; intent: string; exp: number };

const authPage = (intent: string, params: Record<string, string>) =>
  `${appBase}${intent === "sign-up" ? "sign-up" : "sign-in"}?${new URLSearchParams(params)}`;

router.get("/auth/google/start", (req, res): void => {
  const intent = req.query.intent === "sign-up" ? "sign-up" : "sign-in";
  const cfg = googleConfig();
  if (!cfg) {
    res.redirect(authPage(intent, { error: "google_off" }));
    return;
  }
  const state: OAuthState = {
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(24).toString("base64url"),
    redirectUri: process.env.GOOGLE_REDIRECT_URI?.trim() || `${requestOrigin(req)}/api/auth/google/callback`,
    intent,
    exp: Date.now() + 10 * 60 * 1000,
  };
  res.cookie(OAUTH_COOKIE, signJson(state), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: 10 * 60 * 1000,
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: state.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: state.state,
    nonce: state.nonce,
    prompt: "select_account",
  }).toString();
  res.redirect(url.toString());
});

router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const saved = readSignedJson<OAuthState>(req.cookies?.[OAUTH_COOKIE]);
  res.clearCookie(OAUTH_COOKIE, { path: "/api/auth/google" });
  const intent = saved?.intent ?? "sign-in";

  if (typeof req.query.error === "string") {
    res.redirect(authPage(intent, { error: "google_cancel" }));
    return;
  }
  if (!saved || saved.exp < Date.now() || saved.state !== req.query.state || typeof req.query.code !== "string") {
    res.redirect(authPage(intent, { error: "google_state" }));
    return;
  }

  try {
    const profile = await exchangeGoogleCode(req.query.code, saved.redirectUri, saved.nonce);
    let [user] = await db.select().from(appUsersTable).where(eq(appUsersTable.googleSub, profile.sub)).limit(1);
    if (!user) {
      const byEmail = await findUserByEmail(profile.email);
      if (byEmail) {
        // Google has proven ownership of this address, so the existing account is linked rather than duplicated.
        [user] = await db
          .update(appUsersTable)
          .set({ googleSub: profile.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() })
          .where(eq(appUsersTable.id, byEmail.id))
          .returning();
      }
    }
    if (!user) {
      const policy = await loadAuthPolicy();
      const created = await createAccount({
        email: profile.email,
        displayName: profile.name,
        googleSub: profile.sub,
        signupMethod: "google",
        emailVerified: true,
        status: policy.autoApproveVerified ? "active" : "pending",
      });
      if (created === "exists") {
        res.redirect(authPage(intent, { error: "google_state" }));
        return;
      }
      user = created;
      if (user.status === "pending") void notifyAdmin(user, req);
    }

    if (user!.status !== "active") {
      res.redirect(authPage("sign-in", user!.status === "pending" ? { notice: "pending" } : { error: user!.status }));
      return;
    }
    await startSession(res, user!);
    res.redirect(appBase);
  } catch (err) {
    req.log.error({ err }, "Google sign-in failed");
    res.redirect(authPage(intent, { error: "google_failed" }));
  }
});

export default router;
