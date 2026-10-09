import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const appUsersTable = pgTable(
  "pharmacy_app_users",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    displayName: text("display_name").notNull().default("Foydalanuvchi"),
    email: text("email").notNull().default(""),
    role: text("role").notNull().default("viewer"),
    username: text("username"),
    passwordHash: text("password_hash"),
    // active | pending | rejected | disabled — only active accounts receive sessions.
    status: text("status").notNull().default("active"),
    // admin | google | email | request
    signupMethod: text("signup_method").notNull().default("admin"),
    phone: text("phone").notNull().default(""),
    googleSub: text("google_sub"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: integer("reviewed_by"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("pharmacy_app_users_clerk_user_idx").on(table.clerkUserId),
    uniqueIndex("pharmacy_app_users_username_idx").on(table.username),
    uniqueIndex("pharmacy_app_users_google_sub_idx").on(table.googleSub),
    uniqueIndex("pharmacy_app_users_email_idx")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} <> ''`),
    index("pharmacy_app_users_role_idx").on(table.role),
    index("pharmacy_app_users_status_idx").on(table.status),
  ],
);

export const authCodesTable = pgTable(
  "pharmacy_auth_codes",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    purpose: text("purpose").notNull(),
    codeHash: text("code_hash").notNull(),
    payload: text("payload").notNull().default("{}"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("pharmacy_auth_codes_email_idx").on(table.email, table.purpose)],
);

export const integrationSettingsTable = pgTable(
  "pharmacy_integration_settings",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("pharmacy_integration_settings_key_idx").on(table.key)],
);

export const integrationImportsTable = pgTable("pharmacy_integration_imports", {
  id: serial("id").primaryKey(),
  integration: text("integration").notNull().default("fom"),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  importedRecords: integer("imported_records").notNull().default(0),
  message: text("message").notNull().default(""),
  details: text("details").notNull().default(""),
});

export const auditLogTable = pgTable("pharmacy_audit_log", {
  id: serial("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  summary: text("summary").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertAppUserSchema = createInsertSchema(appUsersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type AppUser = typeof appUsersTable.$inferSelect;
export type InsertAppUser = z.infer<typeof insertAppUserSchema>;
export type IntegrationSetting = typeof integrationSettingsTable.$inferSelect;
export type IntegrationImport = typeof integrationImportsTable.$inferSelect;
export type AuditLogEntry = typeof auditLogTable.$inferSelect;
