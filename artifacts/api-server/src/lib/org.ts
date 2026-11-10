import { and, count, eq, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import {
  appUsersTable,
  branchesTable,
  db,
  organizationsTable,
  type Organization,
} from "@workspace/db";
import { PLANS, TRIAL_DAYS, type PlanCode, isPlanCode } from "./plans";

export type OrgContext = {
  organizationId: number | null;
  organization: Organization | null;
  isPlatformAdmin: boolean;
  canWrite: boolean;
};

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "kompaniya";
}

export async function uniqueOrgSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const [existing] = await db
      .select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(eq(organizationsTable.slug, slug))
      .limit(1);
    if (!existing) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function createOrganizationForOwner(opts: {
  name: string;
  ownerUserId: number;
  planCode?: PlanCode;
}): Promise<Organization> {
  const plan = PLANS[opts.planCode ?? "starter"];
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const slug = await uniqueOrgSlug(opts.name);
  const [org] = await db
    .insert(organizationsTable)
    .values({
      name: opts.name.trim() || "Yangi kompaniya",
      slug,
      ownerUserId: opts.ownerUserId,
      planCode: plan.code,
      subscriptionStatus: "trialing",
      trialEndsAt,
      planExpiresAt: null,
      branchLimit: plan.branchLimit,
    })
    .returning();
  await db
    .update(appUsersTable)
    .set({ organizationId: org.id, role: "admin" })
    .where(eq(appUsersTable.id, opts.ownerUserId));
  return org;
}

export function publicOrganization(org: Organization | null) {
  if (!org) return null;
  const now = Date.now();
  const trialEnds = org.trialEndsAt ? new Date(org.trialEndsAt).getTime() : null;
  const planEnds = org.planExpiresAt ? new Date(org.planExpiresAt).getTime() : null;
  let status = org.subscriptionStatus;
  if (status === "trialing" && trialEnds && trialEnds < now) status = "past_due";
  if (status === "active" && planEnds && planEnds < now) status = "past_due";
  const plan = isPlanCode(org.planCode) ? PLANS[org.planCode] : PLANS.starter;
  const endsAt =
    status === "trialing"
      ? trialEnds
      : status === "active"
        ? planEnds
        : trialEnds && planEnds
          ? Math.max(trialEnds, planEnds)
          : trialEnds ?? planEnds;
  const daysLeft =
    endsAt && endsAt > now ? Math.ceil((endsAt - now) / 86400000) : status === "trialing" || status === "active" ? 0 : null;
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    planCode: org.planCode,
    planName: plan.name,
    subscriptionStatus: status,
    trialEndsAt: org.trialEndsAt,
    planExpiresAt: org.planExpiresAt,
    daysLeft,
    branchLimit: org.branchLimit,
    telegramEnabled: plan.telegram,
    telegramLinked: Boolean(org.telegramChatId),
    features: plan.features,
  };
}

export async function loadOrganization(id: number | null | undefined): Promise<Organization | null> {
  if (!id) return null;
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id)).limit(1);
  return org ?? null;
}

/** Effective write access: trial/active only. */
export function orgAllowsWrite(org: Organization | null, role: string): boolean {
  if (role === "platform_admin") return true;
  if (!org) return false;
  const pub = publicOrganization(org);
  return pub?.subscriptionStatus === "trialing" || pub?.subscriptionStatus === "active";
}

export async function orgBranchIds(organizationId: number): Promise<number[]> {
  const rows = await db
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(eq(branchesTable.organizationId, organizationId));
  return rows.map((r) => r.id);
}

export async function countOrgBranches(organizationId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(branchesTable)
    .where(eq(branchesTable.organizationId, organizationId));
  return Number(row?.n ?? 0);
}

export function requireOrgId(res: Response): number | null {
  if (res.locals.userRole === "platform_admin") return null;
  const id = res.locals.organizationId as number | null | undefined;
  return typeof id === "number" ? id : null;
}

export function assertCompanyUser(res: Response): number {
  const id = requireOrgId(res);
  if (!id) {
    const err = new Error("Kompaniya konteksti topilmadi.");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
  return id;
}

export function branchScopeCondition(organizationId: number | null) {
  if (organizationId == null) return undefined;
  return eq(branchesTable.organizationId, organizationId);
}

export async function ensureBranchInOrg(branchId: number, organizationId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(and(eq(branchesTable.id, branchId), eq(branchesTable.organizationId, organizationId)))
    .limit(1);
  return Boolean(row);
}

export function attachOrgLocals(req: Request, res: Response, org: Organization | null, role: string) {
  res.locals.organizationId = org?.id ?? null;
  res.locals.organization = org;
  res.locals.isPlatformAdmin = role === "platform_admin";
  res.locals.canWrite = orgAllowsWrite(org, role);
}
