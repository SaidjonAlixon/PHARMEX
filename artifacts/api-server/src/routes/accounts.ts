import { and, desc, eq, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { appUsersTable, auditLogTable, db } from "@workspace/db";
import { requireRole } from "../middlewares/requireClerkUser";
import { googleConfig, loadAuthPolicy, requestOrigin, reviewMail, saveAuthPolicy, type AccountStatus } from "../lib/accounts";
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

router.get("/accounts", requireRole("admin"), async (_req, res): Promise<void> => {
  const [users, policy] = await Promise.all([
    db
      .select(accountColumns)
      .from(appUsersTable)
      .where(sql`${appUsersTable.passwordHash} is not null or ${appUsersTable.googleSub} is not null`)
      .orderBy(sql`case ${appUsersTable.status} when 'pending' then 0 else 1 end`, desc(appUsersTable.createdAt)),
    loadAuthPolicy(),
  ]);
  res.json({
    users,
    policy,
    me: Number(res.locals.appUserId),
    mail: { configured: mailConfigured(), devMode: mailDevFallback() },
    google: googleConfig() !== null,
  });
});

router.put("/accounts/policy", requireRole("admin"), async (req, res): Promise<void> => {
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

router.patch("/accounts/:id", requireRole("admin"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const status = req.body?.status as AccountStatus | undefined;
  const role = req.body?.role as (typeof ROLES)[number] | undefined;
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Foydalanuvchi ID notoʻgʻri." });
    return;
  }
  if ((status !== undefined && !STATUSES.includes(status)) || (role !== undefined && !ROLES.includes(role))) {
    res.status(400).json({ error: "Holat yoki rol notoʻgʻri." });
    return;
  }
  if (status === undefined && role === undefined) {
    res.status(400).json({ error: "Oʻzgartirish uchun holat yoki rol yuboring." });
    return;
  }
  const me = Number(res.locals.appUserId);
  if (id === me && ((status && status !== "active") || (role && role !== "admin"))) {
    res.status(409).json({ error: "Oʻz akkauntingizni bloklab yoki adminlikdan chiqarib boʻlmaydi." });
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
        ...(reviewed ? { reviewedAt: new Date(), reviewedBy: me } : {}),
        updatedAt: new Date(),
      })
      .where(eq(appUsersTable.id, id))
      .returning();

    const changes = [
      status && status !== target.status ? `holat: ${target.status} → ${status}` : "",
      role && role !== target.role ? `rol: ${target.role} → ${role}` : "",
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

export default router;
