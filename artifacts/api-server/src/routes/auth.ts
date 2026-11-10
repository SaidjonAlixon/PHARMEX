import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { appUsersTable, db } from "@workspace/db";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  readSessionToken,
  verifyPassword,
} from "../lib/localAuth";
import {
  CODE_TTL_MS,
  CODE_RESEND_MS,
  cleanName,
  findUserByEmail,
  isEmail,
  normalizeEmail,
  normalizePhone,
  rateLimited,
  type AccountStatus,
} from "../lib/accounts";
import { mailConfigured, sendMail } from "../lib/mailer";
import { loadOrganization, publicOrganization } from "../lib/org";
import { planList } from "../lib/plans";

const router: IRouter = Router();

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
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

async function publicUser(user: AppUser) {
  const org = user.role === "platform_admin" ? null : await loadOrganization(user.organizationId);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    organizationId: user.organizationId,
    organization: publicOrganization(org),
    plans: planList(),
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
  companyName?: string;
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
        companyName: values.companyName?.trim().slice(0, 120) ?? "",
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
    subject: `PHARMXS: yangi foydalanuvchi tasdiq kutmoqda — ${user.displayName}`,
    text: `${user.displayName} (${user.email}${user.phone ? `, ${user.phone}` : ""}) ${methods[user.signupMethod] ?? user.signupMethod} orqali roʻyxatdan oʻtdi va tasdiq kutmoqda. Foydalanuvchilar boʻlimida koʻrib chiqing.`,
    html: `<p><b>${user.displayName}</b> (${user.email}${user.phone ? `, ${user.phone}` : ""}) ${methods[user.signupMethod] ?? user.signupMethod} orqali roʻyxatdan oʻtdi va tasdiq kutmoqda.</p><p>PHARMXS → Foydalanuvchilar boʻlimida koʻrib chiqing.</p>`,
  }).catch((err) => req.log.warn({ err }, "Admin notification failed"));
}

// --- public options -----------------------------------------------------

router.get("/auth/options", async (_req, res): Promise<void> => {
  // Public onboarding is application-only; login/password is issued by platform admin.
  res.json({
    google: false,
    emailCode: false,
    emailDevMode: false,
    autoApprove: false,
    applicationOnly: true,
    trialDays: 7,
    trialPlan: "starter",
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

  if (user && !user.passwordHash) {
    res.status(400).json({
      error: "Login/parol hali berilmagan. Platforma administratori akkauntingizni ochgach, berilgan login va parol bilan kiring.",
      code: "credentials_pending",
    });
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
  res.json(await publicUser(user));
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
  res.json(await publicUser(user));
});

const closedSelfServe = (_req: Request, res: Response): void => {
  res.status(410).json({
    error: "Mustaqil roʻyxatdan oʻtish yopilgan. «7 kun bepul» arizasini qoldiring — platforma admini akkaunt ochadi.",
  });
};

router.post("/auth/register/email/start", closedSelfServe);
router.post("/auth/register/email/resend", closedSelfServe);
router.post("/auth/register/email/verify", closedSelfServe);

// --- Public application (ariza): platform admin issues login/password -----

router.post("/auth/register/request", async (req, res): Promise<void> => {
  const email = normalizeEmail(req.body?.email);
  const firstName = cleanName(req.body?.firstName);
  const lastName = cleanName(req.body?.lastName);
  const phone = normalizePhone(req.body?.phone);
  const companyName =
    cleanName(req.body?.companyName) ||
    cleanName(req.body?.company) ||
    `${firstName} kompaniyasi`;

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
  if (!companyName || companyName.length < 2) {
    res.status(400).json({ error: "Kompaniya (dorixona) nomini kiriting." });
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
    companyName,
    passwordHash: null,
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

// --- Google disabled (kept for old bookmarks) ----------------------------

const authPage = (intent: string, params: Record<string, string>) =>
  `${appBase}${intent === "sign-up" ? "sign-up" : "sign-in"}?${new URLSearchParams(params)}`;

router.get("/auth/google/start", (_req, res): void => {
  res.redirect(authPage("sign-up", { error: "google_off" }));
});

router.get("/auth/google/callback", (_req, res): void => {
  res.redirect(authPage("sign-in", { error: "google_off" }));
});

export default router;
