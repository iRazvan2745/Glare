"use client";

import { RiBarChartGroupedLine } from "@remixicon/react";
import { useCallback, useState } from "react";
import { Area, AreaChart, CartesianGrid, Customized, XAxis, YAxis } from "recharts";

import { ControlPlaneEmptyState } from "@/components/control-plane";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type TimeRange = "1h" | "6h" | "24h" | "7d";

type ChartDataPoint = { x?: number; y?: number };

type ChartLineData = {
  item: { props: { dataKey: string } };
  props: { points: ChartDataPoint[] };
};

type CustomizedChartProps = { formattedGraphicalItems?: ChartLineData[] };

type LineConfig = {
  name: string;
  splitIndex?: number;
  dashPattern?: number[];
  curveAdjustment?: number;
};

type LineDasharray = { name: string; strokeDasharray: string }[];

// ─── Hook ────────────────────────────────────────────────────────────────────

function useDynamicDasharray({
  lineConfigs = [],
  splitIndex = -2,
  defaultDashPattern: dashPattern = [4, 3],
  curveAdjustment = 1,
}: {
  lineConfigs?: LineConfig[];
  splitIndex?: number;
  defaultDashPattern?: number[];
  curveAdjustment?: number;
}): [(props: CustomizedChartProps) => null, LineDasharray] {
  const [lineDasharrays, setLineDasharrays] = useState<LineDasharray>([]);

  const DasharrayCalculator = useCallback(
    (props: CustomizedChartProps): null => {
      const chartLines = props?.formattedGraphicalItems;
      const newLineDasharrays: LineDasharray = [];

      const calculatePathLength = (points: ChartDataPoint[]) =>
        points?.reduce((acc, point, index) => {
          if (index === 0) return acc;
          const prevPoint = points[index - 1];
          const dx = (point.x ?? 0) - (prevPoint.x ?? 0);
          const dy = (point.y ?? 0) - (prevPoint.y ?? 0);
          return acc + Math.sqrt(dx * dx + dy * dy);
        }, 0) ?? 0;

      chartLines?.forEach((line) => {
        const points = line?.props?.points;
        const totalLength = calculatePathLength(points ?? []);
        const lineName = line?.item?.props?.dataKey;
        const lineConfig = lineConfigs.find((config) => config.name === lineName);
        const lineSplitIndex = lineConfig?.splitIndex ?? splitIndex;
        const dashedSegment = points?.slice(lineSplitIndex);
        const dashedLength = calculatePathLength(dashedSegment ?? []);

        if (!lineName || !totalLength || !dashedLength) return;

        const solidLength = totalLength - dashedLength;
        const curveCorrectionFactor = lineConfig?.curveAdjustment ?? curveAdjustment;
        const adjustment = (solidLength * curveCorrectionFactor) / 100;
        const solidDasharrayPart = solidLength + adjustment;

        const targetDashPattern = lineConfig?.dashPattern ?? dashPattern;
        const patternSegmentLength =
          (targetDashPattern?.[0] ?? 0) + (targetDashPattern?.[1] ?? 0) || 1;
        const repetitions = Math.ceil(dashedLength / patternSegmentLength);
        const dashedPatternSegments = Array.from({ length: repetitions }, () =>
          targetDashPattern.join(" "),
        );

        newLineDasharrays.push({
          name: lineName,
          strokeDasharray: `${solidDasharrayPart} ${dashedPatternSegments.join(" ")}`,
        });
      });

      if (JSON.stringify(newLineDasharrays) !== JSON.stringify(lineDasharrays)) {
        setTimeout(() => setLineDasharrays(newLineDasharrays), 0);
      }

      return null;
    },
    [curveAdjustment, dashPattern, lineConfigs, lineDasharrays, splitIndex],
  );

  return [DasharrayCalculator, lineDasharrays];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0 B";
  const sign = value < 0 ? "-" : "";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let current = Math.abs(value);
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${sign}${current.toFixed(current >= 10 ? 1 : 2)} ${units[index]}`;
}

const snapshotActivityChartConfig = {
  success: { label: "Success", color: "var(--chart-1)" },
  failed: { label: "Failed", color: "var(--chart-5)" },
} satisfies ChartConfig;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatBadge({
  value,
  positive,
  neutral = false,
}: {
  value: string;
  positive: boolean;
  neutral?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-medium tabular-nums",
        neutral
          ? "bg-muted text-muted-foreground"
          : positive
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-destructive/15 text-destructive",
      )}
    >
      {value}
    </span>
  );
}

function StatRow({ items }: { items: { label: string; value: string; danger?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(({ label, value, danger }) => (
        <span key={label}>
          {label}{" "}
          <span className={cn("font-medium", danger ? "text-destructive" : "text-foreground")}>
            {value}
          </span>
        </span>
      ))}
    </div>
  );
}

// ─── Exported types ───────────────────────────────────────────────────────────

export interface StorageInsights {
  netGrowth: number;
  growthDeltaPct: number | null;
  peakAdded: number;
  latestCumulative: number;
  dailyGrowth: number;
}

export interface SnapshotInsights {
  current: { successRate: number; failed: number };
  failedDelta: number;
  failureRateDelta: number;
}

interface ChartsSectionProps {
  timeRange: TimeRange;
  storageLine: { data: Array<{ date: string; cumulativeDisplay: number }>; splitIndex: number };
  snapshotLineData: {
    data: Array<{ date: string; success: number; failed: number }>;
    splitIndex: number;
  };
  storageInsights: StorageInsights;
  snapshotInsights: SnapshotInsights;
  hasStorageActivity: boolean;
  hasActivity: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ChartsSection({
  timeRange,
  storageLine,
  snapshotLineData,
  storageInsights,
  snapshotInsights,
  hasStorageActivity,
  hasActivity,
}: ChartsSectionProps) {
  const [StorageDasharrayCalculator, storageLineDasharrays] = useDynamicDasharray({
    lineConfigs: [{ name: "cumulativeDisplay", splitIndex: storageLine.splitIndex }],
  });

  const [SnapshotDasharrayCalculator, snapshotLineDasharrays] = useDynamicDasharray({
    lineConfigs: [
      { name: "success", splitIndex: snapshotLineData.splitIndex },
      { name: "failed", splitIndex: snapshotLineData.splitIndex },
    ],
  });

  const tickFormatter = (value: unknown) => {
    const date = new Date(String(value));
    return ["1h", "6h"].includes(timeRange)
      ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {/* ─── Storage Usage ─── */}
      <Card>
        <CardHeader className="gap-1 pb-3">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Storage Usage
          </p>
          <div className="flex items-end justify-between gap-2">
            <span className="text-2xl font-bold tabular-nums leading-none">
              {hasStorageActivity ? formatBytes(storageInsights.latestCumulative) : "—"}
            </span>
            {hasStorageActivity && storageInsights.growthDeltaPct !== null && (
              <StatBadge
                value={`${storageInsights.growthDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(storageInsights.growthDeltaPct).toFixed(1)}%`}
                positive={storageInsights.growthDeltaPct >= 0}
              />
            )}
          </div>
          {hasStorageActivity && (
            <div className="flex justify-end">
              <StatRow
                items={[
                  {
                    label: "Net",
                    value: `${storageInsights.netGrowth >= 0 ? "+" : ""}${formatBytes(storageInsights.netGrowth)}`,
                  },
                  { label: "Peak", value: formatBytes(storageInsights.peakAdded) },
                  { label: "Daily avg", value: formatBytes(storageInsights.dailyGrowth) },
                ]}
              />
            </div>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {!hasStorageActivity ? (
            <ControlPlaneEmptyState
              icon={RiBarChartGroupedLine}
              title="No storage samples"
              description="No successful backups were recorded in the selected range."
            />
          ) : (
            <div className="h-40">
              <ChartContainer
                config={{ cumulativeDisplay: { label: "Total Bytes", color: "var(--chart-1)" } }}
                className="h-full w-full"
              >
                <AreaChart
                  accessibilityLayer
                  data={storageLine.data}
                  margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient id="storageGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={24}
                    tickFormatter={tickFormatter}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => formatBytes(Number(value))}
                    width={72}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickCount={3}
                  />
                  <Area
                    dataKey="cumulativeDisplay"
                    type="monotone"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="url(#storageGradient)"
                    dot={false}
                    activeDot={{ r: 3, fill: "var(--chart-1)", strokeWidth: 0 }}
                    strokeDasharray={
                      storageLineDasharrays.find((l) => l.name === "cumulativeDisplay")
                        ?.strokeDasharray ?? "0 0"
                    }
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) => new Date(String(value)).toLocaleString()}
                        indicator="line"
                        valueFormatter={(value) => formatBytes(Number(value))}
                      />
                    }
                    cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
                  />
                  <Customized component={StorageDasharrayCalculator} />
                </AreaChart>
              </ChartContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Snapshot Activity ─── */}
      <Card>
        <CardHeader className="gap-1 pb-3">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Snapshot Activity
          </p>
          <div className="flex items-end justify-between gap-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold tabular-nums leading-none">
                {snapshotInsights.current.successRate}%
              </span>
              <span className="text-sm text-muted-foreground">success rate</span>
            </div>
            <StatBadge
              value={`${snapshotInsights.current.failed} failures (${snapshotInsights.failedDelta >= 0 ? "+" : ""}${snapshotInsights.failedDelta})`}
              positive={snapshotInsights.failedDelta <= 0}
              neutral={snapshotInsights.current.failed === 0}
            />
          </div>
          <StatRow
            items={[
              {
                label: "Failure rate",
                value: `${snapshotInsights.failureRateDelta >= 0 ? "+" : ""}${snapshotInsights.failureRateDelta}pp vs prior`,
                danger: snapshotInsights.failureRateDelta > 0,
              },
            ]}
          />
        </CardHeader>
        <CardContent className="pt-0">
          {!hasActivity ? (
            <ControlPlaneEmptyState
              icon={RiBarChartGroupedLine}
              title="No snapshot activity"
              description="No backup plan runs were recorded in the selected range."
            />
          ) : (
            <div className="h-44">
              <ChartContainer config={snapshotActivityChartConfig} className="h-full w-full">
                <AreaChart
                  accessibilityLayer
                  data={snapshotLineData.data}
                  margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={24}
                    tickFormatter={tickFormatter}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickCount={3}
                    allowDecimals={false}
                  />
                  <Area
                    dataKey="success"
                    type="monotone"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="url(#successGradient)"
                    dot={false}
                    activeDot={{ r: 3, fill: "var(--chart-1)", strokeWidth: 0 }}
                    strokeDasharray={
                      snapshotLineDasharrays.find((l) => l.name === "success")?.strokeDasharray ??
                      "0 0"
                    }
                  />
                  <Area
                    dataKey="failed"
                    type="monotone"
                    stroke="var(--chart-5)"
                    strokeWidth={2}
                    fill="url(#failedGradient)"
                    dot={false}
                    activeDot={{ r: 3, fill: "var(--chart-5)", strokeWidth: 0 }}
                    strokeDasharray={
                      snapshotLineDasharrays.find((l) => l.name === "failed")?.strokeDasharray ??
                      "0 0"
                    }
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) => new Date(String(value)).toLocaleString()}
                        indicator="line"
                      />
                    }
                    cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
                  />
                  <Customized component={SnapshotDasharrayCalculator} />
                </AreaChart>
              </ChartContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
