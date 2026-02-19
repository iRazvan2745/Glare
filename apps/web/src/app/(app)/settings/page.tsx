"use client";

import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function SettingsGeneralPage() {
  const { data: session, isPending } = authClient.useSession();
  const [displayName, setDisplayName] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  useEffect(() => {
    setDisplayName(session?.user.name ?? "");
  }, [session?.user.name]);

  async function saveProfile() {
    const normalizedName = displayName.trim();
    if (!normalizedName) {
      toast.error("Display name cannot be empty.");
      return;
    }

    setIsSavingProfile(true);
    await authClient.updateUser(
      { name: normalizedName },
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">General</h2>
        <p className="text-sm text-muted-foreground">Profile and identity settings.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>
            Operator profile metadata used across the control plane.
          </CardDescription>
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
            {isSavingProfile ? "Saving..." : "Save Changes"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
