"use client";

import { ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import { Label } from "@/components/ui/label";
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
};

const defaultSettings: SettingsPayload = {
  productUpdates: true,
  workerEvents: true,
  weeklySummary: false,
  newSigninAlerts: true,
};

export default function SettingsPage() {
  const { data: session, isPending } = authClient.useSession();
  const [displayName, setDisplayName] = useState("");
  const [settings, setSettings] = useState<SettingsPayload>(defaultSettings);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const lastLoginMethod = useMemo(
    () => formatLoginMethod(getCookie("better-auth.last_used_login_method")),
    [],
  );

  useEffect(() => {
    setDisplayName(session?.user.name ?? "");
  }, [session?.user.name]);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      if (!session?.user) {
        setIsLoadingSettings(false);
        return;
      }

      setIsLoadingSettings(true);
      try {
        const response = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/settings`, {
          method: "GET",
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error("Failed to load settings");
        }

        const data = (await response.json()) as { settings?: SettingsPayload };
        if (!cancelled && data.settings) {
          setSettings(data.settings);
        }
      } catch {
        if (!cancelled) {
          toast.error("Could not load your settings.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSettings(false);
        }
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [session?.user]);

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
          toast.success("Profile updated.");
        },
        onError: (error) => {
          toast.error(error.error.message || error.error.statusText);
        },
      },
    );
    setIsSavingProfile(false);
  }

  async function saveSettings() {
    setIsSavingSettings(true);

    try {
      const response = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/settings`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error("Failed to save settings");
      }

      toast.success("Settings updated.");
    } catch {
      toast.error("Could not save your settings.");
    } finally {
      setIsSavingSettings(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your personal profile, notifications, and account security preferences.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="size-4" />
              Profile
            </CardTitle>
            <CardDescription>Basic identity details used across your workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="display-name">Display Name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={isPending || isSavingProfile}
                placeholder="Your public display name"
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
              {isSavingProfile ? "Saving..." : "Save Changes"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              Security
            </CardTitle>
            <CardDescription>Recent sign-in metadata and account safety controls.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-[160px_1fr] items-center gap-2 rounded-md border p-3">
              <span className="text-xs text-muted-foreground">Last Login Method</span>
              <span className="text-xs font-medium">{lastLoginMethod}</span>
            </div>
            <div className="grid grid-cols-[160px_1fr] items-center gap-2 rounded-md border p-3">
              <span className="text-xs text-muted-foreground">Password Auth</span>
              <span className="text-xs font-medium">Enabled</span>
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <Label htmlFor="new-signin-alerts" className="font-medium">
                Notify me about new sign-ins
              </Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="new-signin-alerts"
                  checked={settings.newSigninAlerts}
                  onCheckedChange={(checked) =>
                    setSettings((current) => ({
                      ...current,
                      newSigninAlerts: checked === true,
                    }))
                  }
                  disabled={isLoadingSettings || isSavingSettings}
                />
                <Label htmlFor="new-signin-alerts" className="text-muted-foreground">
                  Send an email alert when a new device accesses this account.
                </Label>
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={saveSettings}
              disabled={isLoadingSettings || isSavingSettings}
            >
              {isSavingSettings ? "Saving..." : "Update Security Settings"}
            </Button>
          </CardFooter>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Choose what updates you receive from your workspace.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="flex items-center gap-2 rounded-md border p-3">
              <Checkbox
                id="product-updates"
                checked={settings.productUpdates}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    productUpdates: checked === true,
                  }))
                }
                disabled={isLoadingSettings || isSavingSettings}
              />
              <Label htmlFor="product-updates">Product updates</Label>
            </div>
            <div className="flex items-center gap-2 rounded-md border p-3">
              <Checkbox
                id="worker-events"
                checked={settings.workerEvents}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    workerEvents: checked === true,
                  }))
                }
                disabled={isLoadingSettings || isSavingSettings}
              />
              <Label htmlFor="worker-events">Worker events</Label>
            </div>
            <div className="flex items-center gap-2 rounded-md border p-3">
              <Checkbox
                id="weekly-summary"
                checked={settings.weeklySummary}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    weeklySummary: checked === true,
                  }))
                }
                disabled={isLoadingSettings || isSavingSettings}
              />
              <Label htmlFor="weekly-summary">Weekly summary</Label>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              size="sm"
              onClick={saveSettings}
              disabled={isLoadingSettings || isSavingSettings}
            >
              {isSavingSettings ? "Saving..." : "Save Notification Preferences"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
