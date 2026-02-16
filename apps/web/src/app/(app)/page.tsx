"use client";

import { RiAlarmWarningLine, RiArrowRightLine, RiBarChartGroupedLine, RiServerLine } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { Footprints, Waves } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, XAxis } from "recharts";

import { ActionMenu, ActivityFeed, ControlPlaneEmptyState, KpiStat, SectionHeader, StatusBadge } from "@/components/control-plane";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { apiFetchJson } from "@/lib/api-fetch";
import { deriveHealthStatus } from "@/lib/control-plane/health";
import { authClient } from "@/lib/auth-client";
import { env } from "@glare/env/web";

type SnapshotActivityBucket = {
  bucket: string;
  success: number;
  failed: number;
};

type SnapshotRun = {
  id: string;
  planId: string;
  status: string;
  snapshotId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  planCron: string | null;
};

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

type RepositoryRecord = {
  id: string;
  name: string;
  backend: string;
  repository: string;
  isInitialized?: boolean;
  initializedAt?: string | null;
  primaryWorker: {
    id: string;
    name: string;
    status: string;
    isOnline: boolean;
    lastSeenAt: string | null;
  } | null;
  backupWorkers: Array<{
    id: string;
    name: string;
    status: string;
    isOnline: boolean;
    lastSeenAt: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
};

type TimeRange = "1h" | "6h" | "24h" | "7d";

const RANGE_TO_HOURS: Record<TimeRange, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 120,
  "7d": 24 * 7,
};

const RANGE_TO_BUCKETS: Record<TimeRange, number> = {
  "1h": 30,
  "6h": 72,
  "24h": 24,
  "7d": 196,
};

const snapshotActivityChartConfig = {
  success: {
    label: "Success",
    color: "var(--chart-1)",
    icon: Footprints,
  },
  failed: {
    label: "Failed",
    color: "var(--chart-5)",
    icon: Waves,
  },
} satisfies ChartConfig;

function timeAgo(value: string | null) {
  if (!value) return "never";
  const diffSec = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export default function DashboardPage() {
  const { data: session } = authClient.useSession();
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const { data, isLoading } = useQuery({
    queryKey: ["control-plane-overview", session?.user?.id ?? "anonymous", timeRange],
    enabled: Boolean(session?.user),
    queryFn: async () => {
      const [workersData, reposData, trafficData] = await Promise.all([
        apiFetchJson<{ workers?: WorkerRecord[] }>(`${env.NEXT_PUBLIC_SERVER_URL}/api/workers`, {
          method: "GET",
          retries: 1,
        }),
        apiFetchJson<{ repositories?: RepositoryRecord[] }>(
          `${env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories`,
          {
            method: "GET",
            retries: 1,
          },
        ),
        apiFetchJson<{ buckets?: SnapshotActivityBucket[]; runs?: SnapshotRun[] }>(
          `${env.NEXT_PUBLIC_SERVER_URL}/api/stats/snapshot-activity?hours=${RANGE_TO_HOURS[timeRange]}&buckets=${RANGE_TO_BUCKETS[timeRange]}`,
          {
            method: "GET",
            retries: 1,
          },
        ),
      ]);

      return {
        workers: workersData.workers ?? [],
        repositories: reposData.repositories ?? [],
        snapshotBuckets: trafficData.buckets ?? [],
        snapshotRuns: trafficData.runs ?? [],
      };
    },
  });

  const workers = data?.workers ?? [];
  const repositories = data?.repositories ?? [];
  const snapshotBuckets = data?.snapshotBuckets ?? [];
  const snapshotRuns = data?.snapshotRuns ?? [];

  const stats = useMemo(() => {
    const onlineWorkers = workers.filter((worker) => worker.isOnline);
    const offlineWorkers = workers.filter((worker) => !worker.isOnline);
    const totalRequests = workers.reduce((sum, worker) => sum + worker.requestsTotal, 0);
    const totalErrors = workers.reduce((sum, worker) => sum + worker.errorTotal, 0);
    const unlinkedRepos = repositories.filter((repo) => repo.backupWorkers.length === 0);
    const initializedRepos = repositories.filter((repo) => repo.isInitialized).length;
    const lastSnapshotAt = repositories
      .map((repo) => repo.initializedAt ?? null)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    const errorRate = totalRequests === 0 ? 0 : Number(((totalErrors / totalRequests) * 100).toFixed(2));
    const health = deriveHealthStatus({
      totalWorkers: workers.length,
      offlineWorkers: offlineWorkers.length,
      unlinkedRepositories: unlinkedRepos.length,
      errorRate24h: errorRate,
    });

    const totalRuns = snapshotRuns.length;
    const successRuns = snapshotRuns.filter((r) => r.status === "success").length;
    const failedRuns = snapshotRuns.filter((r) => r.status === "failed").length;
    const successRate = totalRuns === 0 ? 100 : Number(((successRuns / totalRuns) * 100).toFixed(1));
    const lastFailure = snapshotRuns.find((r) => r.status === "failed");

    return {
      onlineWorkers,
      offlineWorkers,
      totalRequests,
      totalErrors,
      errorRate,
      unlinkedRepos,
      initializedRepos,
      lastSnapshotAt,
      health,
      totalRuns,
      successRuns,
      failedRuns,
      successRate,
      lastFailure,
    };
  }, [workers, repositories, snapshotRuns]);

  const hasActivity = snapshotBuckets.some((b) => b.success > 0 || b.failed > 0);

  const chartData = useMemo(
    () =>
      snapshotBuckets.map((b) => ({
        date: b.bucket,
        success: b.success,
        failed: b.failed,
      })),
    [snapshotBuckets],
  );

  const activityEvents = useMemo(() => {
    const events: Array<{ id: string; title: string; detail: string; status: "healthy" | "degraded" | "outage"; at: string }> = [];

    for (const worker of workers.slice(0, 3)) {
      events.push({
        id: `worker-${worker.id}`,
        title: `Worker ${worker.name}`,
        detail: worker.isOnline ? "Heartbeat received" : "Worker offline",
        status: worker.isOnline ? "healthy" : "outage",
        at: worker.lastSeenAt ?? new Date().toISOString(),
      });
    }

    for (const repo of repositories.slice(0, 3)) {
      events.push({
        id: `repo-${repo.id}`,
        title: `Repository ${repo.name}`,
        detail: repo.backupWorkers.length > 0 ? "Worker linkage active" : "Repository unlinked",
        status: repo.backupWorkers.length > 0 ? "healthy" : "degraded",
        at: repo.updatedAt,
      });
    }

    return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 8);
  }, [repositories, workers]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading control plane overview...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Control Plane Overview"
        subtitle="State, change, and next action across fleet, repositories, and reliability signals."
      />

      <Card className="border-border/80">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <StatusBadge status={stats.health} />
              <h2 className="text-2xl font-semibold tracking-tight">
                {stats.health === "healthy"
                  ? "All systems operational"
                  : stats.health === "degraded"
                    ? "Partial degradation"
                    : "Control plane outage"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {stats.onlineWorkers.length}/{workers.length} workers • {repositories.length} repos • {stats.errorRate}% errors (24h)
              </p>
              <p className="text-xs text-muted-foreground">Last incident: — • No incidents in last 7 days</p>
            </div>
            <Button render={<Link href="/workers" />}>
              {stats.health === "healthy" ? "View Fleet" : "Investigate"}
              <RiArrowRightLine className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiStat label="Active Workers" value={stats.onlineWorkers.length} helper={`${stats.offlineWorkers.length} offline`} />
        <KpiStat label="Snapshot Runs" value={stats.totalRuns} helper={`${stats.successRuns} succeeded, ${stats.failedRuns} failed`} />
        <KpiStat label="Success Rate" value={`${stats.successRate}%`} helper={stats.successRate < 90 ? "Below target" : "On track"} />
        <KpiStat
          label="Last Failure"
          value={stats.lastFailure ? timeAgo(stats.lastFailure.startedAt) : "None"}
          helper={stats.lastFailure?.error?.slice(0, 50) ?? "No failures in range"}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Snapshot Activity</CardTitle>
            <CardDescription>Backup runs over time — successes, failures, and retries.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {(["1h", "6h", "24h", "7d"] as TimeRange[]).map((range) => (
              <Button
                key={range}
                size="sm"
                variant={timeRange === range ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setTimeRange(range)}
              >
                {range}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {!hasActivity ? (
            <ControlPlaneEmptyState
              icon={RiBarChartGroupedLine}
              title="No snapshot activity"
              description="No backup plan runs were recorded in the selected range."
            />
          ) : (
            <div className="h-72">
              <ChartContainer config={snapshotActivityChartConfig} className="h-full w-full">
                <BarChart accessibilityLayer data={chartData}>
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    tickMargin={10}
                    axisLine={false}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return ["1h", "6h"].includes(timeRange)
                        ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                        : date.toLocaleDateString(undefined, { weekday: "short" });
                    }}
                  />
                  <Bar dataKey="success" stackId="a" fill="var(--color-success)" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="failed" stackId="a" fill="var(--color-failed)" radius={[4, 4, 0, 0]} />
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={false} />
                </BarChart>
              </ChartContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fleet</CardTitle>
            <CardDescription>Top workers and immediate operational actions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {workers.length === 0 ? (
              <ControlPlaneEmptyState
                icon={RiServerLine}
                title="No workers registered"
                description="Add workers to begin fleet execution and telemetry collection."
              />
            ) : (
              workers.slice(0, 6).map((worker) => (
                <div key={worker.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2">
                  <RiServerLine className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{worker.name}</p>
                    <p className="truncate text-xs text-muted-foreground">Last seen {timeAgo(worker.lastSeenAt)}</p>
                  </div>
                  <StatusBadge status={worker.isOnline ? "healthy" : "outage"} label={worker.isOnline ? "Online" : "Offline"} />
                  <ActionMenu
                    items={[
                      { label: "Logs", onSelect: () => {} },
                      { label: "Restart", onSelect: () => {} },
                      { label: "Drain", onSelect: () => {} },
                    ]}
                  />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <ActivityFeed title="Recent Activity" events={activityEvents} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Incident Posture</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <RiAlarmWarningLine className="size-4" />
          No incidents in last 7 days.
        </CardContent>
      </Card>
    </div>
  );
}
