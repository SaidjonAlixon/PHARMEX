import { getAuth } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import type { RequestHandler } from "express";
import { appUsersTable, db } from "@workspace/db";
import {
  SESSION_COOKIE,
  localAuthEnabled,
  readSessionToken,
} from "../lib/localAuth";

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
    res.locals.userId = appUser.clerkUserId;
    res.locals.appUserId = appUser.id;
    res.locals.userRole = appUser.role;
    res.locals.userName = appUser.displayName;
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

        const [anyUser] = await tx
          .select({ id: appUsersTable.id })
          .from(appUsersTable)
          .limit(1);
        const [created] = await tx
          .insert(appUsersTable)
          .values({
            clerkUserId: userId,
            role: anyUser ? "viewer" : "admin",
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

    res.locals.userId = userId;
    res.locals.appUserId = appUser.id;
    res.locals.userRole = appUser.role;
    res.locals.userName = appUser.displayName;
    next();
  } catch (error) {
    req.log.error({ err: error }, "Could not resolve signed-in application user");
    res.status(500).json({ error: "Foydalanuvchi ma’lumotini tekshirib bo‘lmadi." });
  }
};

export const requireClerkUser: RequestHandler = localAuthEnabled
  ? requireLocalUser
  : requireClerkSessionUser;

export function requireRole(...allowedRoles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!allowedRoles.includes(String(res.locals.userRole ?? ""))) {
      res.status(403).json({ error: "Bu amal uchun ruxsat yo‘q." });
      return;
    }
    next();
  };
}
