"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

export default function AdminUsersPage() {
  const { data: session } = authClient.useSession();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Users</h1>
        <p className="text-sm text-muted-foreground">Current authenticated user context.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>User</CardTitle>
          <CardDescription>
            This app currently exposes session-level user data in admin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Name: {session?.user.name || "N/A"}</p>
          <p>Email: {session?.user.email || "N/A"}</p>
          <p>ID: {session?.user.id || "N/A"}</p>
        </CardContent>
      </Card>
    </div>
  );
}
