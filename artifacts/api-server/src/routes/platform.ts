import { randomInt } from "node:crypto";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, organizationsTable, paymentsTable, appUsersTable, auditLogTable } from "@workspace/db";
import { requirePlatformAdmin } from "../middlewares/requireClerkUser";
import { PLANS, PLAN_PERIOD_DAYS, isPlanCode, planList } from "../lib/plans";
import { createOrganizationForOwner, publicOrganization } from "../lib/org";
import { hashPassword } from "../lib/localAuth";

const ORG_USER_ROLES = ["admin", "finance", "viewer"] as const;
const USER_STATUSES = ["active", "disabled", "pending", "rejected"] as const;

const userPublicCols = {
  id: appUsersTable.id,
  displayName: appUsersTable.displayName,
  email: appUsersTable.email,
  username: appUsersTable.username,
  phone: appUsersTable.phone,
  role: appUsersTable.role,
  status: appUsersTable.status,
  organizationId: appUsersTable.organizationId,
  lastLoginAt: appUsersTable.lastLoginAt,
  createdAt: appUsersTable.createdAt,
};

const router: IRouter = Router();

router.use(requirePlatformAdmin);

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "Pxs";
  for (let i = 0; i < 7; i++) out += alphabet[randomInt(alphabet.length)];
  if (!/\d/.test(out)) out = `${out.slice(0, -1)}${randomInt(10)}`;
  return out;
}

async function uniqueUsername(seed: string): Promise<string> {
  let candidate = seed.slice(0, 24) || `user${Date.now().toString(36)}`;
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

router.get("/platform/overview", async (_req, res): Promise<void> => {
  const orgs = await db.select().from(organizationsTable).orderBy(desc(organizationsTable.createdAt)).limit(200);
  const payments = await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt)).limit(100);
  const pendingApps = await db
    .select({ id: appUsersTable.id })
    .from(appUsersTable)
    .where(eq(appUsersTable.status, "pending"));
  const paid = payments.filter((p) => p.status === "paid");
  res.json({
    companies: orgs.length,
    activePaid: orgs.filter((o) => o.subscriptionStatus === "active").length,
    trialing: orgs.filter((o) => o.subscriptionStatus === "trialing").length,
    pendingApplications: pendingApps.length,
    revenueUzs: paid.reduce((s, p) => s + p.amount, 0),
    plans: planList(),
  });
});

router.get("/platform/organizations", async (_req, res): Promise<void> => {
  const orgs = await db.select().from(organizationsTable).orderBy(desc(organizationsTable.createdAt));
  const owners = await db
    .select({ id: appUsersTable.id, email: appUsersTable.email, displayName: appUsersTable.displayName })
    .from(appUsersTable);
  const byId = new Map(owners.map((o) => [o.id, o]));
  res.json(
    orgs.map((o) => ({
      ...publicOrganization(o),
      owner: o.ownerUserId ? byId.get(o.ownerUserId) ?? null : null,
      createdAt: o.createdAt,
    })),
  );
});

router.patch("/platform/organizations/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Notoʻgʻri ID." });
    return;
  }
  const patch: Partial<typeof organizationsTable.$inferInsert> = {};
  if (typeof req.body?.name === "string" && req.body.name.trim().length >= 2) {
    patch.name = req.body.name.trim().slice(0, 120);
  }
  if (isPlanCode(req.body?.planCode)) {
    const plan = PLANS[req.body.planCode];
    patch.planCode = plan.code;
    patch.branchLimit = plan.branchLimit;
  }
  if (typeof req.body?.subscriptionStatus === "string") {
    patch.subscriptionStatus = req.body.subscriptionStatus;
  }
  if (req.body?.extendDays) {
    const days = Number(req.body.extendDays);
    if (Number.isFinite(days) && days > 0) {
      const [cur] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id)).limit(1);
      const base = cur?.planExpiresAt && new Date(cur.planExpiresAt).getTime() > Date.now()
        ? new Date(cur.planExpiresAt)
        : new Date();
      patch.planExpiresAt = new Date(base.getTime() + days * 86400000);
      patch.subscriptionStatus = "active";
    }
  }
  if (req.body?.extendMonths) {
    const months = Number(req.body.extendMonths);
    if (Number.isFinite(months) && months > 0) {
      patch.planExpiresAt = new Date(Date.now() + months * PLAN_PERIOD_DAYS * 86400000);
      patch.subscriptionStatus = "active";
    }
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Oʻzgarish yoʻq." });
    return;
  }
  const [updated] = await db
    .update(organizationsTable)
    .set(patch)
    .where(eq(organizationsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Kompaniya topilmadi." });
    return;
  }
  res.json(publicOrganization(updated));
});

router.get("/platform/payments", async (_req, res): Promise<void> => {
  const rows = await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt)).limit(200);
  res.json(rows);
});

router.get("/platform/applications", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: appUsersTable.id,
      displayName: appUsersTable.displayName,
      email: appUsersTable.email,
      phone: appUsersTable.phone,
      companyName: appUsersTable.companyName,
      status: appUsersTable.status,
      signupMethod: appUsersTable.signupMethod,
      createdAt: appUsersTable.createdAt,
    })
    .from(appUsersTable)
    .where(eq(appUsersTable.status, "pending"))
    .orderBy(desc(appUsersTable.createdAt));
  res.json(rows);
});

router.post("/platform/applications/:id/approve", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Notoʻgʻri ID." });
    return;
  }
  const [target] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
  if (!target || target.status !== "pending") {
    res.status(404).json({ error: "Ariza topilmadi yoki allaqachon koʻrib chiqilgan." });
    return;
  }
  if (target.role === "platform_admin") {
    res.status(403).json({ error: "Platforma adminni shu yerda ochib boʻlmaydi." });
    return;
  }

  const seed =
    (target.displayName || "user")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 10) || "user";
  const username = await uniqueUsername(seed + String(target.phone || "").replace(/\D/g, "").slice(-4));
  const password = generatePassword();
  const company = (target.companyName || `${target.displayName} kompaniyasi`).slice(0, 120);

  const [activated] = await db
    .update(appUsersTable)
    .set({
      status: "active",
      role: "admin",
      username,
      passwordHash: await hashPassword(password),
      reviewedAt: new Date(),
      reviewedBy: Number(res.locals.appUserId) || null,
      emailVerifiedAt: target.emailVerifiedAt ?? new Date(),
    })
    .where(and(eq(appUsersTable.id, id), eq(appUsersTable.status, "pending")))
    .returning();

  if (!activated) {
    res.status(409).json({ error: "Arizani faollashtirib boʻlmadi." });
    return;
  }

  const org = await createOrganizationForOwner({
    name: company,
    ownerUserId: activated.id,
    planCode: "starter",
  });

  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: "application.approved",
    entityType: "user",
    entityId: String(activated.id),
    summary: `${activated.displayName} uchun Boshlangʻich 7 kunlik sinov ochildi · login ${username}`,
  });

  res.json({
    user: {
      id: activated.id,
      displayName: activated.displayName,
      email: activated.email,
      username,
      organizationId: org.id,
    },
    organization: publicOrganization(org),
    credentials: { username, password },
  });
});

router.post("/platform/applications/:id/reject", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Notoʻgʻri ID." });
    return;
  }
  const [updated] = await db
    .update(appUsersTable)
    .set({
      status: "rejected",
      reviewedAt: new Date(),
      reviewedBy: Number(res.locals.appUserId) || null,
    })
    .where(and(eq(appUsersTable.id, id), eq(appUsersTable.status, "pending")))
    .returning({ id: appUsersTable.id, displayName: appUsersTable.displayName, email: appUsersTable.email });
  if (!updated) {
    res.status(404).json({ error: "Ariza topilmadi." });
    return;
  }
  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: "application.rejected",
    entityType: "user",
    entityId: String(updated.id),
    summary: `${updated.displayName} arizasi rad etildi`,
  });
  res.json({ ok: true, user: updated });
});

router.get("/platform/organizations/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Notoʻgʻri ID." });
    return;
  }
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id)).limit(1);
  if (!org) {
    res.status(404).json({ error: "Kompaniya topilmadi." });
    return;
  }
  const [users, payments, owner] = await Promise.all([
    db
      .select(userPublicCols)
      .from(appUsersTable)
      .where(eq(appUsersTable.organizationId, id))
      .orderBy(asc(appUsersTable.id)),
    db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.organizationId, id))
      .orderBy(desc(paymentsTable.createdAt))
      .limit(100),
    org.ownerUserId
      ? db
          .select(userPublicCols)
          .from(appUsersTable)
          .where(eq(appUsersTable.id, org.ownerUserId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  res.json({
    organization: { ...publicOrganization(org), createdAt: org.createdAt },
    owner,
    users,
    payments,
  });
});

router.delete("/platform/organizations/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Notoʻgʻri ID." });
    return;
  }
  const hard = req.query.hard === "1" || req.body?.hard === true;
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id)).limit(1);
  if (!org) {
    res.status(404).json({ error: "Kompaniya topilmadi." });
    return;
  }

  await db
    .update(appUsersTable)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(and(eq(appUsersTable.organizationId, id), ne(appUsersTable.role, "platform_admin")));

  if (hard) {
    await db.delete(paymentsTable).where(eq(paymentsTable.organizationId, id));
    await db.delete(appUsersTable).where(eq(appUsersTable.organizationId, id));
    await db.delete(organizationsTable).where(eq(organizationsTable.id, id));
  } else {
    await db
      .update(organizationsTable)
      .set({ subscriptionStatus: "canceled", updatedAt: new Date() })
      .where(eq(organizationsTable.id, id));
  }

  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: hard ? "organization.deleted" : "organization.suspended",
    entityType: "organization",
    entityId: String(id),
    summary: hard ? `${org.name} butunlay oʻchirildi` : `${org.name} vaqtinchalik toʻxtatildi / bekor qilindi`,
  });
  res.json({ ok: true, hard });
});

router.post("/platform/organizations/:id/users", async (req, res): Promise<void> => {
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) {
    res.status(400).json({ error: "Notoʻgʻri kompaniya ID." });
    return;
  }
  const [org] = await db.select({ id: organizationsTable.id, name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, orgId)).limit(1);
  if (!org) {
    res.status(404).json({ error: "Kompaniya topilmadi." });
    return;
  }

  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const role = req.body?.role as (typeof ORG_USER_ROLES)[number] | undefined;
  if (displayName.length < 2) {
    res.status(400).json({ error: "Ism kamida 2 belgidan iborat boʻlsin." });
    return;
  }
  if (!role || !ORG_USER_ROLES.includes(role)) {
    res.status(400).json({ error: "Rol: admin, finance yoki viewer." });
    return;
  }

  const seed =
    displayName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 10) || "user";
  const username = await uniqueUsername(seed + phone.replace(/\D/g, "").slice(-4));
  const password = generatePassword();

  try {
    const [created] = await db
      .insert(appUsersTable)
      .values({
        clerkUserId: `local:${username}`,
        displayName,
        username,
        phone,
        email: "",
        role,
        organizationId: orgId,
        status: "active",
        signupMethod: "admin",
        passwordHash: await hashPassword(password),
        reviewedAt: new Date(),
        reviewedBy: Number(res.locals.appUserId) || null,
      })
      .returning();

    await db.insert(auditLogTable).values({
      actorId: String(res.locals.userId),
      action: "platform.user.created",
      entityType: "user",
      entityId: String(created!.id),
      summary: `${org.name}: ${displayName} yaratildi · ${username} · ${role}`,
    });

    const [row] = await db.select(userPublicCols).from(appUsersTable).where(eq(appUsersTable.id, created!.id)).limit(1);
    res.status(201).json({ user: row, credentials: { username, password } });
  } catch {
    res.status(409).json({ error: "Foydalanuvchini yaratib boʻlmadi." });
  }
});

router.patch("/platform/users/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Notoʻgʻri ID." });
    return;
  }
  const [target] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
  if (!target || target.role === "platform_admin") {
    res.status(404).json({ error: "Foydalanuvchi topilmadi." });
    return;
  }

  const patch: Partial<typeof appUsersTable.$inferInsert> = { updatedAt: new Date() };
  if (typeof req.body?.displayName === "string" && req.body.displayName.trim().length >= 2) {
    patch.displayName = req.body.displayName.trim();
  }
  if (typeof req.body?.phone === "string") patch.phone = req.body.phone.trim();
  if (typeof req.body?.role === "string" && ORG_USER_ROLES.includes(req.body.role)) patch.role = req.body.role;
  if (typeof req.body?.status === "string" && USER_STATUSES.includes(req.body.status)) patch.status = req.body.status;

  if (Object.keys(patch).length <= 1) {
    res.status(400).json({ error: "Oʻzgarish yoʻq." });
    return;
  }

  if (target.role === "admin" && target.status === "active" && target.organizationId != null) {
    const losing =
      (patch.role && patch.role !== "admin") || (patch.status && patch.status !== "active");
    if (losing) {
      const [other] = await db
        .select({ id: appUsersTable.id })
        .from(appUsersTable)
        .where(
          and(
            eq(appUsersTable.organizationId, target.organizationId),
            eq(appUsersTable.role, "admin"),
            eq(appUsersTable.status, "active"),
            ne(appUsersTable.id, id),
          ),
        )
        .limit(1);
      if (!other) {
        res.status(409).json({ error: "Kompaniyada kamida bitta faol admin qolishi kerak." });
        return;
      }
    }
  }

  const [updated] = await db.update(appUsersTable).set(patch).where(eq(appUsersTable.id, id)).returning();
  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: "platform.user.updated",
    entityType: "user",
    entityId: String(id),
    summary: `${target.displayName} yangilandi`,
  });
  const [row] = await db.select(userPublicCols).from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
  res.json({ user: row ?? updated });
});

router.post("/platform/users/:id/reset-password", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Notoʻgʻri ID." });
    return;
  }
  const [target] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
  if (!target || target.role === "platform_admin" || !target.username) {
    res.status(404).json({ error: "Foydalanuvchi topilmadi yoki login yoʻq." });
    return;
  }
  const password = generatePassword();
  await db
    .update(appUsersTable)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(appUsersTable.id, id));
  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: "platform.user.password_reset",
    entityType: "user",
    entityId: String(id),
    summary: `${target.displayName} paroli yangilandi`,
  });
  res.json({ credentials: { username: target.username, password } });
});

router.delete("/platform/users/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Notoʻgʻri ID." });
    return;
  }
  const [target] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
  if (!target || target.role === "platform_admin") {
    res.status(404).json({ error: "Foydalanuvchi topilmadi." });
    return;
  }
  if (target.role === "admin" && target.status === "active" && target.organizationId != null) {
    const [other] = await db
      .select({ id: appUsersTable.id })
      .from(appUsersTable)
      .where(
        and(
          eq(appUsersTable.organizationId, target.organizationId),
          eq(appUsersTable.role, "admin"),
          eq(appUsersTable.status, "active"),
          ne(appUsersTable.id, id),
        ),
      )
      .limit(1);
    if (!other) {
      res.status(409).json({ error: "Oxirgi faol adminni oʻchirib boʻlmaydi." });
      return;
    }
  }
  await db.delete(appUsersTable).where(eq(appUsersTable.id, id));
  await db.insert(auditLogTable).values({
    actorId: String(res.locals.userId),
    action: "platform.user.deleted",
    entityType: "user",
    entityId: String(id),
    summary: `${target.displayName} oʻchirildi`,
  });
  res.json({ ok: true });
});

router.get("/platform/directory", async (_req, res): Promise<void> => {
  const orgs = await db.select().from(organizationsTable).orderBy(desc(organizationsTable.createdAt));
  const users = await db
    .select(userPublicCols)
    .from(appUsersTable)
    .where(sql`${appUsersTable.role} <> 'platform_admin'`)
    .orderBy(asc(appUsersTable.organizationId), asc(appUsersTable.id));
  const payments = await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt)).limit(300);
  const owners = new Map(users.map((u) => [u.id, u]));
  const usersByOrg = new Map<number, typeof users>();
  for (const u of users) {
    if (u.organizationId == null) continue;
    const list = usersByOrg.get(u.organizationId) ?? [];
    list.push(u);
    usersByOrg.set(u.organizationId, list);
  }
  const paysByOrg = new Map<number, typeof payments>();
  for (const p of payments) {
    const list = paysByOrg.get(p.organizationId) ?? [];
    list.push(p);
    paysByOrg.set(p.organizationId, list);
  }
  res.json({
    companies: orgs.map((o) => ({
      ...publicOrganization(o),
      createdAt: o.createdAt,
      owner: o.ownerUserId ? owners.get(o.ownerUserId) ?? null : null,
      users: usersByOrg.get(o.id) ?? [],
      payments: paysByOrg.get(o.id) ?? [],
      userCount: (usersByOrg.get(o.id) ?? []).length,
      paidTotal: (paysByOrg.get(o.id) ?? []).filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0),
    })),
  });
});

export default router;
