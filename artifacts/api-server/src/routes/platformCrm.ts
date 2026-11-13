import { and, count, desc, eq, gte, ilike, lte, ne, or, sql, type SQL } from "drizzle-orm";
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
/** Only gate /platform/crm/* — do not block later company routers (branches, fom, …). */
router.use((req, res, next) => {
  if (!req.path.startsWith("/platform")) {
    next("router");
    return;
  }
  requirePlatformAdmin(req, res, next);
});

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

  const recentOrgs = [...orgs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);
  const recentCompanyItems = [];
  for (const o of recentOrgs) {
    const pub = publicOrganization(o)!;
    const [owner] = o.ownerUserId
      ? await db
          .select({
            id: appUsersTable.id,
            displayName: appUsersTable.displayName,
          })
          .from(appUsersTable)
          .where(eq(appUsersTable.id, o.ownerUserId))
          .limit(1)
      : [null];
    const [uc] = await db
      .select({ n: count() })
      .from(appUsersTable)
      .where(eq(appUsersTable.organizationId, o.id));
    const [bc] = await db
      .select({ n: count() })
      .from(branchesTable)
      .where(eq(branchesTable.organizationId, o.id));
    const payRows = await db
      .select({ status: paymentsTable.status, amount: paymentsTable.amount })
      .from(paymentsTable)
      .where(eq(paymentsTable.organizationId, o.id));
    const pendingPay = payRows
      .filter((p) => p.status === "pending" || p.status === "prepared")
      .reduce((s, p) => s + p.amount, 0);
    recentCompanyItems.push({
      id: o.id,
      name: o.name,
      planCode: pub.planCode,
      planName: pub.planName,
      subscriptionStatus: pub.subscriptionStatus,
      endsAt: pub.endsAt,
      daysLeft: pub.daysLeft,
      ownerName: owner?.displayName || null,
      userCount: Number(uc?.n || 0),
      branchCount: Number(bc?.n || 0),
      pendingAmount: pendingPay,
      createdAt: o.createdAt,
    });
  }

  const recentApps = await db
    .select({
      id: appUsersTable.id,
      displayName: appUsersTable.displayName,
      companyName: appUsersTable.companyName,
      status: appUsersTable.status,
      phone: appUsersTable.phone,
      createdAt: appUsersTable.createdAt,
    })
    .from(appUsersTable)
    .where(and(ne(appUsersTable.role, "platform_admin"), eq(appUsersTable.status, "pending")))
    .orderBy(desc(appUsersTable.createdAt))
    .limit(6);

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
    recentCompanies: recentCompanyItems,
    recentApplications: recentApps.map((a) => ({
      ...a,
      typeLabel: "Yangi kompaniya arizasi",
      ref: `ARZ-${String(a.id).padStart(3, "0")}`,
    })),
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
      ref: `ARZ-${String(r.id).padStart(3, "0")}`,
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

router.get("/platform/crm/users", async (req, res): Promise<void> => {
  const { page, pageSize, offset } = pageParams(req.query as Record<string, unknown>);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const role = typeof req.query.role === "string" ? req.query.role : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const organizationId = Number(req.query.organizationId);

  const conds: SQL[] = [ne(appUsersTable.role, "platform_admin")];
  if (role) conds.push(eq(appUsersTable.role, role));
  if (status) conds.push(eq(appUsersTable.status, status));
  if (Number.isFinite(organizationId) && organizationId > 0) {
    conds.push(eq(appUsersTable.organizationId, organizationId));
  }
  if (q) {
    const like = `%${q}%`;
    conds.push(
      or(
        ilike(appUsersTable.displayName, like),
        ilike(appUsersTable.email, like),
        ilike(appUsersTable.phone, like),
        ilike(appUsersTable.username, like),
        ilike(appUsersTable.companyName, like),
      )!,
    );
  }
  const where = and(...conds);
  const [totalRow] = await db.select({ n: count() }).from(appUsersTable).where(where);
  const rows = await db
    .select({
      ...userPublicCols,
      companyName: appUsersTable.companyName,
      orgName: organizationsTable.name,
    })
    .from(appUsersTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, appUsersTable.organizationId))
    .where(where)
    .orderBy(desc(appUsersTable.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [activeN] = await db
    .select({ n: count() })
    .from(appUsersTable)
    .where(and(ne(appUsersTable.role, "platform_admin"), eq(appUsersTable.status, "active")));
  const [pendingN] = await db
    .select({ n: count() })
    .from(appUsersTable)
    .where(and(ne(appUsersTable.role, "platform_admin"), eq(appUsersTable.status, "pending")));
  const [disabledN] = await db
    .select({ n: count() })
    .from(appUsersTable)
    .where(and(ne(appUsersTable.role, "platform_admin"), eq(appUsersTable.status, "disabled")));

  res.json({
    items: rows,
    total: Number(totalRow?.n || 0),
    page,
    pageSize,
    stats: {
      total: Number(totalRow?.n || 0),
      active: Number(activeN?.n || 0),
      pending: Number(pendingN?.n || 0),
      disabled: Number(disabledN?.n || 0),
    },
  });
});

router.get("/platform/crm/audit", async (req, res): Promise<void> => {
  const { page, pageSize, offset } = pageParams(req.query as Record<string, unknown>);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const action = typeof req.query.action === "string" ? req.query.action.trim() : "";
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType.trim() : "";

  const conds: SQL[] = [];
  if (action) conds.push(ilike(auditLogTable.action, `%${action}%`));
  if (entityType) conds.push(eq(auditLogTable.entityType, entityType));
  if (q) {
    const like = `%${q}%`;
    conds.push(
      or(
        ilike(auditLogTable.summary, like),
        ilike(auditLogTable.action, like),
        ilike(auditLogTable.actorId, like),
        ilike(auditLogTable.entityId, like),
      )!,
    );
  }
  const where = conds.length ? and(...conds) : undefined;
  const [totalRow] = await db.select({ n: count() }).from(auditLogTable).where(where);
  const items = await db
    .select()
    .from(auditLogTable)
    .where(where)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(pageSize)
    .offset(offset);

  res.json({
    items,
    total: Number(totalRow?.n || 0),
    page,
    pageSize,
  });
});

router.get("/platform/crm/alerts", async (_req, res): Promise<void> => {
  const items: Array<{
    id: string;
    kind: string;
    tone: "info" | "warn" | "danger" | "ok";
    title: string;
    text: string;
    href: string;
    createdAt: string;
  }> = [];

  const pendingApps = await db
    .select({
      id: appUsersTable.id,
      displayName: appUsersTable.displayName,
      companyName: appUsersTable.companyName,
      createdAt: appUsersTable.createdAt,
    })
    .from(appUsersTable)
    .where(and(eq(appUsersTable.status, "pending"), ne(appUsersTable.role, "platform_admin")))
    .orderBy(desc(appUsersTable.createdAt))
    .limit(20);
  for (const a of pendingApps) {
    items.push({
      id: `app-${a.id}`,
      kind: "application",
      tone: "warn",
      title: "Yangi ariza",
      text: `${a.companyName || a.displayName} — tasdiq kutmoqda`,
      href: "/owner/requests?status=pending",
      createdAt: new Date(a.createdAt).toISOString(),
    });
  }

  const orgs = await db.select().from(organizationsTable);
  for (const o of orgs) {
    const pub = publicOrganization(o)!;
    if (pub.daysLeft != null && pub.daysLeft > 0 && pub.daysLeft <= 7) {
      items.push({
        id: `end-${o.id}`,
        kind: "subscription",
        tone: "warn",
        title: "Obuna tugash arafasida",
        text: `${o.name} — ${pub.daysLeft} kun qoldi`,
        href: `/owner/companies/${o.id}`,
        createdAt: new Date().toISOString(),
      });
    }
    if (pub.subscriptionStatus === "past_due") {
      items.push({
        id: `due-${o.id}`,
        kind: "subscription",
        tone: "danger",
        title: "Muddati tugagan",
        text: `${o.name} — toʻlov talab qilinadi`,
        href: `/owner/companies/${o.id}`,
        createdAt: new Date().toISOString(),
      });
    }
    if (pub.subscriptionStatus === "canceled") {
      items.push({
        id: `block-${o.id}`,
        kind: "subscription",
        tone: "danger",
        title: "Bloklangan kompaniya",
        text: `${o.name} cheklangan`,
        href: `/owner/companies/${o.id}`,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const failed = await db
    .select({
      id: paymentsTable.id,
      amount: paymentsTable.amount,
      organizationId: paymentsTable.organizationId,
      createdAt: paymentsTable.createdAt,
      orgName: organizationsTable.name,
    })
    .from(paymentsTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, paymentsTable.organizationId))
    .where(eq(paymentsTable.status, "failed"))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(15);
  for (const p of failed) {
    items.push({
      id: `pay-${p.id}`,
      kind: "payment",
      tone: "danger",
      title: "Muvaffaqiyatsiz toʻlov",
      text: `${p.orgName || "Kompaniya"} — ${Math.round(p.amount).toLocaleString("uz-UZ")} soʻm`,
      href: `/owner/payments?q=${p.id}`,
      createdAt: new Date(p.createdAt).toISOString(),
    });
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({
    items: items.slice(0, 50),
    unread: items.length,
  });
});

router.get("/platform/crm/plans", async (_req, res): Promise<void> => {
  const orgs = await db.select({ planCode: organizationsTable.planCode }).from(organizationsTable);
  const byPlan = new Map<string, number>();
  for (const o of orgs) byPlan.set(o.planCode, (byPlan.get(o.planCode) || 0) + 1);
  const plans = planList().map((p) => ({
    ...p,
    companies: byPlan.get(p.code) || 0,
  }));
  res.json({ items: plans, totalCompanies: orgs.length });
});

router.get("/platform/crm/reports", async (_req, res): Promise<void> => {
  const dashRes = await (async () => {
    // Reuse core aggregates without HTTP round-trip
    const orgs = await db.select().from(organizationsTable);
    const payments = await db.select().from(paymentsTable);
    const now = Date.now();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let paidMonth = 0;
    let paidAll = 0;
    let pending = 0;
    let failed = 0;
    const byPlanRevenue = new Map<string, number>();
    for (const p of payments) {
      if (p.status === "paid") {
        paidAll += p.amount;
        const when = p.paidAt ? new Date(p.paidAt) : new Date(p.createdAt);
        if (when >= monthStart) paidMonth += p.amount;
        byPlanRevenue.set(p.planCode, (byPlanRevenue.get(p.planCode) || 0) + p.amount);
      } else if (p.status === "pending" || p.status === "prepared") pending += p.amount;
      else if (p.status === "failed") failed += 1;
    }
    let active = 0;
    let pastDue = 0;
    for (const o of orgs) {
      const pub = publicOrganization(o)!;
      if (pub.subscriptionStatus === "active") active += 1;
      if (pub.subscriptionStatus === "past_due") pastDue += 1;
    }
    const [users] = await db
      .select({ n: count() })
      .from(appUsersTable)
      .where(ne(appUsersTable.role, "platform_admin"));
    const [branches] = await db.select({ n: count() }).from(branchesTable);
    return {
      summary: {
        companies: orgs.length,
        active,
        pastDue,
        users: Number(users?.n || 0),
        branches: Number(branches?.n || 0),
        revenueAll: paidAll,
        revenueMonth: paidMonth,
        pendingAmount: pending,
        failedPayments: failed,
        debtCompanies: pastDue,
        generatedAt: new Date(now).toISOString(),
      },
      revenueByPlan: [...byPlanRevenue.entries()].map(([code, amount]) => ({
        code,
        name: isPlanCode(code) ? PLANS[code].name : code,
        amount,
      })),
    };
  })();
  res.json(dashRes);
});

export default router;
