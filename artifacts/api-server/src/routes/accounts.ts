import { randomBytes, randomInt } from "node:crypto";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { appUsersTable, auditLogTable, db } from "@workspace/db";
import { requireRole } from "../middlewares/requireClerkUser";
import {
  cleanName,
  googleConfig,
  loadAuthPolicy,
  normalizePhone,
  passwordProblem,
  requestOrigin,
  reviewMail,
  saveAuthPolicy,
  type AccountStatus,
} from "../lib/accounts";
import { hashPassword } from "../lib/localAuth";
import { mailConfigured, mailDevFallback, sendMail } from "../lib/mailer";

const router: IRouter = Router();
const ROLES = ["admin", "finance", "viewer"] as const;
const STATUSES: AccountStatus[] = ["active", "pending", "rejected", "disabled"];

const accountColumns = {
  id: appUsersTable.id,
  displayName: appUsersTable.displayName,
  email: appUsersTable.email,
  username: appUsersTable.username,
  phone: appUsersTable.phone,
  role: appUsersTable.role,
  status: appUsersTable.status,
  signupMethod: appUsersTable.signupMethod,
  emailVerifiedAt: appUsersTable.emailVerifiedAt,
  hasPassword: sql<boolean>`${appUsersTable.passwordHash} is not null`,
  hasGoogle: sql<boolean>`${appUsersTable.googleSub} is not null`,
  reviewedAt: appUsersTable.reviewedAt,
  lastLoginAt: appUsersTable.lastLoginAt,
  createdAt: appUsersTable.createdAt,
};

/** Earliest active admin = bosh admin (protected owner). */
async function ownerAdminId(): Promise<number | null> {
  const [row] = await db
    .select({ id: appUsersTable.id })
    .from(appUsersTable)
    .where(and(eq(appUsersTable.role, "admin"), eq(appUsersTable.status, "active")))
    .orderBy(asc(appUsersTable.id))
    .limit(1);
  return row?.id ?? null;
}

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "Pxs";
  for (let i = 0; i < 7; i++) out += alphabet[randomInt(alphabet.length)];
  if (!/\d/.test(out)) out = `${out.slice(0, -1)}${randomInt(10)}`;
  return out;
}

function baseUsername(displayName: string, phone: string): string {
  const latin = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 10);
  const digits = phone.replace(/\D/g, "").slice(-4);
  return (latin || "user") + (digits || randomBytes(2).toString("hex"));
}

async function uniqueUsername(seed: string): Promise<string> {
  let candidate = seed.slice(0, 24);
  for (let i = 0; i < 40; i++) {
    const [hit] = await db
      .select({ id: appUsersTable.id })
      .from(appUsersTable)
      .where(eq(appUsersTable.username, candidate))
      .limit(1);
    if (!hit) return candidate;
    candidate = `${seed.slice(0, 18)}${randomInt(10, 99)}`;
  }
  return `user${Date.now().toString(36)}`;
}

router.get("/accounts", requireRole("admin"), async (_req, res): Promise<void> => {
  const me = Number(res.locals.appUserId);
  const [users, policy, ownerId] = await Promise.all([
    db
      .select(accountColumns)
      .from(appUsersTable)
      .where(sql`${appUsersTable.passwordHash} is not null or ${appUsersTable.googleSub} is not null`)
      .orderBy(sql`case ${appUsersTable.status} when 'pending' then 0 else 1 end`, desc(appUsersTable.createdAt)),
    loadAuthPolicy(),
    ownerAdminId(),
  ]);
  res.json({
    users,
    policy,
    me,
    ownerId,
    isOwner: ownerId != null && ownerId === me,
    mail: { configured: mailConfigured(), devMode: mailDevFallback() },
    google: googleConfig() !== null,
  });
});

router.put("/accounts/policy", requireRole("admin"), async (req, res): Promise<void> => {
  const me = Number(res.locals.appUserId);
  const ownerId = await ownerAdminId();
  if (ownerId !== me) {
    res.status(403).json({ error: "Kirish siyosatini faqat bosh administrator oʻzgartira oladi." });
    return;
  }
  if (typeof req.body?.autoApproveVerified !== "boolean") {
    res.status(400).json({ error: "autoApproveVerified true yoki false boʻlishi kerak." });
    return;
  }
  const policy = await saveAuthPolicy({ autoApproveVerified: req.body.autoApproveVerified });
  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: "auth.policy.saved",
    entityType: "settings",
    entityId: "auth_policy",
    summary: policy.autoApproveVerified
      ? "Tasdiqlangan email bilan roʻyxatdan oʻtganlar darhol faollashadi"
      : "Barcha yangi akkauntlar admin tasdigʻini kutadi",
  });
  res.json(policy);
});

router.post("/accounts", requireRole("admin"), async (req, res): Promise<void> => {
  const me = Number(res.locals.appUserId);
  const ownerId = await ownerAdminId();
  if (ownerId !== me) {
    res.status(403).json({ error: "Foydalanuvchi yaratish faqat bosh administratorga ruxsat etilgan." });
    return;
  }

  const displayName = cleanName(req.body?.displayName);
  const phoneRaw = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const phone = phoneRaw ? normalizePhone(phoneRaw) : "";
  const role = req.body?.role as (typeof ROLES)[number] | undefined;

  if (!displayName || displayName.length < 2) {
    res.status(400).json({ error: "Ism kamida 2 belgidan iborat boʻlsin." });
    return;
  }
  if (phoneRaw && !phone) {
    res.status(400).json({ error: "Telefon raqami notoʻgʻri. Masalan: +998901234567" });
    return;
  }
  if (!role || !ROLES.includes(role)) {
    res.status(400).json({ error: "Rolni tanlang: Administrator, Moliya xodimi yoki Kuzatuvchi." });
    return;
  }

  const password = generatePassword();
  if (passwordProblem(password)) {
    res.status(500).json({ error: "Parol yaratib boʻlmadi. Qayta urinib koʻring." });
    return;
  }
  const username = await uniqueUsername(baseUsername(displayName, phone || ""));
  const passwordHash = await hashPassword(password);

  try {
    const [created] = await db
      .insert(appUsersTable)
      .values({
        clerkUserId: `local:${username}`,
        displayName,
        username,
        phone: phone || "",
        email: "",
        role,
        status: "active",
        signupMethod: "admin",
        passwordHash,
        emailVerifiedAt: null,
        reviewedAt: new Date(),
        reviewedBy: me,
      })
      .returning();

    await db.insert(auditLogTable).values({
      actorId: String(res.locals.userId),
      action: "account.created",
      entityType: "user",
      entityId: String(created!.id),
      summary: `${displayName} yaratildi · login ${username} · rol ${role}`,
    });

    const [row] = await db.select(accountColumns).from(appUsersTable).where(eq(appUsersTable.id, created!.id)).limit(1);
    res.status(201).json({
      user: row,
      credentials: { username, password },
    });
  } catch (err) {
    req.log.warn({ err }, "account create failed");
    res.status(409).json({ error: "Foydalanuvchini yaratib boʻlmadi. Login band boʻlishi mumkin." });
  }
});

router.patch("/accounts/:id", requireRole("admin"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const status = req.body?.status as AccountStatus | undefined;
  const role = req.body?.role as (typeof ROLES)[number] | undefined;
  const displayName = req.body?.displayName !== undefined ? cleanName(req.body.displayName) : undefined;
  const phoneIncoming = req.body?.phone;
  const phone =
    phoneIncoming === undefined
      ? undefined
      : phoneIncoming === "" || phoneIncoming === null
        ? ""
        : normalizePhone(phoneIncoming);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Foydalanuvchi ID notoʻgʻri." });
    return;
  }
  if ((status !== undefined && !STATUSES.includes(status)) || (role !== undefined && !ROLES.includes(role))) {
    res.status(400).json({ error: "Holat yoki rol notoʻgʻri." });
    return;
  }
  if (displayName !== undefined && displayName.length < 2) {
    res.status(400).json({ error: "Ism kamida 2 belgidan iborat boʻlsin." });
    return;
  }
  if (phoneIncoming !== undefined && phoneIncoming !== "" && phoneIncoming !== null && phone === null) {
    res.status(400).json({ error: "Telefon raqami notoʻgʻri." });
    return;
  }
  if (status === undefined && role === undefined && displayName === undefined && phone === undefined) {
    res.status(400).json({ error: "Oʻzgartirish uchun maydon yuboring." });
    return;
  }

  const me = Number(res.locals.appUserId);
  const ownerId = await ownerAdminId();
  const isOwner = ownerId === me;

  if (id === me && ((status && status !== "active") || (role && role !== "admin"))) {
    res.status(409).json({ error: "Oʻz akkauntingizni bloklab yoki adminlikdan chiqarib boʻlmaydi." });
    return;
  }
  if (ownerId === id && !isOwner) {
    res.status(403).json({ error: "Bosh administratorga tegib boʻlmaydi." });
    return;
  }
  if (!isOwner && (status !== undefined || role !== undefined || displayName !== undefined || phone !== undefined)) {
    // Oddiy admin foydalanuvchilarni boshqara olmaydi — faqat platforma maʼlumotlari
    res.status(403).json({ error: "Foydalanuvchilarni faqat bosh administrator boshqaradi." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(815274902::bigint)`);
    const [target] = await tx.select().from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
    if (!target) return "missing" as const;

    const losesAdmin =
      target.role === "admin" && target.status === "active" && ((role && role !== "admin") || (status && status !== "active"));
    if (losesAdmin) {
      const [other] = await tx
        .select({ id: appUsersTable.id })
        .from(appUsersTable)
        .where(and(eq(appUsersTable.role, "admin"), eq(appUsersTable.status, "active"), ne(appUsersTable.id, id)))
        .limit(1);
      if (!other) return "last-admin" as const;
    }

    const reviewed = target.status === "pending" && status && status !== "pending";
    const [updated] = await tx
      .update(appUsersTable)
      .set({
        ...(status ? { status } : {}),
        ...(role ? { role } : {}),
        ...(displayName !== undefined ? { displayName } : {}),
        ...(phone !== undefined ? { phone: phone || "" } : {}),
        ...(reviewed ? { reviewedAt: new Date(), reviewedBy: me } : {}),
        updatedAt: new Date(),
      })
      .where(eq(appUsersTable.id, id))
      .returning();

    const changes = [
      status && status !== target.status ? `holat: ${target.status} → ${status}` : "",
      role && role !== target.role ? `rol: ${target.role} → ${role}` : "",
      displayName && displayName !== target.displayName ? `ism: ${target.displayName} → ${displayName}` : "",
      phone !== undefined && (phone || "") !== target.phone ? "telefon yangilandi" : "",
    ].filter(Boolean);
    if (changes.length) {
      await tx.insert(auditLogTable).values({
        actorId: String(res.locals.userId),
        action: reviewed ? (status === "active" ? "account.approved" : "account.rejected") : "account.updated",
        entityType: "user",
        entityId: String(id),
        summary: `${target.displayName} (${target.email || target.username}): ${changes.join(", ")}`,
      });
    }
    return { before: target, after: updated! };
  });

  if (result === "missing") {
    res.status(404).json({ error: "Foydalanuvchi topilmadi." });
    return;
  }
  if (result === "last-admin") {
    res.status(409).json({ error: "Oxirgi faol administratorni oʻzgartirib boʻlmaydi." });
    return;
  }

  const { before, after } = result;
  let mailed = false;
  if (before.status === "pending" && (after.status === "active" || after.status === "rejected") && after.email && mailConfigured()) {
    const mail = reviewMail(after.displayName, after.status === "active", `${requestOrigin(req)}/sign-in`);
    mailed = await sendMail({ to: after.email, ...mail }).then(
      () => true,
      (err) => {
        req.log.warn({ err }, "Review notification failed");
        return false;
      },
    );
  }

  const [row] = await db.select(accountColumns).from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
  res.json({ user: row, mailed });
});

router.post("/accounts/:id/reset-password", requireRole("admin"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const me = Number(res.locals.appUserId);
  const ownerId = await ownerAdminId();
  if (ownerId !== me) {
    res.status(403).json({ error: "Parolni faqat bosh administrator yangilay oladi." });
    return;
  }
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Foydalanuvchi ID notoʻgʻri." });
    return;
  }
  if (ownerId === id && me !== id) {
    res.status(403).json({ error: "Bosh administrator parolini boshqa hech kim yangilay olmaydi." });
    return;
  }

  const [target] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
  if (!target) {
    res.status(404).json({ error: "Foydalanuvchi topilmadi." });
    return;
  }
  if (!target.username) {
    res.status(409).json({ error: "Bu akkauntda login yoʻq (faqat Google). Avval login yaratilishi kerak." });
    return;
  }

  const password = generatePassword();
  await db
    .update(appUsersTable)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(appUsersTable.id, id));
  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: "account.password_reset",
    entityType: "user",
    entityId: String(id),
    summary: `${target.displayName} uchun yangi parol yaratildi`,
  });

  const [row] = await db.select(accountColumns).from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
  res.json({
    user: row,
    credentials: { username: target.username, password },
  });
});

router.delete("/accounts/:id", requireRole("admin"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const me = Number(res.locals.appUserId);
  const ownerId = await ownerAdminId();
  if (ownerId !== me) {
    res.status(403).json({ error: "Foydalanuvchini faqat bosh administrator oʻchira oladi." });
    return;
  }
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Foydalanuvchi ID notoʻgʻri." });
    return;
  }
  if (id === me || id === ownerId) {
    res.status(409).json({ error: "Bosh administratorni oʻchirib boʻlmaydi." });
    return;
  }

  const [target] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
  if (!target) {
    res.status(404).json({ error: "Foydalanuvchi topilmadi." });
    return;
  }

  await db.delete(appUsersTable).where(eq(appUsersTable.id, id));
  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: "account.deleted",
    entityType: "user",
    entityId: String(id),
    summary: `${target.displayName} (${target.username || target.email}) oʻchirildi`,
  });
  res.json({ ok: true });
});

export default router;
