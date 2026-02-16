"use client";

import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
import { RiArrowDownLine, RiArrowUpLine } from "@remixicon/react";
import { useMemo } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";

const chartConfig = {
  requests: {
    label: "Requests",
    color: "var(--chart-2)",
  },
  errorRate: {
    label: "Error Rate %",
    color: "var(--chart-5)",
  },
} satisfies ChartConfig;

type TrafficBucket = {
  bucket: string;
  requests: number;
  errors: number;
  errorRate: number;
};

interface DottedMultiLineChartProps {
  buckets: TrafficBucket[];
}

export function DottedMultiLineChart({ buckets }: DottedMultiLineChartProps) {
  const chartData = useMemo(() => {
    if (buckets.length === 0) {
      return [
        { label: "-", requests: 0, errorRate: 0 },
        { label: "-", requests: 0, errorRate: 0 },
      ];
    }
    return buckets.map((b) => ({
      label: new Date(b.bucket).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      requests: b.requests,
      errorRate: Number(b.errorRate),
    }));
  }, [buckets]);

  const trend = useMemo(() => {
    if (buckets.length < 2) return null;
    const latest = Number(buckets[buckets.length - 1]?.errorRate ?? 0);
    const prev = Number(buckets[buckets.length - 2]?.errorRate ?? 0);
    const delta = Number((latest - prev).toFixed(2));
    if (delta === 0) return null;
    return { up: delta > 0, delta };
  }, [buckets]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          Traffic & Error Rate
          {trend && (
            <Badge
              variant="outline"
              className={`border-none text-xs ${trend.up ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"}`}
            >
              {trend.up ? (
                <RiArrowUpLine className="size-3" />
              ) : (
                <RiArrowDownLine className="size-3" />
              )}
              <span>
                {trend.up ? "+" : ""}
                {trend.delta.toFixed(2)}%
              </span>
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Last 24h — requests per interval (dashed) vs error rate % (solid)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-40 w-full">
          <LineChart
            accessibilityLayer
            data={chartData}
            margin={{ left: 12, right: 12 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent />}
            />
            <Line
              dataKey="requests"
              type="linear"
              stroke="var(--color-requests)"
              strokeWidth={2}
              dot={false}
              strokeDasharray="4 4"
              isAnimationActive={false}
            />
            <Line
              dataKey="errorRate"
              type="linear"
              stroke="var(--color-errorRate)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
