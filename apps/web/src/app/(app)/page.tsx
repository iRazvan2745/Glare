"use client";

import {
  RiAlarmWarningLine,
  RiArchiveLine,
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiDatabase2Line,
  RiErrorWarningLine,
  RiStackLine,
  RiServerLine,
  RiTimeLine,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo } from "react";

import { KpiStat, StatusBadge } from "@/components/control-plane";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";
import { deriveHealthStatus } from "@/lib/control-plane/health";
import { parseAsStringEnum, useQueryState } from "nuqs";

import {
  ChartsSection,
  formatBytes,
  type SnapshotInsights,
  type StorageInsights,
} from "../../components/home/charts-section";
import { FleetSection } from "../../components/home/fleet-section";

// ─── Types ───────────────────────────────────────────────────────────────────

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

type StorageUsageBucket = {
  bucket: string;
  bytesAdded: string;
  totalBytes: string;
};

type DedupRow = {
  label: string;
  bytesAdded: number;
  bytesProcessed: number;
  savedBytes: number;
  savingsPercent: number;
};

type AnomalyRow = {
  id: string;
  status: string;
  severity: string;
  reason: string;
  score: string;
  expectedBytes: string;
  actualBytes: string;
  detectedAt: string;
  resolvedAt: string | null;
  planName: string | null;
  repositoryName: string | null;
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

// ─── Constants ───────────────────────────────────────────────────────────────

const TIME_RANGES = ["1h", "6h", "24h", "7d"] as const;
type TimeRange = (typeof TIME_RANGES)[number];

const timeRangeParser = parseAsStringEnum<string>([...TIME_RANGES] as string[]).withDefault("24h");

function getHours(timeRange: string): number {
  return RANGE_TO_HOURS[timeRange as TimeRange] ?? 24;
}

function getBuckets(timeRange: string): number {
  return RANGE_TO_BUCKETS[timeRange as TimeRange] ?? 24;
}

const RANGE_TO_HOURS: Record<TimeRange, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  "7d": 24 * 7,
};

const RANGE_TO_BUCKETS: Record<TimeRange, number> = {
  "1h": 30,
  "6h": 72,
  "24h": 24,
  "7d": 196,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(value: string | null) {
  if (!value) return "never";
  const diffSec = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: session } = authClient.useSession();
  const [timeRange, setTimeRange] = useQueryState("timeRange", timeRangeParser);

  const { data, isLoading } = useQuery({
    queryKey: ["control-plane-overview", session?.user?.id ?? "anonymous", timeRange],
    enabled: Boolean(session?.user),
    queryFn: async () => {
      const hours = getHours(timeRange);
      const buckets = getBuckets(timeRange);

      const [workersData, reposData, trafficData, storageData, dedupData, anomalyData] =
        await Promise.all([
          apiFetchJson<{ workers?: WorkerRecord[] }>(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/workers`, {
            method: "GET",
            retries: 1,
          }),
          apiFetchJson<{ repositories?: RepositoryRecord[] }>(
            `${process.env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories`,
            { method: "GET", retries: 1 },
          ),
          apiFetchJson<{ buckets?: SnapshotActivityBucket[]; runs?: SnapshotRun[] }>(
            `${process.env.NEXT_PUBLIC_SERVER_URL}/api/stats/snapshot-activity?hours=${hours}&buckets=${buckets}`,
            { method: "GET", retries: 1 },
          ),
          apiFetchJson<{ buckets?: StorageUsageBucket[] }>(
            `${process.env.NEXT_PUBLIC_SERVER_URL}/api/stats/storage-usage?hours=${hours}&intervalMinutes=5`,
            { method: "GET", retries: 1 },
          ),
          apiFetchJson<{ rows?: DedupRow[] }>(
            `${process.env.NEXT_PUBLIC_SERVER_URL}/api/stats/dedup?hours=${hours}&groupBy=repository`,
            { method: "GET", retries: 1 },
          ),
          apiFetchJson<{ rows?: AnomalyRow[] }>(
            `${process.env.NEXT_PUBLIC_SERVER_URL}/api/stats/anomalies?hours=${hours}&status=open`,
            { method: "GET", retries: 1 },
          ),
        ]);

      return {
        workers: workersData.workers ?? [],
        repositories: reposData.repositories ?? [],
        snapshotBuckets: trafficData.buckets ?? [],
        snapshotRuns: trafficData.runs ?? [],
        storageBuckets: storageData.buckets ?? [],
        dedupRows: dedupData.rows ?? [],
        anomalies: anomalyData.rows ?? [],
      };
    },
  });

  const workers = data?.workers ?? [];
  const repositories = data?.repositories ?? [];
  const snapshotBuckets = data?.snapshotBuckets ?? [];
  const snapshotRuns = data?.snapshotRuns ?? [];
  const storageBuckets = data?.storageBuckets ?? [];
  const dedupRows = data?.dedupRows ?? [];
  const anomalies = data?.anomalies ?? [];

  const stats = useMemo(() => {
    const onlineWorkers = workers.filter((w) => w.isOnline);
    const offlineWorkers = workers.filter((w) => !w.isOnline);
    const totalRequests = workers.reduce((sum, w) => sum + w.requestsTotal, 0);
    const totalErrors = workers.reduce((sum, w) => sum + w.errorTotal, 0);
    const unlinkedRepos = repositories.filter((r) => r.backupWorkers.length === 0);
    const initializedRepos = repositories.filter((r) => r.isInitialized).length;
    const lastSnapshotAt =
      repositories
        .map((r) => r.initializedAt ?? null)
        .filter((v): v is string => Boolean(v))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    const errorRate =
      totalRequests === 0 ? 0 : Number(((totalErrors / totalRequests) * 100).toFixed(2));
    const health = deriveHealthStatus({
      totalWorkers: workers.length,
      offlineWorkers: offlineWorkers.length,
      unlinkedRepositories: unlinkedRepos.length,
      errorRate24h: errorRate,
    });

    const totalRuns = snapshotRuns.length;
    const successRuns = snapshotRuns.filter((r) => r.status === "success").length;
    const failedRuns = snapshotRuns.filter((r) => r.status === "failed").length;
    const successRate =
      totalRuns === 0 ? 100 : Number(((successRuns / totalRuns) * 100).toFixed(1));
    const lastFailure = snapshotRuns.find((r) => r.status === "failed");
    const totalSavedBytes = dedupRows.reduce((sum, r) => sum + r.savedBytes, 0);
    const avgSavingsPercent =
      dedupRows.length > 0
        ? Number(
            (dedupRows.reduce((sum, r) => sum + r.savingsPercent, 0) / dedupRows.length).toFixed(1),
          )
        : 0;

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
      totalSavedBytes,
      avgSavingsPercent,
    };
  }, [workers, repositories, snapshotRuns, dedupRows]);

  const hasActivity = snapshotBuckets.some((b) => b.success > 0 || b.failed > 0);

  const activityEvents = useMemo(() => {
    const events: Array<{
      id: string;
      title: string;
      detail: string;
      status: "healthy" | "degraded" | "outage";
      at: string;
    }> = [];

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

  const storageChartData = useMemo(
    () =>
      storageBuckets.map((b) => ({
        date: b.bucket,
        bytesAdded: Number(b.bytesAdded) || 0,
        totalBytes: Number(b.totalBytes) || 0,
      })),
    [storageBuckets],
  );

  const storageLine = useMemo(() => {
    if (storageChartData.length === 0)
      return { data: [] as Array<{ date: string; cumulativeDisplay: number }>, splitIndex: -1 };

    const totalBuckets = getBuckets(timeRange);
    const lastReal = storageChartData[storageChartData.length - 1]!;
    const stepMs =
      storageChartData.length > 1
        ? Math.max(
            60_000,
            new Date(lastReal.date).getTime() -
              new Date(storageChartData[storageChartData.length - 2]!.date).getTime(),
          )
        : Math.max(
            60_000,
            Math.floor((getHours(timeRange) * 60 * 60 * 1000) / Math.max(2, totalBuckets)),
          );

    const missingCount = Math.max(0, totalBuckets - storageChartData.length);
    const filled = storageChartData.map((p) => ({
      date: p.date,
      cumulativeDisplay: p.totalBytes,
    }));

    for (let i = 0; i < missingCount; i += 1) {
      filled.push({
        date: new Date(new Date(lastReal.date).getTime() + stepMs * (i + 1)).toISOString(),
        cumulativeDisplay: lastReal.totalBytes,
      });
    }

    return {
      data: filled,
      splitIndex: missingCount > 0 ? storageChartData.length - 1 : filled.length + 1,
    };
  }, [storageChartData, timeRange]);

  const hasStorageActivity = storageChartData.some((b) => b.totalBytes > 0);

  const storageInsights = useMemo((): StorageInsights => {
    const now = Date.now();
    const rangeMs = getHours(timeRange) * 60 * 60 * 1000;
    const midpointMs = now - rangeMs / 2;

    const byHalf = storageChartData.reduce(
      (acc, bucket) => {
        const bucketMs = new Date(bucket.date).getTime();
        if (bucketMs >= midpointMs) acc.currentGrowth += bucket.bytesAdded;
        else acc.previousGrowth += bucket.bytesAdded;
        acc.netGrowth += bucket.bytesAdded;
        acc.peakAdded = Math.max(acc.peakAdded, bucket.bytesAdded);
        return acc;
      },
      { currentGrowth: 0, previousGrowth: 0, netGrowth: 0, peakAdded: 0 },
    );

    const currentHours = getHours(timeRange) / 2;
    const dailyGrowth = currentHours > 0 ? (byHalf.currentGrowth / currentHours) * 24 : 0;
    const growthDeltaPct =
      byHalf.previousGrowth === 0
        ? null
        : Number(
            (
              ((byHalf.currentGrowth - byHalf.previousGrowth) / Math.abs(byHalf.previousGrowth)) *
              100
            ).toFixed(1),
          );
    const latestCumulative =
      storageChartData.length > 0 ? storageChartData[storageChartData.length - 1]!.totalBytes : 0;

    return { ...byHalf, dailyGrowth, growthDeltaPct, latestCumulative };
  }, [storageChartData, timeRange]);

  const snapshotInsights = useMemo((): SnapshotInsights => {
    const now = Date.now();
    const rangeMs = getHours(timeRange) * 60 * 60 * 1000;
    const midpointMs = now - rangeMs / 2;

    const getTotals = (runs: SnapshotRun[]) => {
      const success = runs.filter((r) => r.status === "success").length;
      const failed = runs.filter((r) => r.status === "failed").length;
      const total = runs.length;
      const successRate = total === 0 ? 100 : Number(((success / total) * 100).toFixed(1));
      const failureRate = total === 0 ? 0 : Number(((failed / total) * 100).toFixed(1));
      return {
        total,
        success,
        failed,
        unknown: Math.max(0, total - success - failed),
        successRate,
        failureRate,
      };
    };

    const currentRuns = snapshotRuns.filter((r) => new Date(r.startedAt).getTime() >= midpointMs);
    const previousRuns = snapshotRuns.filter((r) => new Date(r.startedAt).getTime() < midpointMs);
    const current = getTotals(currentRuns);
    const previous = getTotals(previousRuns);

    return {
      current,
      failedDelta: current.failed - previous.failed,
      failureRateDelta: Number((current.failureRate - previous.failureRate).toFixed(1)),
    };
  }, [snapshotRuns, timeRange]);

  const snapshotLineData = useMemo(() => {
    const snapshotChartData = snapshotBuckets.map((b) => ({
      date: b.bucket,
      success: b.success,
      failed: b.failed,
    }));

    if (snapshotChartData.length === 0) {
      return {
        data: [] as Array<{ date: string; success: number; failed: number }>,
        splitIndex: -1,
      };
    }

    const totalBuckets = getBuckets(timeRange);
    const lastReal = snapshotChartData[snapshotChartData.length - 1]!;
    const stepMs =
      snapshotChartData.length > 1
        ? Math.max(
            60_000,
            new Date(lastReal.date).getTime() -
              new Date(snapshotChartData[snapshotChartData.length - 2]!.date).getTime(),
          )
        : Math.max(
            60_000,
            Math.floor((getHours(timeRange) * 60 * 60 * 1000) / Math.max(2, totalBuckets)),
          );

    const missingCount = Math.max(0, totalBuckets - snapshotChartData.length);
    const filled = snapshotChartData.map((p) => ({
      date: p.date,
      success: p.success,
      failed: p.failed,
    }));

    for (let i = 0; i < missingCount; i += 1) {
      filled.push({
        date: new Date(new Date(lastReal.date).getTime() + stepMs * (i + 1)).toISOString(),
        success: lastReal.success,
        failed: lastReal.failed,
      });
    }

    return {
      data: filled,
      splitIndex: missingCount > 0 ? snapshotChartData.length - 1 : filled.length + 1,
    };
  }, [snapshotBuckets, timeRange]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading control plane overview...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
                {stats.onlineWorkers.length}/{workers.length} workers • {repositories.length} repos
                • {stats.errorRate}% errors (24h)
              </p>
              <p className="text-xs text-muted-foreground">
                Last incident: — • No incidents in last 7 days
              </p>
            </div>
            <div className="flex items-end gap-2">
              {TIME_RANGES.map((range) => (
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
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiStat
          label="Active Workers"
          value={stats.onlineWorkers.length}
          helper={`${stats.offlineWorkers.length} offline`}
          icon={RiServerLine}
          color="blue"
        />
        <KpiStat
          label="Snapshot Runs"
          value={stats.totalRuns}
          helper={`${stats.successRuns} succeeded, ${stats.failedRuns} failed`}
          icon={RiArchiveLine}
          color="violet"
        />
        <KpiStat
          label="Success Rate"
          value={`${stats.successRate}%`}
          helper={stats.successRate < 90 ? "Below target" : "On track"}
          icon={RiCheckboxCircleLine}
          color="green"
        />
        <KpiStat
          label="Last Failure"
          value={stats.lastFailure ? timeAgo(stats.lastFailure.startedAt) : "None"}
          helper={stats.lastFailure?.error?.slice(0, 50) ?? "No failures in range"}
          icon={RiTimeLine}
          color="red"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiStat
          label="Open Anomalies"
          value={anomalies.length}
          helper={anomalies.length > 0 ? "Review backup outliers" : "No outliers detected"}
          icon={RiErrorWarningLine}
          color="amber"
        />
        <KpiStat
          label="Saved Storage"
          value={formatBytes(stats.totalSavedBytes)}
          helper={`Avg savings ${stats.avgSavingsPercent}%`}
          icon={RiDatabase2Line}
          color="blue"
        />
        <KpiStat
          label="Dedup Groups"
          value={dedupRows.length}
          helper="Repositories with metric samples"
          icon={RiStackLine}
          color="violet"
        />
      </div>

      <ChartsSection
        timeRange={timeRange as TimeRange}
        storageLine={storageLine}
        snapshotLineData={snapshotLineData}
        storageInsights={storageInsights}
        snapshotInsights={snapshotInsights}
        hasStorageActivity={hasStorageActivity}
        hasActivity={hasActivity}
      />

      <FleetSection workers={workers} activityEvents={activityEvents} />

      <Card>
        <CardContent className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <RiAlarmWarningLine className="size-4" />
          No incidents in last 7 days.
        </CardContent>
      </Card>
    </div>
  );
}
