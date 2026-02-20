"use client";

import { RiLockPasswordLine } from "@remixicon/react";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";

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
import { ApiError, apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";

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
  newSigninAlerts: boolean;
};

export default function SettingsSecurityPage() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  const lastLoginMethod = useMemo(
    () => formatLoginMethod(getCookie("better-auth.last_used_login_method")),
    [],
  );

  const settingsQuery = useQuery({
    queryKey: ["settings", session?.user?.id ?? "anonymous"],
    enabled: Boolean(session?.user),
    queryFn: () =>
      apiFetchJson<{ settings?: SettingsPayload }>(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/settings`, {
        method: "GET",
        retries: 1,
      }),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (payload: Partial<SettingsPayload>) =>
      apiFetchJson(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/settings`, {
        method: "POST",
        body: JSON.stringify(payload),
        retries: 1,
      }),
    onSuccess: () => {
      toast.success("Security settings updated.");
      void queryClient.invalidateQueries({
        queryKey: ["settings", session?.user?.id ?? "anonymous"],
      });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "Could not save settings.");
    },
  });

  const settings = settingsQuery.data?.settings;
  const newSigninAlerts = settings?.newSigninAlerts ?? true;
  const isLoading = settingsQuery.isLoading;
  const isSaving = saveSettingsMutation.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Security</h2>
        <p className="text-sm text-muted-foreground">Authentication methods and session posture.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Authentication</CardTitle>
          <CardDescription>
            Current authentication configuration and sign-in alerts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-[160px_1fr] items-center gap-2 rounded-md border p-3 text-sm">
            <span className="text-muted-foreground">Auth Method</span>
            <span className="font-medium">{lastLoginMethod}</span>
          </div>
          <div className="grid grid-cols-[160px_1fr] items-center gap-2 rounded-md border p-3 text-sm">
            <span className="text-muted-foreground">Password Auth</span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <RiLockPasswordLine className="size-3.5" />
              Enabled
            </span>
          </div>
          <div className="grid grid-cols-[160px_1fr] items-center gap-2 rounded-md border p-3 text-sm">
            <span className="text-muted-foreground">Sign-in Alerts</span>
            <span className="inline-flex items-center gap-2">
              <Checkbox
                id="new-signin-alerts"
                checked={newSigninAlerts}
                onCheckedChange={(checked) => {
                  queryClient.setQueryData<{ settings?: SettingsPayload }>(
                    ["settings", session?.user?.id ?? "anonymous"],
                    (old) => ({
                      settings: { ...old?.settings, newSigninAlerts: checked === true },
                    }),
                  );
                }}
                disabled={isLoading || isSaving}
              />
              Notify on new device access
            </span>
          </div>
          <div className="grid grid-cols-[160px_1fr] items-center gap-2 rounded-md border p-3 text-sm">
            <span className="text-muted-foreground">Sessions</span>
            <span className="text-muted-foreground">Session controls expanding soon.</span>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            size="sm"
            onClick={() => saveSettingsMutation.mutate({ newSigninAlerts })}
            disabled={isLoading || isSaving}
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
