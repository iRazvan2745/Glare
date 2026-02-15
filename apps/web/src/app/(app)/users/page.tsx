"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

export default function UsersPage() {
  const { data: session } = authClient.useSession();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">User Profile</h1>
        <p className="text-sm text-muted-foreground">Identity and account information.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{session?.user.name || "Unknown user"}</CardTitle>
          <CardDescription>{session?.user.email || "No email"}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          User ID: {session?.user.id || "N/A"}
        </CardContent>
      </Card>
    </div>
  );
}
