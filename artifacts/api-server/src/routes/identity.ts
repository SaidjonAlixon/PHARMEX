import { and, eq, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  appUsersTable,
  auditLogTable,
} from "@workspace/db";
import {
  GetCurrentUserResponse,
  ListUsersResponse,
  UpdateUserRoleBody,
  UpdateUserRoleQueryParams,
  UpdateUserRoleResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireClerkUser";

const router: IRouter = Router();

router.get("/me", async (_req, res): Promise<void> => {
  const user = (
    await db
      .select({
        id: appUsersTable.id,
        displayName: appUsersTable.displayName,
        email: appUsersTable.email,
        role: appUsersTable.role,
        createdAt: appUsersTable.createdAt,
      })
      .from(appUsersTable)
      .where(eq(appUsersTable.id, Number(res.locals.appUserId)))
      .limit(1)
  )[0];

  if (!user) {
    res.status(404).json({ error: "Foydalanuvchi topilmadi." });
    return;
  }
  res.json(GetCurrentUserResponse.parse(user));
});

router.get("/users", requireRole("admin"), async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id: appUsersTable.id,
      displayName: appUsersTable.displayName,
      email: appUsersTable.email,
      role: appUsersTable.role,
      createdAt: appUsersTable.createdAt,
    })
    .from(appUsersTable)
    .orderBy(appUsersTable.createdAt);
  res.json(ListUsersResponse.parse(users));
});

router.patch(
  "/users/role",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const query = UpdateUserRoleQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }
    const body = UpdateUserRoleBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const updated = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(815274902::bigint)`);
      const target = (
        await tx
          .select()
          .from(appUsersTable)
          .where(eq(appUsersTable.id, query.data.userId))
          .limit(1)
      )[0];
      if (!target) return null;

      if (target.role === "admin" && body.data.role !== "admin") {
        const admins = await tx
          .select({ id: appUsersTable.id })
          .from(appUsersTable)
          .where(and(eq(appUsersTable.role, "admin"), ne(appUsersTable.id, target.id)))
          .limit(1);
        if (admins.length === 0) return "last-admin" as const;
      }

      const [user] = await tx
        .update(appUsersTable)
        .set({ role: body.data.role, updatedAt: new Date() })
        .where(eq(appUsersTable.id, target.id))
        .returning({
          id: appUsersTable.id,
          displayName: appUsersTable.displayName,
          email: appUsersTable.email,
          role: appUsersTable.role,
          createdAt: appUsersTable.createdAt,
        });
      await tx.insert(auditLogTable).values({
        actorId: String(res.locals.userId),
        action: "role.updated",
        entityType: "user",
        entityId: String(user.id),
        summary: `Rol ${target.role} dan ${user.role} ga o‘zgartirildi`,
      });
      return user;
    });

    if (updated === "last-admin") {
      res.status(409).json({ error: "Oxirgi administrator rolini olib bo‘lmaydi." });
      return;
    }
    if (!updated) {
      res.status(404).json({ error: "Foydalanuvchi topilmadi." });
      return;
    }
    res.json(UpdateUserRoleResponse.parse(updated));
  },
);

export default router;
