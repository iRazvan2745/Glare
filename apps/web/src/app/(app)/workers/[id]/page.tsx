"use client";

import {
  ArrowLeft,
  Minus,
  Wifi,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";
import { env } from "@glare/env/web";

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

function formatUptime(ms: number) {
  if (ms <= 0) return "\u2014";
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
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function errorRate(requests: number, errors: number) {
  if (requests === 0) return 0;
  return Number(((errors / requests) * 100).toFixed(2));
}

function formatDateTime(dateString: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(dateString));
}

export default function WorkerDetailPage() {
  const params = useParams<{ id: string }>();
  const workerId = params?.id ?? "";
  const { data: session } = authClient.useSession();

  const [worker, setWorker] = useState<WorkerRecord | null>(null);
  const [events, setEvents] = useState<SyncEventRecord[]>([]);
  const [hoveredHeatmapEvent, setHoveredHeatmapEvent] = useState<SyncEventRecord | null>(null);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(
    async (silent = false) => {
      if (!session?.user || !workerId) {
        setIsLoading(false);
        return;
      }

      if (!silent) setIsLoading(true);

      try {
        const [workersData, eventsData] = await Promise.all([
          apiFetchJson<{ workers?: WorkerRecord[] }>(`${env.NEXT_PUBLIC_SERVER_URL}/api/workers`, {
            method: "GET",
            retries: 1,
          }),
          apiFetchJson<{ events?: SyncEventRecord[] }>(
            `${env.NEXT_PUBLIC_SERVER_URL}/api/workers/${workerId}/sync-events?hours=24`,
            {
              method: "GET",
              retries: 1,
            },
          ),
        ]);

        const found = workersData.workers?.find((w) => w.id === workerId) ?? null;
        if (!found && !silent) {
          setError("Worker not found");
        }
        setWorker(found);

        if (eventsData.events) {
          setEvents(eventsData.events);
        } else {
          setError("Failed to load worker");
        }
      } catch {
        if (!silent) setError("Failed to load data");
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [session?.user, workerId],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!session?.user || !workerId) return;

    const intervalId = window.setInterval(() => void loadData(true), 15_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadData(true);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadData, session?.user, workerId]);

  const metricsChartData = useMemo(
    () =>
      events.map((e) => ({
        eventId: e.id,
        fullTime: e.createdAt,
        requests: e.requestsTotal,
        errors: e.errorTotal,
      })),
    [events],
  );

  const recentEvents = useMemo(() => [...events].reverse().slice(0, 50), [events]);
  const uptimeHeatmap = useMemo(() => events.slice(-72), [events]);
  const latestEventMetrics = useMemo(
    () =>
      events.reduce<SyncEventRecord | null>((latest, event) => {
        if (!latest) return event;
        return new Date(event.createdAt).getTime() > new Date(latest.createdAt).getTime()
          ? event
          : latest;
      }, null),
    [events],
  );
  const requestsTotal = latestEventMetrics?.requestsTotal ?? worker?.requestsTotal ?? 0;
  const errorsTotal = latestEventMetrics?.errorTotal ?? worker?.errorTotal ?? 0;
  const rate = useMemo(() => errorRate(requestsTotal, errorsTotal), [errorsTotal, requestsTotal]);
  const hasMetricsData = metricsChartData.length > 0;
  const activeHeatmapEvent = hoveredHeatmapEvent ?? uptimeHeatmap[uptimeHeatmap.length - 1] ?? null;

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading worker details...</div>
      </div>
    );
  }

  if (error || !worker) {
    return (
      <div className="space-y-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Worker not available</CardTitle>
            <CardDescription>{error || "Unable to find this worker."}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<Link href="/workers" />}>
              <ArrowLeft className="size-4" />
              Back to workers
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="icon-sm" render={<Link href="/workers" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{worker.name}</h1>
        <Badge variant={worker.isOnline ? "default" : "outline"} className="gap-1.5">
          {worker.isOnline ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
          {worker.isOnline ? "Online" : "Offline"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Last seen {timeAgo(worker.lastSeenAt)}
        </span>
      </div>

      {/* Charts */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Uptime Heatmap */}
        <Card>
          <CardHeader>
            <CardTitle>Uptime Heatmap</CardTitle>
            <CardDescription>Recent heartbeat status (last 72 sync events)</CardDescription>
          </CardHeader>
          <CardContent>
            {uptimeHeatmap.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sync events recorded in the last 24 hours.
              </p>
            ) : (
              <div>
                <div className="grid grid-cols-12 gap-1">
                  {uptimeHeatmap.map((event) => {
                    const tone =
                      event.status === "online"
                        ? "bg-emerald-500/80"
                        : event.status === "degraded"
                          ? "bg-amber-500/80"
                          : event.status === "offline"
                            ? "bg-rose-500/70"
                            : "bg-muted";
                    return (
                      <span
                        key={event.id}
                        title={`${formatDateTime(event.createdAt)} - ${event.status}`}
                        className={`inline-block h-6 w-full rounded-sm ${tone} cursor-pointer`}
                        aria-label={`${event.status} at ${formatDateTime(event.createdAt)}`}
                        onMouseEnter={() => setHoveredHeatmapEvent(event)}
                        onFocus={() => setHoveredHeatmapEvent(event)}
                        onMouseLeave={() => setHoveredHeatmapEvent(null)}
                      />
                    );
                  })}
                </div>
                {activeHeatmapEvent ? (
                  <div className="mt-3 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {formatDateTime(activeHeatmapEvent.createdAt)}
                    </span>
                    {" \u00b7 "}
                    status: {activeHeatmapEvent.status}
                    {" \u00b7 "}
                    req: {formatNumber(activeHeatmapEvent.requestsTotal)}
                    {" \u00b7 "}
                    err: {formatNumber(activeHeatmapEvent.errorTotal)}
                    {" \u00b7 "}
                    up: {formatUptime(activeHeatmapEvent.uptimeMs)}
                  </div>
                ) : null}
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-emerald-500/80" />
                    Online
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-amber-500/80" />
                    Degraded
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-muted" />
                    Offline
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Metrics Card + Microchart */}
        <Card>
          <CardHeader>
            <CardTitle>Worker Metrics</CardTitle>
            <CardDescription>Microchart + key health stats</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">Requests</p>
                <p className="text-base font-semibold tabular-nums">{formatNumber(requestsTotal)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Errors</p>
                <p className="text-base font-semibold tabular-nums">{formatNumber(errorsTotal)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Error Rate</p>
                <p className="text-base font-semibold tabular-nums">{rate}%</p>
              </div>
            </div>
            <div className="relative h-24">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={metricsChartData}
                  onClick={(state) => {
                    const entry = (
                      state as
                        | { activePayload?: Array<{ payload?: { eventId?: string } }> }
                        | undefined
                    )?.activePayload?.[0]?.payload;
                    const eventId = entry?.eventId;
                    if (!eventId) return;
                    setHighlightedEventId(eventId);
                    const row = document.getElementById(`sync-event-${eventId}`);
                    row?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                    labelFormatter={(_label, payload) => {
                      const entry = payload?.[0]?.payload as (typeof metricsChartData)[0] | undefined;
                      return entry ? formatDateTime(entry.fullTime) : "";
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="requests"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    dot={false}
                    name="Requests"
                    isAnimationActive={hasMetricsData}
                  />
                  <Line
                    type="monotone"
                    dataKey="errors"
                    stroke="var(--color-chart-5)"
                    strokeWidth={2}
                    dot={false}
                    name="Errors"
                    isAnimationActive={hasMetricsData}
                  />
                </LineChart>
              </ResponsiveContainer>
              {!hasMetricsData ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Minus className="size-3.5" />
                    No sync data yet
                  </span>
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
              <span>Uptime {formatUptime(worker.uptimeMs)}</span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: "var(--chart-1)" }} />
                Requests
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: "var(--chart-5)" }} />
                Errors
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Events Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Sync Events</CardTitle>
          <CardDescription>Last 50 sync heartbeats (newest first)</CardDescription>
        </CardHeader>
        <CardContent>
          {recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sync events recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Timestamp</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium text-right">Uptime</th>
                    <th className="pb-2 pr-4 font-medium text-right">Requests</th>
                    <th className="pb-2 font-medium text-right">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentEvents.map((event) => (
                    <tr
                      id={`sync-event-${event.id}`}
                      key={event.id}
                      className={highlightedEventId === event.id ? "bg-muted/40" : undefined}
                    >
                      <td className="py-1.5 pr-4 tabular-nums">{formatDateTime(event.createdAt)}</td>
                      <td className="py-1.5 pr-4">
                        <span
                          className={`rounded px-1.5 py-0.5 ${
                            event.status === "online"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                              : event.status === "degraded"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {event.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {formatUptime(event.uptimeMs)}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {formatNumber(event.requestsTotal)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatNumber(event.errorTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
