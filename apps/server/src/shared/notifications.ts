import { db } from "@glare/db";
import { userSettings } from "@glare/db/schema/settings";
import { eq } from "drizzle-orm";

import { logError, logWarn } from "./logger";

type NotificationCategory = "backup_failures" | "worker_health" | "repo_changes";
type NotificationSeverity = "info" | "warning" | "error";

type DiscordNotificationInput = {
  userId: string;
  category: NotificationCategory;
  title: string;
  message: string;
  severity?: NotificationSeverity;
  fields?: Array<{ name: string; value: string }>;
};

function shouldSendForCategory(
  category: NotificationCategory,
  settings: {
    notifyOnBackupFailures: boolean;
    notifyOnWorkerHealth: boolean;
    notifyOnRepoChanges: boolean;
  },
) {
  switch (category) {
    case "backup_failures":
      return settings.notifyOnBackupFailures;
    case "worker_health":
      return settings.notifyOnWorkerHealth;
    case "repo_changes":
      return settings.notifyOnRepoChanges;
    default:
      return false;
  }
}

function severityColor(severity: NotificationSeverity) {
  if (severity === "error") return 0xed4245;
  if (severity === "warning") return 0xfaa61a;
  return 0x57f287;
}

export async function sendDiscordNotification(input: DiscordNotificationInput) {
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, input.userId),
    columns: {
      discordWebhookEnabled: true,
      discordWebhookUrl: true,
      notifyOnBackupFailures: true,
      notifyOnWorkerHealth: true,
      notifyOnRepoChanges: true,
    },
  });

  if (!settings?.discordWebhookEnabled) {
    return;
  }

  const webhookUrl = settings.discordWebhookUrl?.trim();
  if (!webhookUrl) {
    return;
  }

  if (!shouldSendForCategory(input.category, settings)) {
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "Glare Control Plane",
        embeds: [
          {
            title: input.title,
            description: input.message,
            color: severityColor(input.severity ?? "error"),
            fields: input.fields?.slice(0, 8),
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logWarn("discord notification request failed", {
        userId: input.userId,
        status: response.status,
        body,
        category: input.category,
      });
    }
  } catch (error) {
    logError("discord notification dispatch failed", {
      userId: input.userId,
      category: input.category,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
