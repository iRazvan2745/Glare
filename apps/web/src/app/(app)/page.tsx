"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Cloud,
  Database,
  HardDrive,
  Server,
  Shield,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DottedMultiLineChart } from "@/components/charts/dotted-multi-line-chart";
import { authClient } from "@/lib/auth-client";
import { env } from "@glare/env/web";

type TrafficBucket = {
  bucket: string;
  requests: number;
  errors: number;
  errorRate: number;
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
  hasPassword: boolean;
  options: Record<string, string>;
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
  worker?: {
    id: string;
    name: string;
    status: string;
    isOnline: boolean;
    lastSeenAt: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

const BACKEND_META: Record<string, { label: string; icon: typeof Cloud; color: string }> = {
  s3: { label: "S3", icon: Cloud, color: "bg-chart-1" },
  local: { label: "Local", icon: HardDrive, color: "bg-chart-2" },
  b2: { label: "B2", icon: Cloud, color: "bg-chart-3" },
  rest: { label: "REST", icon: Server, color: "bg-chart-4" },
  webdav: { label: "WebDAV", icon: Server, color: "bg-chart-5" },
  sftp: { label: "SFTP", icon: Server, color: "bg-primary" },
  rclone: { label: "rclone", icon: Database, color: "bg-muted-foreground" },
  other: { label: "Other", icon: Database, color: "bg-border" },
};

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

export default function DashboardPage() {
  const { data: session } = authClient.useSession();
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [trafficBuckets, setTrafficBuckets] = useState<TrafficBucket[]>([]);
  const [requestHistory, setRequestHistory] = useState<number[]>([]);
  const [errorHistory, setErrorHistory] = useState<number[]>([]);
  const [errorRateHistory, setErrorRateHistory] = useState<number[]>([]);
  const previousRequestsTotalRef = useRef<number | null>(null);
  const previousErrorsTotalRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(
    async (silent = false) => {
      if (!session?.user) {
        setWorkers([]);
        setRepositories([]);
        setIsLoading(false);
        return;
      }

      if (!silent) setIsLoading(true);

      try {
        const [workersRes, reposRes, trafficRes] = await Promise.all([
          fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/workers`, {
            method: "GET",
            credentials: "include",
          }),
          fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories`, {
            method: "GET",
            credentials: "include",
          }),
          fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/stats/traffic?hours=24&buckets=24`, {
            method: "GET",
            credentials: "include",
          }),
        ]);

        if (workersRes.ok) {
          const data = (await workersRes.json()) as { workers?: WorkerRecord[] };
          setWorkers(data.workers ?? []);
        }

        if (reposRes.ok) {
          const data = (await reposRes.json()) as { repositories?: RepositoryRecord[] };
          setRepositories(data.repositories ?? []);
        }

        if (trafficRes.ok) {
          const data = (await trafficRes.json()) as { buckets?: TrafficBucket[] };
          setTrafficBuckets(data.buckets ?? []);
        }
      } catch {
        /* silent fail on dashboard */
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [session?.user],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!session?.user) return;

    const intervalId = window.setInterval(() => void loadData(true), 5000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadData(true);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadData, session?.user]);

  const stats = useMemo(() => {
    const onlineWorkers = workers.filter((w) => w.isOnline);
    const offlineWorkers = workers.filter((w) => !w.isOnline);
    const totalRequests = workers.reduce((sum, w) => sum + w.requestsTotal, 0);
    const totalErrors = workers.reduce((sum, w) => sum + w.errorTotal, 0);
    const linkedRepos = repositories.filter((r) => r.backupWorkers.length > 0);
    const unlinkedRepos = repositories.filter((r) => r.backupWorkers.length === 0);

    const backendCounts: Record<string, number> = {};
    for (const repo of repositories) {
      backendCounts[repo.backend] = (backendCounts[repo.backend] ?? 0) + 1;
    }

    return {
      onlineWorkers,
      offlineWorkers,
      totalRequests,
      totalErrors,
      errorRate: errorRate(totalRequests, totalErrors),
      linkedRepos,
      unlinkedRepos,
      backendCounts,
    };
  }, [workers, repositories]);

  useEffect(() => {
    if (isLoading) return;
    setRequestHistory((previous) => {
      const previousTotal = previousRequestsTotalRef.current;
      const nextRate =
        previousTotal === null ? 0 : Math.max(stats.totalRequests - previousTotal, 0);
      previousRequestsTotalRef.current = stats.totalRequests;
      const next = [...previous, nextRate];
      return next.slice(-24);
    });
    setErrorHistory((previous) => {
      const previousTotal = previousErrorsTotalRef.current;
      const nextErrors = previousTotal === null ? 0 : Math.max(stats.totalErrors - previousTotal, 0);
      previousErrorsTotalRef.current = stats.totalErrors;
      const next = [...previous, nextErrors];
      return next.slice(-24);
    });
    setErrorRateHistory((previous) => {
      const next = [...previous, stats.errorRate];
      return next.slice(-24);
    });
  }, [isLoading, stats.errorRate, stats.totalErrors, stats.totalRequests]);

  const requestTrend = useMemo(() => {
    if (requestHistory.length < 2) return null;
    const latest = requestHistory[requestHistory.length - 1] ?? 0;
    const previous = requestHistory[requestHistory.length - 2] ?? 0;
    const delta = latest - previous;
    if (delta === 0) return { direction: "flat" as const, delta };
    return { direction: delta > 0 ? ("up" as const) : ("down" as const), delta };
  }, [requestHistory]);

  const errorRateTrend = useMemo(() => {
    if (errorRateHistory.length < 2) return null;
    const latest = errorRateHistory[errorRateHistory.length - 1] ?? 0;
    const previous = errorRateHistory[errorRateHistory.length - 2] ?? 0;
    const delta = Number((latest - previous).toFixed(2));
    if (delta === 0) return { direction: "flat" as const, delta };
    return { direction: delta > 0 ? ("up" as const) : ("down" as const), delta };
  }, [errorRateHistory]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading dashboard...</div>
      </div>
    );
  }

  const hasData = workers.length > 0 || repositories.length > 0;

  if (!hasData) {
    return <EmptyState />;
  }

  const workerCoverage = workers.length > 0 ? (stats.onlineWorkers.length / workers.length) * 100 : 0;
  const systemLabel =
    stats.errorRate >= 5 || stats.offlineWorkers.length > 0
      ? "Needs attention"
      : stats.onlineWorkers.length > 0
        ? "Stable"
        : "No active workers";

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid gap-3 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-base">Operations Overview</CardTitle>
                <CardDescription>Live backup coverage and platform health for the last 24 hours.</CardDescription>
              </div>
              <Badge variant={stats.errorRate >= 5 ? "destructive" : "outline"}>{systemLabel}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0 sm:grid-cols-3">
            <OverviewStat
              label="Worker Availability"
              value={`${workerCoverage.toFixed(0)}%`}
              sub={`${stats.onlineWorkers.length} of ${workers.length} online`}
            />
            <OverviewStat
              label="Repository Coverage"
              value={`${stats.linkedRepos.length}/${repositories.length}`}
              sub={`${stats.unlinkedRepos.length} unlinked`}
            />
            <OverviewStat
              label="Errors / Requests"
              value={`${formatNumber(stats.totalErrors)} / ${formatNumber(stats.totalRequests)}`}
              sub={`Current error rate ${stats.errorRate}%`}
              warn={stats.errorRate >= 5}
            />
          </CardContent>
          <CardFooter className="gap-2">
            <Button size="sm" className="text-xs" render={<Link href="/workers" />}>
              Open Workers
              <ArrowRight className="size-3" />
            </Button>
            <Button variant="outline" size="sm" className="text-xs" render={<Link href="/repositories" />}>
              Open Repositories
              <ArrowRight className="size-3" />
            </Button>
          </CardFooter>
        </Card>

        <div className="xl:col-span-2">
          <RequestsChartCard
            label="Requests"
            value={formatNumber(stats.totalRequests)}
            sub={
              requestTrend?.direction === "up"
                ? "Rising load"
                : requestTrend?.direction === "down"
                  ? "Cooling down"
                  : "Stable"
            }
            icon={<Activity className="size-3.5" />}
            requestData={requestHistory}
            errorData={errorHistory}
            trend={requestTrend}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Workers"
          value={workers.length}
          sub={
            stats.onlineWorkers.length > 0 ? `${stats.onlineWorkers.length} online` : "None online"
          }
          icon={<Server className="size-3.5" />}
          accent={stats.onlineWorkers.length > 0}
        />
        <KpiCard
          label="Repositories"
          value={repositories.length}
          sub={stats.linkedRepos.length > 0 ? `${stats.linkedRepos.length} linked` : "None linked"}
          icon={<Database className="size-3.5" />}
          accent={stats.linkedRepos.length > 0}
        />
        <KpiCard
          label="Unlinked Repositories"
          value={stats.unlinkedRepos.length}
          sub={stats.unlinkedRepos.length > 0 ? "Needs assignment" : "All repositories linked"}
          icon={<AlertTriangle className="size-3.5" />}
          warn={stats.unlinkedRepos.length > 0}
        />
        <KpiCard
          label="Error Rate"
          value={`${stats.errorRate}%`}
          sub={`${stats.errorRate === 0 ? "Healthy" : stats.errorRate < 5 ? "Acceptable" : "High"} ${formatTrendLabel(errorRateTrend, "pp")}`}
          icon={<Shield className="size-3.5" />}
          accent={stats.errorRate < 5}
          warn={stats.errorRate >= 5}
        />
      </div>

      {/* Multi Line Chart */}
      <DottedMultiLineChart buckets={trafficBuckets} />

      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Server className="size-3.5 text-muted-foreground" />
              Workers
            </CardTitle>
            <CardDescription>Live status of registered workers</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {workers.length === 0 ? (
              <div className="text-muted-foreground px-4 py-8 text-center text-xs">
                No workers registered yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {workers.map((w) => (
                  <WorkerRow key={w.id} worker={w} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3 lg:col-span-2">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-3.5 text-muted-foreground" />
                Worker Traffic
              </CardTitle>
              <CardDescription>Top workers by request and error totals</CardDescription>
            </CardHeader>
            <CardContent>
              <WorkerTrafficChart workers={workers} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Database className="size-3.5 text-muted-foreground" />
                Backends
              </CardTitle>
              <CardDescription>Repository distribution by storage backend</CardDescription>
            </CardHeader>
            <CardContent>
              {repositories.length === 0 ? (
                <div className="text-muted-foreground py-4 text-center text-xs">
                  No repositories yet.
                </div>
              ) : (
                <BackendChart counts={stats.backendCounts} total={repositories.length} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Shield className="size-3.5 text-muted-foreground" />
                Worker Health
              </CardTitle>
              <CardDescription>Online, degraded, and offline distribution</CardDescription>
            </CardHeader>
            <CardContent>
              <WorkerHealthChart workers={workers} />
            </CardContent>
          </Card>
        </div>
      </div>

      {stats.unlinkedRepos.length > 0 && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-3.5 text-muted-foreground" />
              Unlinked Repositories
            </CardTitle>
            <CardDescription>
              {stats.unlinkedRepos.length}{" "}
              {stats.unlinkedRepos.length === 1 ? "repository" : "repositories"} not attached to a worker
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {stats.unlinkedRepos.slice(0, 8).map((repo) => {
                const meta = BACKEND_META[repo.backend] ?? BACKEND_META.other;
                const Icon = meta.icon;
                return (
                  <div key={repo.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Icon className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="flex-1 truncate text-xs">{repo.name}</span>
                    <Badge variant="outline">{meta.label}</Badge>
                  </div>
                );
              })}
              {stats.unlinkedRepos.length > 8 && (
                <div className="text-muted-foreground px-4 py-2 text-center text-xs">
                  +{stats.unlinkedRepos.length - 8} more
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type Trend = { direction: "up" | "down" | "flat"; delta: number } | null;

function formatTrendLabel(trend: Trend, unit: string) {
  if (!trend) return unit ? `→ 0.00${unit}` : "→ 0";
  const absDelta = Math.abs(trend.delta);
  if (unit) {
    if (trend.direction === "up") return `↗ +${absDelta.toFixed(2)}${unit}`;
    if (trend.direction === "down") return `↘ -${absDelta.toFixed(2)}${unit}`;
    return `→ 0.00${unit}`;
  }
  if (trend.direction === "up") return `↗ +${Math.round(absDelta)}`;
  if (trend.direction === "down") return `↘ -${Math.round(absDelta)}`;
  return "→ 0";
}

function KpiCard({
  label,
  value,
  sub,
  icon,
  accent,
  warn,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ReactNode;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</div>
        <div
          className={`mt-0.5 text-xs ${warn ? "text-destructive" : accent ? "text-primary" : "text-muted-foreground"}`}
        >
          {sub}
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewStat({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-[11px] uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-semibold tracking-tight ${warn ? "text-destructive" : ""}`}>{value}</div>
      <div className="text-muted-foreground text-xs">{sub}</div>
    </div>
  );
}

function RequestsChartCard({
  label,
  value,
  sub,
  icon,
  requestData,
  errorData,
  trend,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ReactNode;
  requestData: number[];
  errorData: number[];
  trend: Trend;
}) {
  const chartData = useMemo(() => {
    const length = Math.max(requestData.length, errorData.length);
    if (length === 0) {
      return [
        { slot: "1", requests: 0, errors: 0 },
        { slot: "2", requests: 0, errors: 0 },
      ];
    }
    return Array.from({ length }).map((_, index) => ({
      slot: String(index + 1),
      requests: requestData[index] ?? 0,
      errors: errorData[index] ?? 0,
    }));
  }, [requestData, errorData]);

  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{label}</span>
          {trend?.direction === "up" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-red-500">
              <TrendingUp className="size-3" />
              +{Math.round(Math.abs(trend.delta))}
            </span>
          ) : trend?.direction === "down" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-500">
              <TrendingDown className="size-3" />
              -{Math.round(Math.abs(trend.delta))}
            </span>
          ) : (
            <span className="text-muted-foreground">{icon}</span>
          )}
        </div>
        <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</div>
        <div className="mt-2 h-14 rounded-md border bg-muted/20 px-1 py-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              accessibilityLayer
              data={chartData}
              margin={{ left: 4, right: 4, top: 2, bottom: 2 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="slot"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                interval="preserveStartEnd"
                tick={{ fontSize: 10 }}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              />
              <Line
                type="linear"
                dataKey="requests"
                stroke="var(--color-chart-2)"
                strokeWidth={2}
                dot={false}
                strokeDasharray="4 4"
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="errors"
                stroke="var(--color-chart-5)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="text-muted-foreground mt-1 text-xs">
          {sub} <span>{formatTrendLabel(trend, "")}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkerRow({ worker }: { worker: WorkerRecord }) {
  const rate = errorRate(worker.requestsTotal, worker.errorTotal);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {/* Status dot */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger className="shrink-0">
            <span className={`relative flex size-2.5 ${worker.isOnline ? "" : ""}`}>
              {worker.isOnline && (
                <span className="bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-60" />
              )}
              <span
                className={`relative inline-flex size-2.5 rounded-full ${
                  worker.isOnline ? "bg-primary" : "bg-muted-foreground/40"
                }`}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {worker.isOnline ? "Online" : "Offline"} — Last seen {timeAgo(worker.lastSeenAt)}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Name */}
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{worker.name}</span>

      {/* Metrics */}
      <div className="hidden items-center gap-3 sm:flex">
        <Metric label="Uptime" value={formatUptime(worker.uptimeMs)} />
        <Separator orientation="vertical" className="h-3" />
        <Metric label="Reqs" value={formatNumber(worker.requestsTotal)} />
        <Separator orientation="vertical" className="h-3" />
        <Metric label="Err" value={`${rate}%`} warn={rate >= 5} />
      </div>

      {/* Online badge on mobile */}
      <Badge variant={worker.isOnline ? "default" : "outline"} className="sm:hidden">
        {worker.isOnline ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
      </Badge>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="text-right">
      <div className="text-muted-foreground text-[10px] leading-none">{label}</div>
      <div className={`text-xs font-medium tabular-nums ${warn ? "text-destructive" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function BackendChart({ counts, total }: { counts: Record<string, number>; total: number }) {
  const entries = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* Stacked bar */}
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {entries.map(([backend, count]) => {
          const meta = BACKEND_META[backend] ?? BACKEND_META.other;
          const pct = (count / total) * 100;
          return (
            <TooltipProvider key={backend}>
              <Tooltip>
                <TooltipTrigger
                  className={`${meta.color} first:rounded-l-full last:rounded-r-full transition-all`}
                  style={{ width: `${pct}%` }}
                />
                <TooltipContent>
                  {meta.label}: {count} ({pct.toFixed(0)}%)
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {entries.map(([backend, count]) => {
          const meta = BACKEND_META[backend] ?? BACKEND_META.other;
          return (
            <div key={backend} className="flex items-center gap-1.5">
              <span className={`${meta.color} size-2 rounded-full`} />
              <span className="text-muted-foreground text-xs">{meta.label}</span>
              <span className="text-xs font-medium tabular-nums">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkerTrafficChart({ workers }: { workers: WorkerRecord[] }) {
  const data = workers
    .slice()
    .sort((a, b) => b.requestsTotal - a.requestsTotal)
    .slice(0, 6)
    .map((worker) => ({
      name: worker.name.length > 12 ? `${worker.name.slice(0, 12)}...` : worker.name,
      requests: worker.requestsTotal,
      errors: worker.errorTotal,
    }));

  if (data.length === 0) {
    return <div className="text-muted-foreground py-4 text-center text-xs">No worker traffic yet.</div>;
  }

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          <RechartsTooltip
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
              color: "var(--color-card-foreground)",
            }}
            itemStyle={{ color: "var(--color-card-foreground)" }}
            labelStyle={{ color: "var(--color-card-foreground)", fontWeight: 600 }}
          />
          <Bar dataKey="requests" name="Requests" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="errors" name="Errors" fill="var(--color-destructive)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function WorkerHealthChart({ workers }: { workers: WorkerRecord[] }) {
  const online = workers.filter((worker) => worker.isOnline && worker.status !== "degraded").length;
  const degraded = workers.filter((worker) => worker.status === "degraded").length;
  const offline = workers.filter((worker) => !worker.isOnline).length;

  const data = [
    { name: "Online", value: online, color: "var(--color-chart-2)" },
    { name: "Degraded", value: degraded, color: "var(--color-chart-4)" },
    { name: "Offline", value: offline, color: "var(--color-muted-foreground)" },
  ].filter((entry) => entry.value > 0);

  if (data.length === 0) {
    return <div className="text-muted-foreground py-4 text-center text-xs">No workers registered yet.</div>;
  }

  return (
    <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto]">
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={44} outerRadius={64} paddingAngle={3}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <RechartsTooltip
              contentStyle={{
                borderRadius: 12,
                border: "1px solid var(--color-border)",
                background: "var(--color-card)",
                color: "var(--color-card-foreground)",
              }}
              itemStyle={{ color: "var(--color-card-foreground)" }}
              labelStyle={{ color: "var(--color-card-foreground)", fontWeight: 600 }}
              formatter={(value) => [value ?? 0, "Workers"]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-col gap-1.5">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-muted-foreground text-xs">{entry.name}</span>
            <span className="text-xs font-medium tabular-nums">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle>Welcome to Glare</CardTitle>
          <CardDescription>
            Get started by registering a worker and connecting a repository.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button size="sm" className="flex-1 text-xs" render={<Link href="/workers" />}>
            <Server className="size-3.5" />
            Add Worker
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            render={<a href="/repositories" />}
          >
            <Database className="size-3.5" />
            Add Repository
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
