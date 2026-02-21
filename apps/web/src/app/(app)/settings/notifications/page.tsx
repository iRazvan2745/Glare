"use client";

import { apiBaseUrl } from "@/lib/api-base-url";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ApiError, apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";

type SettingsPayload = {
  productUpdates: boolean;
  workerEvents: boolean;
  weeklySummary: boolean;
  newSigninAlerts: boolean;
  discordWebhookEnabled: boolean;
  discordWebhookUrl: string;
  notifyOnBackupFailures: boolean;
  notifyOnWorkerHealth: boolean;
  notifyOnRepoChanges: boolean;
};

const defaultSettings: SettingsPayload = {
  productUpdates: true,
  workerEvents: true,
  weeklySummary: false,
  newSigninAlerts: true,
  discordWebhookEnabled: false,
  discordWebhookUrl: "",
  notifyOnBackupFailures: true,
  notifyOnWorkerHealth: true,
  notifyOnRepoChanges: false,
};

export default function SettingsNotificationsPage() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  const settingsQuery = useQuery({
    queryKey: ["settings", session?.user?.id ?? "anonymous"],
    enabled: Boolean(session?.user),
    queryFn: () =>
      apiFetchJson<{ settings?: SettingsPayload }>(`${apiBaseUrl}/api/settings`, {
        method: "GET",
        retries: 1,
      }),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (payload: SettingsPayload) =>
      apiFetchJson(`${apiBaseUrl}/api/settings`, {
        method: "POST",
        body: JSON.stringify(payload),
        retries: 1,
      }),
    onSuccess: () => {
      toast.success("Notification settings updated.");
      void queryClient.invalidateQueries({
        queryKey: ["settings", session?.user?.id ?? "anonymous"],
      });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "Could not save settings.");
    },
  });

  const testDiscordMutation = useMutation({
    mutationFn: () =>
      apiFetchJson(`${apiBaseUrl}/api/settings/discord/test`, {
        method: "POST",
        retries: 0,
      }),
    onSuccess: () => toast.success("Discord webhook test sent."),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "Discord webhook test failed.");
    },
  });

  const settings = settingsQuery.data?.settings ?? defaultSettings;
  const isLoading = settingsQuery.isLoading;
  const isSaving = saveSettingsMutation.isPending;

  function updateSettings(updater: (current: SettingsPayload) => SettingsPayload) {
    const current = settingsQuery.data?.settings ?? defaultSettings;
    queryClient.setQueryData<{ settings?: SettingsPayload }>(
      ["settings", session?.user?.id ?? "anonymous"],
      { settings: updater(current) },
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Notifications</h2>
        <p className="text-sm text-muted-foreground">Operational signal routing by category.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alert Categories</CardTitle>
          <CardDescription>Choose which events trigger notifications.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <Checkbox
              checked={settings.notifyOnBackupFailures}
              onCheckedChange={(checked) =>
                updateSettings((c) => ({ ...c, notifyOnBackupFailures: checked === true }))
              }
              disabled={isLoading || isSaving}
            />
            Backup failures
          </label>
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <Checkbox
              checked={settings.notifyOnWorkerHealth}
              onCheckedChange={(checked) =>
                updateSettings((c) => ({ ...c, notifyOnWorkerHealth: checked === true }))
              }
              disabled={isLoading || isSaving}
            />
            Worker health
          </label>
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <Checkbox
              checked={settings.notifyOnRepoChanges}
              onCheckedChange={(checked) =>
                updateSettings((c) => ({ ...c, notifyOnRepoChanges: checked === true }))
              }
              disabled={isLoading || isSaving}
            />
            Repo changes
          </label>
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <Checkbox
              checked={settings.productUpdates}
              onCheckedChange={(checked) =>
                updateSettings((c) => ({ ...c, productUpdates: checked === true }))
              }
              disabled={isLoading || isSaving}
            />
            Product updates
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Discord Webhook</CardTitle>
          <CardDescription>Send control-plane incidents to Discord.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={settings.discordWebhookEnabled}
                onCheckedChange={(checked) =>
                  updateSettings((c) => ({ ...c, discordWebhookEnabled: checked === true }))
                }
                disabled={isLoading || isSaving}
              />
              Enable Discord webhook delivery
            </label>
            <Badge variant="outline">
              {settings.discordWebhookEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <Input
            value={settings.discordWebhookUrl}
            onChange={(event) =>
              updateSettings((c) => ({ ...c, discordWebhookUrl: event.target.value }))
            }
            disabled={isLoading || isSaving}
            placeholder="https://discord.com/api/webhooks/..."
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => testDiscordMutation.mutate()}
            disabled={
              isLoading ||
              isSaving ||
              testDiscordMutation.isPending ||
              !settings.discordWebhookEnabled ||
              settings.discordWebhookUrl.trim().length === 0
            }
          >
            {testDiscordMutation.isPending ? "Testing..." : "Test Webhook"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => saveSettingsMutation.mutate(settings)}
          disabled={isLoading || isSaving}
        >
          {isSaving ? "Saving..." : "Save Notification Settings"}
        </Button>
      </div>
    </div>
  );
}
