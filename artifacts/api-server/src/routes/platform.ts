import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, organizationsTable, paymentsTable, appUsersTable } from "@workspace/db";
import { requirePlatformAdmin } from "../middlewares/requireClerkUser";
import { PLANS, PLAN_PERIOD_DAYS, isPlanCode, planList } from "../lib/plans";
import { publicOrganization } from "../lib/org";

const router: IRouter = Router();

router.use(requirePlatformAdmin);

router.get("/platform/overview", async (_req, res): Promise<void> => {
  const orgs = await db.select().from(organizationsTable).orderBy(desc(organizationsTable.createdAt)).limit(200);
  const payments = await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt)).limit(100);
  const paid = payments.filter((p) => p.status === "paid");
  res.json({
    companies: orgs.length,
    activePaid: orgs.filter((o) => o.subscriptionStatus === "active").length,
    trialing: orgs.filter((o) => o.subscriptionStatus === "trialing").length,
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

export default router;
