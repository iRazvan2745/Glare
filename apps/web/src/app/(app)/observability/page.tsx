"use client";

import {
  RiAlarmWarningLine,
  RiArrowLeftRightLine,
  RiErrorWarningLine,
  RiPercentLine,
  RiPulseLine,
  RiServerLine,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useCallback, useMemo } from "react";

import { ActivityFeed, KpiStat, SectionHeader, StatusBadge } from "@/components/control-plane";
import {
  DataTableFilter,
  useDataTableFilters,
  type FiltersState,
} from "@/components/data-table-filter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";

type ObservabilityEvent = {
  id: string;
  type: string;
  status: "open" | "resolved" | string;
  severity: "info" | "warning" | "error" | string;
  message: string;
  repositoryId: string;
  workerId: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

type OverviewResponse = {
  summary: {
    totalWorkers: number;
    onlineWorkers: number;
    degradedWorkers: number;
    offlineWorkers: number;
    requests24h: number;
    errors24h: number;
    errorRatePercent: number;
  };
  incidents: ObservabilityEvent[];
  traffic: Array<{ timestamp: string; requests: number; errors: number }>;
  range: string;
};

type EventsResponse = {
  events: ObservabilityEvent[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
};

type AuditLogRecord = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
};

function formatNumber(value: number) {
  return value.toLocaleString();
}

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

function severityToBadge(severity: string) {
  if (severity === "error") return "outage" as const;
  if (severity === "warning") return "degraded" as const;
  return "healthy" as const;
}

const RANGE_TO_HOURS: Record<string, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  "7d": 24 * 7,
};

export default function ObservabilityPage() {
  const { data: session } = authClient.useSession();
  const [range, setRange] = useQueryState(
    "range",
    parseAsString.withDefault("24h").withOptions({ history: "replace" }),
  );
  const [severity, setSeverity] = useQueryState(
    "severity",
    parseAsString.withDefault("all").withOptions({ history: "replace" }),
  );
  const [status, setStatus] = useQueryState(
    "status",
    parseAsString.withDefault("all").withOptions({ history: "replace" }),
  );
  const [page, setPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1).withOptions({ history: "replace" }),
  );

  const pageSize = 25;
  const offset = Math.max(0, (page - 1) * pageSize);

  const overviewQuery = useQuery({
    queryKey: ["observability-overview", session?.user?.id ?? "anonymous", range],
    enabled: Boolean(session?.user),
    queryFn: () =>
      apiFetchJson<OverviewResponse>(
        `${process.env.NEXT_PUBLIC_SERVER_URL}/api/observability/overview?range=${range}`,
        {
          method: "GET",
        },
      ),
  });

  const eventsQuery = useQuery({
    queryKey: ["observability-events", session?.user?.id ?? "anonymous", severity, status, page],
    enabled: Boolean(session?.user),
    queryFn: () =>
      apiFetchJson<EventsResponse>(
        `${process.env.NEXT_PUBLIC_SERVER_URL}/api/observability/events?severity=${severity}&status=${status}&limit=${pageSize}&offset=${offset}`,
        { method: "GET" },
      ),
  });

  const auditQuery = useQuery({
    queryKey: ["audit-logs", session?.user?.id ?? "anonymous"],
    enabled: Boolean(session?.user),
    queryFn: () =>
      apiFetchJson<{ logs: AuditLogRecord[] }>(
        `${process.env.NEXT_PUBLIC_SERVER_URL}/api/audit/logs?limit=20`,
        {
          method: "GET",
        },
      ),
  });

  const summary = overviewQuery.data?.summary;

  const observabilityFilterColumnsConfig = useMemo(
    () => [
      {
        id: "severity",
        accessor: (_event: ObservabilityEvent) => severity,
        displayName: "Severity",
        icon: RiErrorWarningLine,
        type: "option" as const,
        options: [
          { label: "Error", value: "error" },
          { label: "Warning", value: "warning" },
          { label: "Info", value: "info" },
        ],
      },
      {
        id: "status",
        accessor: (_event: ObservabilityEvent) => status,
        displayName: "Status",
        icon: RiAlarmWarningLine,
        type: "option" as const,
        options: [
          { label: "Open", value: "open" },
          { label: "Resolved", value: "resolved" },
        ],
      },
    ],
    [severity, status],
  );

  const observabilityFilters = useMemo<FiltersState>(() => {
    const next: FiltersState = [];
    if (severity !== "all") {
      next.push({
        columnId: "severity",
        type: "option",
        operator: "is",
        values: [severity],
      });
    }
    if (status !== "all") {
      next.push({
        columnId: "status",
        type: "option",
        operator: "is",
        values: [status],
      });
    }
    return next;
  }, [severity, status]);

  const onObservabilityFiltersChange = useCallback(
    (nextFilters: FiltersState | ((prev: FiltersState) => FiltersState)) => {
      const resolved =
        typeof nextFilters === "function" ? nextFilters(observabilityFilters) : nextFilters;
      const nextSeverity = String(
        resolved.find((entry) => entry.columnId === "severity")?.values?.[0] ?? "all",
      );
      const nextStatus = String(
        resolved.find((entry) => entry.columnId === "status")?.values?.[0] ?? "all",
      );
      void setPage(1);
      void setSeverity(nextSeverity);
      void setStatus(nextStatus);
    },
    [observabilityFilters, setPage, setSeverity, setStatus],
  );

  const {
    actions: observabilityFilterActions,
    columns: observabilityFilterColumns,
    filters: activeObservabilityFilters,
    strategy: observabilityFilterStrategy,
  } = useDataTableFilters({
    strategy: "server",
    data: [],
    columnsConfig: observabilityFilterColumnsConfig,
    filters: observabilityFilters,
    onFiltersChange: onObservabilityFiltersChange,
  });

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Observability"
        subtitle="Unified telemetry, incidents, and operational activity for the control plane."
        actions={
          <div className="inline-flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                window.open(
                  `${process.env.NEXT_PUBLIC_SERVER_URL}/api/compliance/report.csv?hours=${RANGE_TO_HOURS[range] ?? 24}`,
                  "_blank",
                )
              }
            >
              Export CSV
            </Button>
            {["1h", "6h", "24h", "7d"].map((nextRange) => (
              <Button
                key={nextRange}
                size="sm"
                variant={range === nextRange ? "default" : "outline"}
                onClick={() => void setRange(nextRange)}
              >
                {nextRange}
              </Button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <KpiStat
          label="Workers Online"
          value={`${summary?.onlineWorkers ?? 0}/${summary?.totalWorkers ?? 0}`}
          helper="Current fleet"
          icon={RiServerLine}
          color="green"
        />
        <KpiStat
          label="Requests (range)"
          value={formatNumber(summary?.requests24h ?? 0)}
          helper="Aggregated worker sync telemetry"
          icon={RiArrowLeftRightLine}
          color="blue"
        />
        <KpiStat
          label="Errors (range)"
          value={formatNumber(summary?.errors24h ?? 0)}
          helper="All error signals"
          icon={RiErrorWarningLine}
          color="red"
        />
        <KpiStat
          label="Error Rate"
          value={`${summary?.errorRatePercent ?? 0}%`}
          helper="Derived from request/error totals"
          icon={RiPercentLine}
          color="amber"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <RiPulseLine className="size-4" />
            Traffic & Reliability
          </CardTitle>
          <CardDescription>Requests and errors over time with stable data density.</CardDescription>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={overviewQuery.data?.traffic ?? []}>
              <defs>
                <linearGradient id="obsRequests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f9cff" stopOpacity={0.32} />
                  <stop offset="95%" stopColor="#4f9cff" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="obsErrors" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(value) => new Date(value).toLocaleTimeString()}
                minTickGap={28}
              />
              <YAxis />
              <Tooltip
                formatter={(value: number, name: string) => [
                  formatNumber(value),
                  name === "requests" ? "Requests" : "Errors",
                ]}
                labelFormatter={(value) => new Date(value).toLocaleString()}
              />
              <Area
                type="linear"
                dataKey="requests"
                stroke="#4f9cff"
                fill="url(#obsRequests)"
                strokeWidth={2}
              />
              <Area
                type="linear"
                dataKey="errors"
                stroke="#f87171"
                fill="url(#obsErrors)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2 text-base">
              <RiAlarmWarningLine className="size-4" />
              Incidents (Last 7 Days)
            </CardTitle>
            <CardDescription>
              Recent operational incidents emitted by backup workers and plans.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityFeed
              events={(overviewQuery.data?.incidents ?? [])
                .filter((incident) => incident.severity === "error")
                .slice(0, 10)
                .map((incident) => ({
                  id: incident.id,
                  title: incident.type.replace(/_/g, " "),
                  detail: incident.message,
                  at: incident.createdAt,
                  status: "outage" as const,
                }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2 text-base">
              <RiErrorWarningLine className="size-4" />
              Event Stream
            </CardTitle>
            <CardDescription>Paginated event stream to avoid oversized payloads.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DataTableFilter
              columns={observabilityFilterColumns}
              filters={activeObservabilityFilters}
              actions={observabilityFilterActions}
              strategy={observabilityFilterStrategy}
            />

            <div className="space-y-2">
              {(eventsQuery.data?.events ?? []).map((event) => (
                <div key={event.id} className="rounded-md border border-border/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{event.type.replace(/_/g, " ")}</p>
                    <StatusBadge status={severityToBadge(event.severity)} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{event.message}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatTime(event.createdAt)}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
              <span>
                Showing {eventsQuery.data?.events.length ?? 0} of{" "}
                {eventsQuery.data?.pagination.total ?? 0}
              </span>
              <div className="inline-flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void setPage(page + 1)}
                  disabled={!eventsQuery.data?.pagination.hasMore}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit Log</CardTitle>
          <CardDescription>
            Recent user actions across plans, restores, and policy changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(auditQuery.data?.logs ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No audit records available.</p>
          ) : (
            (auditQuery.data?.logs ?? []).map((log) => (
              <div key={log.id} className="rounded-md border border-border/60 p-2">
                <p className="text-xs font-medium">{log.action}</p>
                <p className="text-[11px] text-muted-foreground">
                  {log.resourceType}
                  {log.resourceId ? ` • ${log.resourceId}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground">{formatTime(log.createdAt)}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
