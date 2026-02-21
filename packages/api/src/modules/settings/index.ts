import { db } from "@glare/db";
import { userSettings } from "@glare/db/schema/settings";
import { type } from "arktype";
import { Elysia } from "elysia";
import { getAuthenticatedUser } from "../../shared/auth/session";
import {
  isValidDiscordWebhookUrl,
  sendDiscordNotification,
  shouldSendForCategory,
} from "../../shared/notifications";

const settingsType = type({
  "productUpdates?": "boolean",
  "workerEvents?": "boolean",
  "weeklySummary?": "boolean",
  "newSigninAlerts?": "boolean",
  "discordWebhookEnabled?": "boolean",
  "discordWebhookUrl?": "string <= 2048",
  "notifyOnBackupFailures?": "boolean",
  "notifyOnWorkerHealth?": "boolean",
  "notifyOnRepoChanges?": "boolean",
});
const settingsSchema = {
  safeParse(input: unknown) {
    if (!settingsType.allows(input)) {
      return { success: false as const, reason: "Invalid payload shape" };
    }
    const parsed = input as Partial<typeof defaultSettings>;
    const merged = { ...defaultSettings, ...parsed };
    const webhookUrl = (merged.discordWebhookUrl ?? "").trim();
    if (merged.discordWebhookEnabled && webhookUrl.length === 0) {
      return {
        success: false as const,
        reason: "Discord webhook URL is required when webhook delivery is enabled",
      };
    }
    if (webhookUrl.length > 0) {
      try {
        const url = new URL(webhookUrl);
        if (url.protocol !== "https:") {
          return { success: false as const, reason: "Discord webhook URL must use https" };
        }
        if (!isValidDiscordWebhookUrl(webhookUrl)) {
          return {
            success: false as const,
            reason: "Discord webhook URL must be a discord.com or discordapp.com webhook",
          };
        }
      } catch {
        return { success: false as const, reason: "Discord webhook URL is invalid" };
      }
    }

    return {
      success: true as const,
      data: {
        ...merged,
        discordWebhookUrl: webhookUrl,
      },
    };
  },
};

const defaultSettings = {
  productUpdates: true,
  workerEvents: true,
  weeklySummary: false,
  newSigninAlerts: true,
  discordWebhookEnabled: false,
  discordWebhookUrl: "",
  notifyOnBackupFailures: true,
  notifyOnWorkerHealth: true,
  notifyOnRepoChanges: false,
} as const;

export const settingsRoutes = new Elysia()
  .get("/api/settings", async ({ request, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const existing = await db.query.userSettings.findFirst({
      where: (table, { eq }) => eq(table.userId, user.id),
    });

    if (existing) {
      return {
        settings: {
          productUpdates: existing.productUpdates,
          workerEvents: existing.workerEvents,
          weeklySummary: existing.weeklySummary,
          newSigninAlerts: existing.newSigninAlerts,
          discordWebhookEnabled: existing.discordWebhookEnabled,
          discordWebhookUrl: existing.discordWebhookUrl ?? "",
          notifyOnBackupFailures: existing.notifyOnBackupFailures,
          notifyOnWorkerHealth: existing.notifyOnWorkerHealth,
          notifyOnRepoChanges: existing.notifyOnRepoChanges,
        },
      };
    }

    await db
      .insert(userSettings)
      .values({
        userId: user.id,
        ...defaultSettings,
      })
      .onConflictDoNothing({ target: userSettings.userId });

    const fetchedSettings = await db.query.userSettings.findFirst({
      where: (table, { eq }) => eq(table.userId, user.id),
    });

    if (fetchedSettings) {
      return {
        settings: {
          productUpdates: fetchedSettings.productUpdates,
          workerEvents: fetchedSettings.workerEvents,
          weeklySummary: fetchedSettings.weeklySummary,
          newSigninAlerts: fetchedSettings.newSigninAlerts,
          discordWebhookEnabled: fetchedSettings.discordWebhookEnabled,
          discordWebhookUrl: fetchedSettings.discordWebhookUrl ?? "",
          notifyOnBackupFailures: fetchedSettings.notifyOnBackupFailures,
          notifyOnWorkerHealth: fetchedSettings.notifyOnWorkerHealth,
          notifyOnRepoChanges: fetchedSettings.notifyOnRepoChanges,
        },
      };
    }

    return { settings: defaultSettings };
  })
  .post("/api/settings", async ({ request, body, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return status(400, { error: parsed.reason ?? "Invalid settings payload" });
    }

    await db
      .insert(userSettings)
      .values({
        userId: user.id,
        ...parsed.data,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: parsed.data,
      });

    return { settings: parsed.data };
  })
  .post("/api/settings/discord/test", async ({ request, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const currentSettings = await db.query.userSettings.findFirst({
      where: (table, { eq }) => eq(table.userId, user.id),
      columns: {
        discordWebhookEnabled: true,
        discordWebhookUrl: true,
        notifyOnBackupFailures: true,
        notifyOnWorkerHealth: true,
        notifyOnRepoChanges: true,
      },
    });
    if (!currentSettings?.discordWebhookEnabled || !currentSettings.discordWebhookUrl?.trim()) {
      return status(422, { error: "Discord webhook not configured or disabled" });
    }
    if (!shouldSendForCategory("backup_failures", currentSettings)) {
      return status(422, { error: "backup_failures notifications disabled" });
    }

    try {
      const delivered = await sendDiscordNotification({
        userId: user.id,
        category: "backup_failures",
        title: "Glare test notification",
        message: "Discord webhook delivery is configured and operational.",
        severity: "info",
        fields: [
          { name: "User ID", value: user.id },
          { name: "Source", value: "Settings test action" },
        ],
      });
      if (!delivered) {
        return status(502, { error: "Failed to deliver Discord test notification" });
      }
    } catch {
      return status(502, { error: "Failed to deliver Discord test notification" });
    }

    return status(204);
  });
