"use client";

import { apiBaseUrl } from "@/lib/api-base-url";
import { RiRefreshLine } from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";

type AuditLogEntry = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function actionVariant(action: string): "default" | "destructive" | "outline" | "secondary" {
  if (action === "delete") return "destructive";
  if (action === "create") return "secondary";
  return "outline";
}

const LIMIT_OPTIONS = ["25", "50", "100", "200"];

export default function AdminAuditPage() {
  const { data: session } = authClient.useSession();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [limit, setLimit] = useState("50");

  // Derived filter options from loaded data
  const [knownActions, setKnownActions] = useState<string[]>([]);
  const [knownResources, setKnownResources] = useState<string[]>([]);

  const loadLogs = useCallback(async () => {
    if (!session?.user) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit });
      if (actionFilter !== "all") params.set("action", actionFilter);
      if (resourceFilter !== "all") params.set("resourceType", resourceFilter);

      const data = await apiFetchJson<{ logs?: AuditLogEntry[] }>(
        `${apiBaseUrl}/api/audit/logs?${params.toString()}`,
        { method: "GET", retries: 1 },
      );
      const entries = data.logs ?? [];
      setLogs(entries);

      // Collect unique values for filter dropdowns
      const actions = Array.from(new Set(entries.map((e) => e.action))).sort();
      const resources = Array.from(new Set(entries.map((e) => e.resourceType))).sort();
      setKnownActions((prev) => Array.from(new Set([...prev, ...actions])).sort());
      setKnownResources((prev) => Array.from(new Set([...prev, ...resources])).sort());
    } catch {
      toast.error("Could not load audit logs.");
    } finally {
      setIsLoading(false);
    }
  }, [session?.user, actionFilter, resourceFilter, limit]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Audit Log</h2>
          <p className="text-sm text-muted-foreground">
            History of workspace mutations and admin actions.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void loadLogs()}
          disabled={isLoading}
          className="gap-2"
        >
          <RiRefreshLine className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>Recent actions recorded in this workspace.</CardDescription>
          <div className="flex flex-wrap gap-2 pt-1">
            <Select value={actionFilter} onValueChange={(v) => setActionFilter(v ?? "all")}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {knownActions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={resourceFilter} onValueChange={(v) => setResourceFilter(v ?? "all")}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All resources</SelectItem>
                {knownResources.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={limit} onValueChange={(v) => setLimit(v ?? "50")}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMIT_OPTIONS.map((l) => (
                  <SelectItem key={l} value={l}>
                    Last {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Resource ID</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Loading logs...
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No audit logs found.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Badge variant={actionVariant(log.action)}>{log.action}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.resourceType}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {log.resourceId ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.ipAddress ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(log.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
