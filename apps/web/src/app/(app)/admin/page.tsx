import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">Global user administration pages.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Management</CardTitle>
          <CardDescription>Review authenticated users and worker ownership setup.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link className="text-sm text-primary hover:underline" href="/admin/users">
            Open users
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
