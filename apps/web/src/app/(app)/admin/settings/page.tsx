"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { env } from "@glare/env/web";
import { toast } from "@/lib/toast";

function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Request failed");
  }
  return "Request failed";
}

async function apiFetch(path: string, options?: RequestInit) {
  const base = env.NEXT_PUBLIC_SERVER_URL.replace(/\/+$/, "");
  const res = await fetch(`${base}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<unknown>;
}

export default function AdminSettingsPage() {
  const [signupsEnabled, setSignupsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    apiFetch("/api/admin/settings")
      .then((data) => {
        const settings = (data as { settings?: { signupsEnabled?: boolean } }).settings;
        setSignupsEnabled(settings?.signupsEnabled ?? true);
      })
      .catch((err: unknown) => {
        toast.error(getErrorMessage(err));
      })
      .finally(() => setIsLoading(false));
  }, []);

  const onToggleSignups = async (checked: boolean) => {
    setIsSaving(true);
    try {
      const data = await apiFetch("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ signupsEnabled: checked }),
      });
      const settings = (data as { settings?: { signupsEnabled?: boolean } }).settings;
      setSignupsEnabled(settings?.signupsEnabled ?? checked);
      toast.success(checked ? "Sign-ups enabled" : "Sign-ups disabled");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Workspace Settings</h2>
        <p className="text-sm text-muted-foreground">Workspace-wide configuration options.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registration</CardTitle>
          <CardDescription>Control whether new users can register accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="signups-toggle">Allow new sign-ups</Label>
              <p className="text-xs text-muted-foreground">
                When disabled, the sign-up form will be hidden and new registrations will be
                rejected.
              </p>
            </div>
            <Switch
              id="signups-toggle"
              checked={signupsEnabled}
              onCheckedChange={(checked) => void onToggleSignups(checked)}
              disabled={isLoading || isSaving}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
