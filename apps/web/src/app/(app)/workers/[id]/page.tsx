"use client";

import {
  RiArrowLeftLine,
  RiArrowLeftRightLine,
  RiErrorWarningLine,
  RiFileList3Line,
  RiPauseCircleLine,
  RiPercentLine,
  RiRefreshLine,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { parseAsInteger, parseAsStringEnum, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { toast } from "@/lib/toast";

import { useDataTableFilters, type FiltersState } from "@/components/data-table-filter";
import { KpiStat, ResourceHeader } from "@/components/control-plane";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deriveHealthStatus } from "@/lib/control-plane/health";
import { apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";

import { UptimeHeatmap } from "./_components/uptime-heatmap";
import { SyncEventsTable } from "./_components/sync-events-table";

// ─── Types ───────────────────────────────────────────────────────────────────

type WorkerRecord = {
  id: string;
  name: string;
  status: "online" | "degraded" | "offline" | string;
  lastSeenAt: string | null;
  uptimeMs: number;
  requestsTotal: number;
  errorTotal: number;
  isOnline: boolean;
  createdAt: string;
  updatedAt: string;
};

type SyncEventRecord = {
  id: string;
  status: string;
  uptimeMs: number;
  requestsTotal: number;
  errorTotal: number;
  createdAt: string;
};

type TimeRange = "1h" | "6h" | "24h" | "7d";
type EventStatusFilter = "all" | "online" | "degraded" | "offline";

type SyncEventsResponse = {
  events?: SyncEventRecord[];
  pagination?: { total: number; limit: number; offset: number; hasMore: boolean };
};

// ─── Constants ───────────────────────────────────────────────────────────────

const RANGE_TO_HOURS: Record<TimeRange, number> = { "1h": 1, "6h": 6, "24h": 96, "7d": 24 * 7 };
const RANGE_TO_BUCKETS: Record<TimeRange, number> = { "1h": 18, "6h": 48, "24h": 24, "7d": 168 };
const RANGE_TO_EVENT_LIMIT: Record<TimeRange, number> = {
  "1h": 180,
  "6h": 240,
  "24h": 300,
  "7d": 500,
};
const EVENTS_PAGE_SIZE = 25;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUptime(ms: number) {
  if (ms <= 0) return "—";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDateTime(dateString: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(dateString));
}

function timeAgo(dateString: string | null) {
  if (!dateString) return "Never";
  const diff = Date.now() - new Date(dateString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function WorkerDetailPage() {
  const params = useParams<{ id: string }>();
  const workerId = params?.id ?? "";
  const { data: session } = authClient.useSession();

  const [statusFilter, setStatusFilter] = useQueryState(
    "status",
    parseAsStringEnum(["all", "online", "degraded", "offline"]).withDefault("all").withOptions({
      history: "replace",
    }),
  );
  const [page, setPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1).withOptions({ history: "replace" }),
  );
  const [timeRange, setTimeRange] = useQueryState(
    "range",
    parseAsStringEnum(["1h", "6h", "24h", "7d"]).withDefault("24h").withOptions({
      history: "replace",
    }),
  );

  const tableOffset = Math.max(0, (page - 1) * EVENTS_PAGE_SIZE);

  const { data, isLoading, error } = useQuery({
    queryKey: [
      "worker-detail",
      session?.user?.id ?? "anonymous",
      workerId,
      timeRange,
      statusFilter,
      page,
    ],
    enabled: Boolean(session?.user && workerId),
    queryFn: async () => {
      const [workersData, chartEventsData, tableEventsData] = await Promise.all([
        apiFetchJson<{ workers?: WorkerRecord[] }>(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/workers`, {
          method: "GET",
          retries: 1,
        }),
        apiFetchJson<SyncEventsResponse>(
          `${process.env.NEXT_PUBLIC_SERVER_URL}/api/workers/${workerId}/sync-events?hours=${RANGE_TO_HOURS[timeRange]}&limit=${RANGE_TO_EVENT_LIMIT[timeRange]}`,
          { method: "GET", retries: 1 },
        ),
        apiFetchJson<SyncEventsResponse>(
          `${process.env.NEXT_PUBLIC_SERVER_URL}/api/workers/${workerId}/sync-events?hours=${RANGE_TO_HOURS[timeRange]}&status=${statusFilter}&limit=${EVENTS_PAGE_SIZE}&offset=${tableOffset}`,
          { method: "GET", retries: 1 },
        ),
      ]);

      return {
        worker: workersData.workers?.find((w) => w.id === workerId) ?? null,
        chartEvents: chartEventsData.events ?? [],
        tableEvents: tableEventsData.events ?? [],
        tableTotal: tableEventsData.pagination?.total ?? tableEventsData.events?.length ?? 0,
      };
    },
  });

  const worker = data?.worker ?? null;
  const chartEvents = data?.chartEvents ?? [];
  const tableEvents = data?.tableEvents ?? [];
  const tableTotal = data?.tableTotal ?? 0;

  const latestEventMetrics = useMemo(
    () =>
      chartEvents.reduce<SyncEventRecord | null>((latest, event) => {
        if (!latest) return event;
        return new Date(event.createdAt).getTime() > new Date(latest.createdAt).getTime()
          ? event
          : latest;
      }, null),
    [chartEvents],
  );

  const requestsTotal = latestEventMetrics?.requestsTotal ?? worker?.requestsTotal ?? 0;
  const errorsTotal = latestEventMetrics?.errorTotal ?? worker?.errorTotal ?? 0;
  const rate = requestsTotal === 0 ? 0 : Number(((errorsTotal / requestsTotal) * 100).toFixed(2));

  const metricsChartData = useMemo(() => {
    if (chartEvents.length === 0) return [];

    const sorted = [...chartEvents].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const rangeHours = RANGE_TO_HOURS[timeRange];
    const bucketCount = RANGE_TO_BUCKETS[timeRange];
    const rangeMs = rangeHours * 60 * 60 * 1000;
    const now = Date.now();
    const start = now - rangeMs;
    const bucketMs = Math.max(1, Math.floor(rangeMs / bucketCount));

    const buckets = Array.from({ length: bucketCount }).map((_, index) => ({
      fullTime: new Date(start + index * bucketMs + bucketMs).toISOString(),
      requests: 0,
      errors: 0,
    }));

    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index]!;
      const previous = sorted[index - 1];
      const currentMs = new Date(current.createdAt).getTime();
      if (currentMs < start || currentMs > now) continue;

      const requestDelta = previous
        ? Math.max(0, current.requestsTotal - previous.requestsTotal)
        : current.requestsTotal;
      const errorDelta = previous
        ? Math.max(0, current.errorTotal - previous.errorTotal)
        : current.errorTotal;

      const bucketIndex = Math.min(
        bucketCount - 1,
        Math.max(0, Math.floor((currentMs - start) / bucketMs)),
      );
      buckets[bucketIndex]!.requests += requestDelta;
      buckets[bucketIndex]!.errors += errorDelta;
    }

    return buckets;
  }, [chartEvents, timeRange]);

  const pageCount = Math.max(1, Math.ceil(tableTotal / EVENTS_PAGE_SIZE));

  const eventFilterColumnsConfig = useMemo(
    () => [
      {
        id: "status",
        accessor: (_event: SyncEventRecord) => statusFilter,
        displayName: "Status",
        icon: RiRefreshLine,
        type: "option" as const,
        options: [
          { label: "Online", value: "online" },
          { label: "Degraded", value: "degraded" },
          { label: "Offline", value: "offline" },
        ],
      },
    ],
    [statusFilter],
  );

  const eventFilters = useMemo<FiltersState>(() => {
    if (statusFilter === "all") return [];
    return [{ columnId: "status", type: "option", operator: "is", values: [statusFilter] }];
  }, [statusFilter]);

  const onEventFiltersChange = useCallback(
    (nextFilters: FiltersState | ((prev: FiltersState) => FiltersState)) => {
      const resolved = typeof nextFilters === "function" ? nextFilters(eventFilters) : nextFilters;
      const nextStatus = String(
        resolved.find((entry) => entry.columnId === "status")?.values?.[0] ?? "all",
      ) as EventStatusFilter;
      void setStatusFilter(nextStatus);
      void setPage(1);
    },
    [eventFilters, setPage, setStatusFilter],
  );

  const {
    actions: eventFilterActions,
    columns: eventFilterColumns,
    filters: activeEventFilters,
    strategy: eventFilterStrategy,
  } = useDataTableFilters({
    strategy: "server",
    data: [],
    columnsConfig: eventFilterColumnsConfig,
    filters: eventFilters,
    onFiltersChange: onEventFiltersChange,
  });

  useEffect(() => {
    if (page > pageCount) void setPage(pageCount);
  }, [page, pageCount, setPage]);

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading worker details...</div>
      </div>
    );
  }

  if (error || !worker) {
    const errorMessage = error instanceof Error ? error.message : "Unable to find this worker.";
    return (
      <div className="space-y-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Worker not available</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<Link href="/workers" />}>
              <RiArrowLeftLine className="size-4" />
              Back to fleet
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const health = deriveHealthStatus({
    totalWorkers: 1,
    offlineWorkers: worker.isOnline ? 0 : 1,
    errorRate24h: rate,
  });

  return (
    <div className="space-y-4">
      <ResourceHeader
        name={worker.name}
        status={health}
        metadata={[
          `Last seen ${timeAgo(worker.lastSeenAt)}`,
          `Uptime ${formatUptime(worker.uptimeMs)}`,
        ]}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info("Logs view is not available yet.")}
            >
              <RiFileList3Line className="size-4" />
              Logs
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info("Restart action is stubbed.")}
            >
              <RiRefreshLine className="size-4" />
              Restart
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info("Drain action is stubbed.")}
            >
              <RiPauseCircleLine className="size-4" />
              Drain
            </Button>
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-4">
        <KpiStat
          label="Requests (24h)"
          value={formatNumber(requestsTotal)}
          icon={RiArrowLeftRightLine}
          color="blue"
        />
        <KpiStat
          label="Errors (24h)"
          value={formatNumber(errorsTotal)}
          icon={RiErrorWarningLine}
          color="red"
        />
        <KpiStat
          label="Error rate (24h)"
          value={`${rate}%`}
          helper={requestsTotal === 0 ? "No requests recorded" : undefined}
          icon={RiPercentLine}
          color="amber"
        />
        <KpiStat
          label="Sync events"
          value={chartEvents.length}
          icon={RiRefreshLine}
          color="violet"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <UptimeHeatmap events={chartEvents} />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Traffic Trend</CardTitle>
              <CardDescription>Requests and errors over recent sync events.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {(["1h", "6h", "24h", "7d"] as TimeRange[]).map((range) => (
                <Button
                  key={range}
                  size="sm"
                  variant={timeRange === range ? "default" : "outline"}
                  className="h-8 text-xs"
                  onClick={() => void setTimeRange(range)}
                >
                  {range}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {metricsChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sync data yet.</p>
            ) : (
              <div className="h-44 overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={metricsChartData}
                    margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
                  >
                    <RechartsTooltip
                      allowEscapeViewBox={{ x: false, y: false }}
                      wrapperStyle={{ pointerEvents: "none" }}
                      contentStyle={{
                        backgroundColor: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                      labelFormatter={(_label, payload) => {
                        const entry = payload?.[0]?.payload as
                          | (typeof metricsChartData)[0]
                          | undefined;
                        return entry ? formatDateTime(entry.fullTime) : "";
                      }}
                    />
                    <Line
                      type="step"
                      dataKey="requests"
                      stroke="var(--color-chart-1)"
                      strokeWidth={2}
                      dot={false}
                      name="Requests"
                      isAnimationActive={false}
                    />
                    <Line
                      type="step"
                      dataKey="errors"
                      stroke="var(--color-chart-5)"
                      strokeWidth={2}
                      dot={false}
                      name="Errors"
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <SyncEventsTable
        events={tableEvents}
        page={page}
        pageCount={pageCount}
        tableTotal={tableTotal}
        onPageChange={(p) => void setPage(p)}
        filterColumns={eventFilterColumns}
        filterFilters={activeEventFilters}
        filterActions={eventFilterActions}
        filterStrategy={eventFilterStrategy}
      />
    </div>
  );
}
