import { and, asc, count, desc, eq, gte, ilike, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  appUsersTable,
  auditLogTable,
  branchesTable,
  db,
  organizationsTable,
  paymentsTable,
} from "@workspace/db";
import { requirePlatformAdmin } from "../middlewares/requireClerkUser";
import { publicOrganization } from "../lib/org";
import { PLANS, isPlanCode, planList } from "../lib/plans";

const router: IRouter = Router();
router.use(requirePlatformAdmin);

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

function pageParams(q: Record<string, unknown>) {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

router.get("/platform/crm/dashboard", async (_req, res): Promise<void> => {
  const orgs = await db.select().from(organizationsTable);
  const now = Date.now();
  let active = 0;
  let trialing = 0;
  let pastDue = 0;
  let canceled = 0;
  let endingSoon = 0;
  for (const o of orgs) {
    const pub = publicOrganization(o)!;
    if (pub.subscriptionStatus === "active") active += 1;
    else if (pub.subscriptionStatus === "trialing") trialing += 1;
    else if (pub.subscriptionStatus === "past_due") pastDue += 1;
    else if (pub.subscriptionStatus === "canceled") canceled += 1;
    if (pub.daysLeft != null && pub.daysLeft > 0 && pub.daysLeft <= 7) endingSoon += 1;
  }

  const [userCount] = await db
    .select({ n: count() })
    .from(appUsersTable)
    .where(ne(appUsersTable.role, "platform_admin"));
  const [branchCount] = await db.select({ n: count() }).from(branchesTable);
  const [pendingApps] = await db
    .select({ n: count() })
    .from(appUsersTable)
    .where(eq(appUsersTable.status, "pending"));

  const paidRows = await db
    .select({
      amount: paymentsTable.amount,
      paidAt: paymentsTable.paidAt,
      createdAt: paymentsTable.createdAt,
      status: paymentsTable.status,
    })
    .from(paymentsTable);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
  const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
  const startOfPrevMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth() - 1, 1);
  const endOfPrevMonth = new Date(startOfMonth.getTime() - 1);
  const day30 = new Date(now - 30 * 86400000);

  let revenuePaid = 0;
  let pendingAmount = 0;
  let failedCount = 0;
  let canceledPayCount = 0;
  let todayRevenue = 0;
  let weekRevenue = 0;
  let monthRevenue = 0;
  let prevMonthRevenue = 0;
  const revenueByDay = new Map<string, number>();
  const byPlan = new Map<string, number>();
  const byStatus = new Map<string, number>();

  for (const p of paidRows) {
    byStatus.set(p.status, (byStatus.get(p.status) || 0) + 1);
    if (p.status === "paid") {
      revenuePaid += p.amount;
      const when = p.paidAt ? new Date(p.paidAt) : new Date(p.createdAt);
      if (when >= startOfDay) todayRevenue += p.amount;
      if (when >= startOfWeek) weekRevenue += p.amount;
      if (when >= startOfMonth) monthRevenue += p.amount;
      if (when >= startOfPrevMonth && when <= endOfPrevMonth) prevMonthRevenue += p.amount;
      if (when >= day30) {
        const key = when.toISOString().slice(0, 10);
        revenueByDay.set(key, (revenueByDay.get(key) || 0) + p.amount);
      }
    } else if (p.status === "pending" || p.status === "prepared") {
      pendingAmount += p.amount;
    } else if (p.status === "failed") {
      failedCount += 1;
    } else if (p.status === "canceled") {
      canceledPayCount += 1;
    }
  }

  for (const o of orgs) {
    byPlan.set(o.planCode, (byPlan.get(o.planCode) || 0) + 1);
  }

  const last30: { date: string; amount: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    last30.push({ date: d, amount: revenueByDay.get(d) || 0 });
  }

  res.json({
    kpis: {
      companies: orgs.length,
      active,
      trialing,
      pastDue,
      canceled,
      endingSoon,
      users: Number(userCount?.n || 0),
      branches: Number(branchCount?.n || 0),
      pendingApplications: Number(pendingApps?.n || 0),
      revenuePaid,
      pendingAmount,
      failedPayments: failedCount,
      canceledPayments: canceledPayCount,
      todayRevenue,
      weekRevenue,
      monthRevenue,
      prevMonthRevenue,
    },
    charts: {
      revenueLast30: last30,
      planDistribution: [...byPlan.entries()].map(([code, value]) => ({
        code,
        name: isPlanCode(code) ? PLANS[code].name : code,
        value,
      })),
      paymentStatuses: [...byStatus.entries()].map(([status, value]) => ({ status, value })),
    },
    plans: planList(),
  });
});

router.get("/platform/crm/companies", async (req, res): Promise<void> => {
  const { page, pageSize, offset } = pageParams(req.query as Record<string, unknown>);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const planCode = typeof req.query.planCode === "string" ? req.query.planCode : "";
  const endingSoon = req.query.endingSoon === "1";

  const orgs = await db.select().from(organizationsTable).orderBy(desc(organizationsTable.createdAt));
  const owners = await db.select(userPublicCols).from(appUsersTable);
  const ownerById = new Map(owners.map((u) => [u.id, u]));

  const userCounts = await db
    .select({
      organizationId: appUsersTable.organizationId,
      n: count(),
    })
    .from(appUsersTable)
    .where(and(ne(appUsersTable.role, "platform_admin"), sql`${appUsersTable.organizationId} IS NOT NULL`))
    .groupBy(appUsersTable.organizationId);
  const userCountMap = new Map(userCounts.map((r) => [r.organizationId!, Number(r.n)]));

  const branchCounts = await db
    .select({ organizationId: branchesTable.organizationId, n: count() })
    .from(branchesTable)
    .where(sql`${branchesTable.organizationId} IS NOT NULL`)
    .groupBy(branchesTable.organizationId);
  const branchCountMap = new Map(branchCounts.map((r) => [r.organizationId!, Number(r.n)]));

  const paidAgg = await db
    .select({
      organizationId: paymentsTable.organizationId,
      paidTotal: sql<number>`coalesce(sum(case when ${paymentsTable.status} = 'paid' then ${paymentsTable.amount} else 0 end), 0)`,
      lastPaidAt: sql<Date | null>`max(${paymentsTable.paidAt})`,
      pendingTotal: sql<number>`coalesce(sum(case when ${paymentsTable.status} in ('pending','prepared') then ${paymentsTable.amount} else 0 end), 0)`,
    })
    .from(paymentsTable)
    .groupBy(paymentsTable.organizationId);
  const payMap = new Map(paidAgg.map((r) => [r.organizationId, r]));

  let rows = orgs.map((o) => {
    const pub = publicOrganization(o)!;
    const owner = o.ownerUserId ? ownerById.get(o.ownerUserId) ?? null : null;
    const pay = payMap.get(o.id);
    return {
      ...pub,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      owner,
      userCount: userCountMap.get(o.id) || 0,
      branchCount: branchCountMap.get(o.id) || 0,
      paidTotal: Number(pay?.paidTotal || 0),
      pendingTotal: Number(pay?.pendingTotal || 0),
      lastPaidAt: pay?.lastPaidAt ? new Date(pay.lastPaidAt).toISOString() : null,
      lastActivityAt: owner?.lastLoginAt || o.updatedAt,
      paymentStatus:
        Number(pay?.pendingTotal || 0) > 0
          ? "pending"
          : Number(pay?.paidTotal || 0) > 0
            ? "paid"
            : "none",
    };
  });

  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => {
      const hay = [
        String(r.id),
        r.name,
        r.owner?.displayName,
        r.owner?.email,
        r.owner?.phone,
        r.owner?.username,
        r.planName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }
  if (status) rows = rows.filter((r) => r.subscriptionStatus === status);
  if (planCode) rows = rows.filter((r) => r.planCode === planCode);
  if (endingSoon) {
    rows = rows.filter((r) => r.daysLeft != null && r.daysLeft > 0 && r.daysLeft <= 7);
  }

  const total = rows.length;
  const items = rows.slice(offset, offset + pageSize);

  const stats = {
    total: orgs.length,
    active: rows.filter((r) => r.subscriptionStatus === "active").length,
    trialing: rows.filter((r) => r.subscriptionStatus === "trialing").length,
    pastDue: rows.filter((r) => r.subscriptionStatus === "past_due").length,
    canceled: rows.filter((r) => r.subscriptionStatus === "canceled").length,
    endingSoon: rows.filter((r) => r.daysLeft != null && r.daysLeft > 0 && r.daysLeft <= 7).length,
    withPendingPay: rows.filter((r) => r.pendingTotal > 0).length,
  };

  res.json({ items, total, page, pageSize, stats });
});

router.get("/platform/crm/companies/:id", async (req, res): Promise<void> => {
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

  const [users, payments, branches, owner, audit] = await Promise.all([
    db.select(userPublicCols).from(appUsersTable).where(eq(appUsersTable.organizationId, id)).orderBy(asc(appUsersTable.id)),
    db.select().from(paymentsTable).where(eq(paymentsTable.organizationId, id)).orderBy(desc(paymentsTable.createdAt)).limit(200),
    db.select().from(branchesTable).where(eq(branchesTable.organizationId, id)).orderBy(asc(branchesTable.id)),
    org.ownerUserId
      ? db.select(userPublicCols).from(appUsersTable).where(eq(appUsersTable.id, org.ownerUserId)).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select()
      .from(auditLogTable)
      .where(and(eq(auditLogTable.entityType, "organization"), eq(auditLogTable.entityId, String(id))))
      .orderBy(desc(auditLogTable.createdAt))
      .limit(100),
  ]);

  const paidTotal = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const pendingTotal = payments
    .filter((p) => p.status === "pending" || p.status === "prepared")
    .reduce((s, p) => s + p.amount, 0);

  res.json({
    organization: { ...publicOrganization(org), createdAt: org.createdAt, updatedAt: org.updatedAt },
    owner,
    users,
    payments,
    branches: branches.map((b) => ({
      id: b.id,
      name: b.name,
      region: b.region,
      address: b.address,
      manager: b.manager,
      status: b.status,
      fomId: b.fomId,
      kind: b.kind,
      updatedAt: b.updatedAt,
    })),
    audit,
    totals: {
      paidTotal,
      pendingTotal,
      userCount: users.length,
      branchCount: branches.length,
      activeBranches: branches.filter((b) => b.status === "active").length,
    },
    plans: planList(),
  });
});

router.get("/platform/crm/payments", async (req, res): Promise<void> => {
  const { page, pageSize, offset } = pageParams(req.query as Record<string, unknown>);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const planCode = typeof req.query.planCode === "string" ? req.query.planCode : "";
  const orgId = req.query.organizationId ? Number(req.query.organizationId) : null;
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";

  const conds: SQL[] = [];
  if (status) conds.push(eq(paymentsTable.status, status));
  if (planCode) conds.push(eq(paymentsTable.planCode, planCode));
  if (orgId && Number.isFinite(orgId)) conds.push(eq(paymentsTable.organizationId, orgId));
  if (dateFrom) conds.push(gte(paymentsTable.createdAt, new Date(`${dateFrom}T00:00:00`)));
  if (dateTo) conds.push(lte(paymentsTable.createdAt, new Date(`${dateTo}T23:59:59`)));
  if (q) {
    const like = `%${q}%`;
    conds.push(
      or(
        ilike(paymentsTable.merchantTransId, like),
        ilike(paymentsTable.clickTransId, like),
        ilike(organizationsTable.name, like),
        sql`cast(${paymentsTable.id} as text) ilike ${like}`,
        sql`cast(${paymentsTable.organizationId} as text) ilike ${like}`,
      )!,
    );
  }

  const where = conds.length ? and(...conds) : undefined;

  const [totalRow] = await db
    .select({ n: count() })
    .from(paymentsTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, paymentsTable.organizationId))
    .where(where);

  const items = await db
    .select({
      id: paymentsTable.id,
      organizationId: paymentsTable.organizationId,
      organizationName: organizationsTable.name,
      planCode: paymentsTable.planCode,
      amount: paymentsTable.amount,
      currency: paymentsTable.currency,
      status: paymentsTable.status,
      merchantTransId: paymentsTable.merchantTransId,
      prepareId: paymentsTable.prepareId,
      clickTransId: paymentsTable.clickTransId,
      clickPaydocId: paymentsTable.clickPaydocId,
      errorNote: paymentsTable.errorNote,
      paidAt: paymentsTable.paidAt,
      createdAt: paymentsTable.createdAt,
      updatedAt: paymentsTable.updatedAt,
    })
    .from(paymentsTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, paymentsTable.organizationId))
    .where(where)
    .orderBy(desc(paymentsTable.createdAt))
    .limit(pageSize)
    .offset(offset);

  const allForStats = await db
    .select({ status: paymentsTable.status, amount: paymentsTable.amount })
    .from(paymentsTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, paymentsTable.organizationId))
    .where(where);

  const stats = {
    total: Number(totalRow?.n || 0),
    paidAmount: allForStats.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0),
    pendingAmount: allForStats
      .filter((p) => p.status === "pending" || p.status === "prepared")
      .reduce((s, p) => s + p.amount, 0),
    failedCount: allForStats.filter((p) => p.status === "failed").length,
    canceledCount: allForStats.filter((p) => p.status === "canceled").length,
    paidCount: allForStats.filter((p) => p.status === "paid").length,
  };

  res.json({
    items: items.map((p) => ({
      ...p,
      planName: isPlanCode(p.planCode) ? PLANS[p.planCode].name : p.planCode,
      provider: "Click",
      method: "click",
    })),
    total: Number(totalRow?.n || 0),
    page,
    pageSize,
    stats,
  });
});

router.get("/platform/crm/payments/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Notoʻgʻri ID." });
    return;
  }
  const [row] = await db
    .select({
      id: paymentsTable.id,
      organizationId: paymentsTable.organizationId,
      organizationName: organizationsTable.name,
      planCode: paymentsTable.planCode,
      amount: paymentsTable.amount,
      currency: paymentsTable.currency,
      status: paymentsTable.status,
      merchantTransId: paymentsTable.merchantTransId,
      prepareId: paymentsTable.prepareId,
      clickTransId: paymentsTable.clickTransId,
      clickPaydocId: paymentsTable.clickPaydocId,
      errorNote: paymentsTable.errorNote,
      paidAt: paymentsTable.paidAt,
      createdAt: paymentsTable.createdAt,
      updatedAt: paymentsTable.updatedAt,
    })
    .from(paymentsTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, paymentsTable.organizationId))
    .where(eq(paymentsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Toʻlov topilmadi." });
    return;
  }
  res.json({
    payment: {
      ...row,
      planName: isPlanCode(row.planCode) ? PLANS[row.planCode].name : row.planCode,
      provider: "Click",
      method: "click",
    },
  });
});

router.get("/platform/crm/applications", async (req, res): Promise<void> => {
  const { page, pageSize, offset } = pageParams(req.query as Record<string, unknown>);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";

  const conds: SQL[] = [
    or(eq(appUsersTable.signupMethod, "request"), eq(appUsersTable.status, "pending"))!,
    ne(appUsersTable.role, "platform_admin"),
  ];
  if (status) conds.push(eq(appUsersTable.status, status));
  if (q) {
    const like = `%${q}%`;
    conds.push(
      or(
        ilike(appUsersTable.displayName, like),
        ilike(appUsersTable.email, like),
        ilike(appUsersTable.phone, like),
        ilike(appUsersTable.companyName, like),
      )!,
    );
  }

  const where = and(...conds);
  const [totalRow] = await db.select({ n: count() }).from(appUsersTable).where(where);
  const items = await db
    .select({
      id: appUsersTable.id,
      displayName: appUsersTable.displayName,
      email: appUsersTable.email,
      phone: appUsersTable.phone,
      companyName: appUsersTable.companyName,
      status: appUsersTable.status,
      signupMethod: appUsersTable.signupMethod,
      organizationId: appUsersTable.organizationId,
      reviewedAt: appUsersTable.reviewedAt,
      createdAt: appUsersTable.createdAt,
      updatedAt: appUsersTable.updatedAt,
    })
    .from(appUsersTable)
    .where(where)
    .orderBy(desc(appUsersTable.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [pendingN] = await db
    .select({ n: count() })
    .from(appUsersTable)
    .where(and(eq(appUsersTable.status, "pending"), ne(appUsersTable.role, "platform_admin")));

  res.json({
    items: items.map((r) => ({
      ...r,
      type: "new_company",
      typeLabel: "Yangi kompaniya arizasi",
      priority: r.status === "pending" ? "high" : "normal",
    })),
    total: Number(totalRow?.n || 0),
    page,
    pageSize,
    stats: {
      pending: Number(pendingN?.n || 0),
      total: Number(totalRow?.n || 0),
    },
  });
});

export default router;
