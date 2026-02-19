import { relations } from "drizzle-orm";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const workspaceSettings = pgTable("workspace_settings", {
  id: text("id").primaryKey().default("default"),
  signupsEnabled: boolean("signups_enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  productUpdates: boolean("product_updates").default(true).notNull(),
  workerEvents: boolean("worker_events").default(true).notNull(),
  weeklySummary: boolean("weekly_summary").default(false).notNull(),
  newSigninAlerts: boolean("new_signin_alerts").default(true).notNull(),
  discordWebhookEnabled: boolean("discord_webhook_enabled").default(false).notNull(),
  discordWebhookUrl: text("discord_webhook_url"),
  notifyOnBackupFailures: boolean("notify_on_backup_failures").default(true).notNull(),
  notifyOnWorkerHealth: boolean("notify_on_worker_health").default(true).notNull(),
  notifyOnRepoChanges: boolean("notify_on_repo_changes").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(user, {
    fields: [userSettings.userId],
    references: [user.id],
  }),
}));
