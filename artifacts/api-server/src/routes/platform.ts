import { randomInt } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, organizationsTable, paymentsTable, appUsersTable, auditLogTable } from "@workspace/db";
import { requirePlatformAdmin } from "../middlewares/requireClerkUser";
import { PLANS, PLAN_PERIOD_DAYS, isPlanCode, planList } from "../lib/plans";
import { createOrganizationForOwner, publicOrganization } from "../lib/org";
import { hashPassword } from "../lib/localAuth";

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
    summary: `${activated.displayName} uchun Starter 7 kunlik sinov ochildi · login ${username}`,
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

export default router;
