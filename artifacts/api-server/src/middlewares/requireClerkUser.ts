import { getAuth } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import type { RequestHandler } from "express";
import { appUsersTable, db } from "@workspace/db";
import {
  ACT_ORG_COOKIE,
  SESSION_COOKIE,
  localAuthEnabled,
  readActOrgToken,
  readSessionToken,
} from "../lib/localAuth";
import { attachOrgLocals, loadOrganization } from "../lib/org";
import { isOwnerSurface, OWNER_PUBLIC_URL } from "../lib/ownerHost";

const bootstrappedUsers = new Set<string>();

const requireLocalUser: RequestHandler = async (req, res, next) => {
  const appUserId = readSessionToken(req.cookies?.[SESSION_COOKIE]);
  if (!appUserId) {
    res.status(401).json({ error: "Kirish talab qilinadi." });
    return;
  }
  try {
    const [appUser] = await db
      .select()
      .from(appUsersTable)
      .where(eq(appUsersTable.id, appUserId))
      .limit(1);
    if (!appUser || appUser.status !== "active") {
      res.status(401).json({ error: "Kirish talab qilinadi." });
      return;
    }
    if (appUser.role !== "platform_admin" && appUser.organizationId == null) {
      res.status(403).json({
        error: "Kompaniyaga biriktirilmagan akkaunt. Administratorga murojaat qiling.",
        code: "no_organization",
      });
      return;
    }
    res.locals.userId = appUser.clerkUserId;
    res.locals.appUserId = appUser.id;
    res.locals.userRole = appUser.role;
    res.locals.userName = appUser.displayName;
    let actAsOrgId: number | null = null;
    let orgId = appUser.organizationId;
    if (appUser.role === "platform_admin") {
      const act = readActOrgToken(req.cookies?.[ACT_ORG_COOKIE]);
      if (act) {
        actAsOrgId = act;
        orgId = act;
      }
    }
    const org = await loadOrganization(orgId);
    if (appUser.role === "platform_admin" && actAsOrgId != null && !org) {
      actAsOrgId = null;
    }
    attachOrgLocals(req, res, org, appUser.role, actAsOrgId);
    next();
  } catch (error) {
    req.log.error({ err: error }, "Could not resolve signed-in application user");
    res.status(500).json({ error: "Foydalanuvchi ma’lumotini tekshirib bo‘lmadi." });
  }
};

const requireClerkSessionUser: RequestHandler = async (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Kirish talab qilinadi." });
    return;
  }

  try {
    let appUser = (
      await db
        .select()
        .from(appUsersTable)
        .where(eq(appUsersTable.clerkUserId, userId))
        .limit(1)
    )[0];

    if (!appUser && !bootstrappedUsers.has(userId)) {
      appUser = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(815274901::bigint)`,
        );
        const [existing] = await tx
          .select()
          .from(appUsersTable)
          .where(eq(appUsersTable.clerkUserId, userId))
          .limit(1);
        if (existing) return existing;

        // Do not auto-activate unknown Clerk users into the live tenant.
        // First-ever bootstrap remains pending until platform/local admin activates.
        const [anyUser] = await tx
          .select({ id: appUsersTable.id })
          .from(appUsersTable)
          .limit(1);
        const [created] = await tx
          .insert(appUsersTable)
          .values({
            clerkUserId: userId,
            role: anyUser ? "viewer" : "admin",
            status: "pending",
            organizationId: null,
          })
          .onConflictDoNothing()
          .returning();

        if (created) return created;
        const [raced] = await tx
          .select()
          .from(appUsersTable)
          .where(and(eq(appUsersTable.clerkUserId, userId)))
          .limit(1);
        return raced;
      });
      if (appUser) bootstrappedUsers.add(userId);
    }

    if (!appUser) {
      res.status(403).json({ error: "Foydalanuvchi ro‘yxatdan o‘tmagan." });
      return;
    }
    if (appUser.status !== "active") {
      res.status(403).json({
        error: "Akkauntingiz hali faol emas. Platforma administratori tasdigʻini kuting.",
        code: appUser.status,
      });
      return;
    }
    if (appUser.role !== "platform_admin" && appUser.organizationId == null) {
      res.status(403).json({
        error: "Kompaniyaga biriktirilmagan akkaunt. Administratorga murojaat qiling.",
        code: "no_organization",
      });
      return;
    }

    res.locals.userId = userId;
    res.locals.appUserId = appUser.id;
    res.locals.userRole = appUser.role;
    res.locals.userName = appUser.displayName;
    const org = await loadOrganization(appUser.organizationId);
    attachOrgLocals(req, res, org, appUser.role);
    next();
  } catch (error) {
    req.log.error({ err: error }, "Could not resolve signed-in application user");
    res.status(500).json({ error: "Foydalanuvchi ma’lumotini tekshirib bo‘lmadi." });
  }
};

export const requireClerkUser: RequestHandler = localAuthEnabled
  ? requireLocalUser
  : requireClerkSessionUser;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const readOnlyForViewers: RequestHandler = (req, res, next) => {
  if (READ_METHODS.has(req.method)) {
    next();
    return;
  }
  if (res.locals.userRole === "viewer") {
    res.status(403).json({ error: "Kuzatuvchi faqat koʻra oladi: maʼlumot kiritish yoki saqlash mumkin emas." });
    return;
  }
  if (res.locals.userRole !== "platform_admin" && res.locals.canWrite === false) {
    res.status(402).json({
      error: "Obuna muddati tugagan yoki sinov yakunlangan. Davom etish uchun tarifni yangilang.",
      code: "subscription_required",
    });
    return;
  }
  next();
};

export function requireRole(...allowedRoles: string[]): RequestHandler {
  return (_req, res, next) => {
    const role = String(res.locals.userRole ?? "");
    const acting = Boolean(res.locals.actingAsCompany);
    const allowed =
      allowedRoles.includes(role) ||
      (acting &&
        role === "platform_admin" &&
        allowedRoles.some((r) => r === "admin" || r === "finance"));
    if (!allowed) {
      res.status(403).json({ error: "Bu amal uchun ruxsat yo‘q." });
      return;
    }
    next();
  };
}

export const requirePlatformAdmin: RequestHandler = (req, res, next) => {
  if (res.locals.userRole !== "platform_admin") {
    res.status(403).json({ error: "Faqat platforma administratori." });
    return;
  }
  if (!isOwnerSurface(req)) {
    res.status(404).json({
      error: `Platforma API faqat owner panelidan: ${OWNER_PUBLIC_URL()}`,
      code: "owner_surface_required",
    });
    return;
  }
  next();
};
