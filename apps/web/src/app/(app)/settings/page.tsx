"use client";

import { RiFingerprintLine, RiLockPasswordLine, RiNotification3Line, RiShieldCheckLine, RiUserLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";

import { SectionHeader } from "@/components/control-plane";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";
import { env } from "@glare/env/web";

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : null;
}

function formatLoginMethod(method: string | null) {
  if (!method) return "Unknown";
  return method
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

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

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: session, isPending } = authClient.useSession();
  const [displayName, setDisplayName] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const lastLoginMethod = useMemo(
    () => formatLoginMethod(getCookie("better-auth.last_used_login_method")),
    [],
  );

  useEffect(() => {
    setDisplayName(session?.user.name ?? "");
  }, [session?.user.name]);

  const settingsQuery = useQuery({
    queryKey: ["settings", session?.user?.id ?? "anonymous"],
    enabled: Boolean(session?.user),
    queryFn: () =>
      apiFetchJson<{ settings?: SettingsPayload }>(`${env.NEXT_PUBLIC_SERVER_URL}/api/settings`, {
        method: "GET",
        retries: 1,
      }),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (payload: SettingsPayload) =>
      apiFetchJson(`${env.NEXT_PUBLIC_SERVER_URL}/api/settings`, {
        method: "POST",
        body: JSON.stringify(payload),
        retries: 1,
      }),
    onSuccess: () => {
      toast.success("Control plane settings updated.");
      void queryClient.invalidateQueries({ queryKey: ["settings", session?.user?.id ?? "anonymous"] });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast.error(error.message);
        return;
      }
      toast.error("Could not save settings.");
    },
  });

  const testDiscordMutation = useMutation({
    mutationFn: () =>
      apiFetchJson(`${env.NEXT_PUBLIC_SERVER_URL}/api/settings/discord/test`, {
        method: "POST",
        retries: 0,
      }),
    onSuccess: () => {
      toast.success("Discord webhook test sent.");
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast.error(error.message);
        return;
      }
      toast.error("Discord webhook test failed.");
    },
  });

  const settings = settingsQuery.data?.settings ?? defaultSettings;
  const isLoadingSettings = settingsQuery.isLoading;
  const isSavingSettings = saveSettingsMutation.isPending;

  function updateSettings(updater: (current: SettingsPayload) => SettingsPayload) {
    const current = settingsQuery.data?.settings ?? defaultSettings;
    queryClient.setQueryData<{ settings?: SettingsPayload }>(
      ["settings", session?.user?.id ?? "anonymous"],
      { settings: updater(current) },
    );
  }

  async function saveProfile() {
    const normalizedName = displayName.trim();

    if (!normalizedName) {
      toast.error("Display name cannot be empty.");
      return;
    }

    setIsSavingProfile(true);
    await authClient.updateUser(
      {
        name: normalizedName,
      },
      {
        onSuccess: () => {
          toast.success("Identity updated.");
        },
        onError: (error) => {
          toast.error(error.error.message || error.error.statusText);
        },
      },
    );
    setIsSavingProfile(false);
  }

  async function saveSettings() {
    await saveSettingsMutation.mutateAsync(settings);
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Settings"
        subtitle="Control identity, security posture, and operational notifications."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RiUserLine className="size-4" />
              Identity
            </CardTitle>
            <CardDescription>Operator profile metadata used across the control plane.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="display-name">Display Name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={isPending || isSavingProfile}
                placeholder="Operator name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={session?.user.email ?? ""} disabled readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-id">User ID</Label>
              <Input id="user-id" value={session?.user.id ?? "N/A"} disabled readOnly />
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDisplayName(session?.user.name ?? "")}
              disabled={isSavingProfile}
            >
              Reset
            </Button>
            <Button size="sm" onClick={saveProfile} disabled={isSavingProfile || isPending}>
              {isSavingProfile ? "Saving..." : "Save Identity"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RiShieldCheckLine className="size-4" />
              Security
            </CardTitle>
            <CardDescription>Authentication methods, recent sign-ins, and session posture.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-[160px_1fr] items-center gap-2 rounded-md border p-3 text-xs">
              <span className="text-muted-foreground">Auth Method</span>
              <span className="font-medium">{lastLoginMethod}</span>
            </div>
            <div className="grid grid-cols-[160px_1fr] items-center gap-2 rounded-md border p-3 text-xs">
              <span className="text-muted-foreground">Password Auth</span>
              <span className="inline-flex items-center gap-1.5 font-medium">
                <RiLockPasswordLine className="size-3.5" />
                Enabled
              </span>
            </div>
            <div className="grid grid-cols-[160px_1fr] items-center gap-2 rounded-md border p-3 text-xs">
              <span className="text-muted-foreground">Recent Sign-in Alerts</span>
              <span className="inline-flex items-center gap-2">
                <Checkbox
                  id="new-signin-alerts"
                  checked={settings.newSigninAlerts}
                  onCheckedChange={(checked) =>
                    updateSettings((current) => ({
                      ...current,
                      newSigninAlerts: checked === true,
                    }))
                  }
                  disabled={isLoadingSettings || isSavingSettings}
                />
                Notify on new device access
              </span>
            </div>
            <div className="grid grid-cols-[160px_1fr] items-center gap-2 rounded-md border p-3 text-xs">
              <span className="text-muted-foreground">Sessions</span>
              <span>Session controls expanding soon.</span>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={saveSettings}
              disabled={isLoadingSettings || isSavingSettings}
            >
              {isSavingSettings ? "Saving..." : "Save Security"}
            </Button>
          </CardFooter>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RiNotification3Line className="size-4" />
              Notifications
            </CardTitle>
            <CardDescription>Operational signal routing by category.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
              <Checkbox
                checked={settings.notifyOnBackupFailures}
                onCheckedChange={(checked) =>
                  updateSettings((current) => ({
                    ...current,
                    notifyOnBackupFailures: checked === true,
                  }))
                }
                disabled={isLoadingSettings || isSavingSettings}
              />
              Backup failures
            </label>
            <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
              <Checkbox
                checked={settings.notifyOnWorkerHealth}
                onCheckedChange={(checked) =>
                  updateSettings((current) => ({
                    ...current,
                    notifyOnWorkerHealth: checked === true,
                  }))
                }
                disabled={isLoadingSettings || isSavingSettings}
              />
              Worker health
            </label>
            <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
              <Checkbox
                checked={settings.notifyOnRepoChanges}
                onCheckedChange={(checked) =>
                  updateSettings((current) => ({
                    ...current,
                    notifyOnRepoChanges: checked === true,
                  }))
                }
                disabled={isLoadingSettings || isSavingSettings}
              />
              Repo changes
            </label>
            <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
              <Checkbox
                checked={settings.productUpdates}
                onCheckedChange={(checked) =>
                  updateSettings((current) => ({
                    ...current,
                    productUpdates: checked === true,
                  }))
                }
                disabled={isLoadingSettings || isSavingSettings}
              />
              Product
            </label>
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={settings.discordWebhookEnabled}
                    onCheckedChange={(checked) =>
                      updateSettings((current) => ({
                        ...current,
                        discordWebhookEnabled: checked === true,
                      }))
                    }
                    disabled={isLoadingSettings || isSavingSettings}
                  />
                  Discord webhook delivery
                </label>
                <Badge variant="outline">
                  {settings.discordWebhookEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Send control-plane incidents to Discord. URL is stored server-side and only used for outbound webhook delivery.
              </p>
              <Input
                value={settings.discordWebhookUrl}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    discordWebhookUrl: event.target.value,
                  }))
                }
                disabled={isLoadingSettings || isSavingSettings}
                placeholder="https://discord.com/api/webhooks/..."
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => testDiscordMutation.mutate()}
                disabled={
                  isLoadingSettings ||
                  isSavingSettings ||
                  testDiscordMutation.isPending ||
                  !settings.discordWebhookEnabled ||
                  settings.discordWebhookUrl.trim().length === 0
                }
              >
                {testDiscordMutation.isPending ? "Testing..." : "Test Webhook"}
              </Button>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              size="sm"
              onClick={saveSettings}
              disabled={isLoadingSettings || isSavingSettings}
            >
              {isSavingSettings ? "Saving..." : "Save Notification Policy"}
            </Button>
          </CardFooter>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RiFingerprintLine className="size-4" />
              Audit Log
            </CardTitle>
            <CardDescription>Authoritative event trail for configuration and execution changes.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Coming soon.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
