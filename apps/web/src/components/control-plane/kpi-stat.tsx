import type { ComponentType } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type KpiColor = "default" | "blue" | "green" | "red" | "amber" | "violet";

const colorMap: Record<KpiColor, { iconClass: string; glowColor: string }> = {
  default: { iconClass: "text-muted-foreground/40", glowColor: "" },
  blue: { iconClass: "text-blue-500", glowColor: "oklch(0.6 0.2 250 / 0.06)" },
  green: { iconClass: "text-emerald-500", glowColor: "oklch(0.65 0.18 145 / 0.06)" },
  red: { iconClass: "text-red-500", glowColor: "oklch(0.6 0.2 25 / 0.06)" },
  amber: { iconClass: "text-amber-500", glowColor: "oklch(0.75 0.18 80 / 0.06)" },
  violet: { iconClass: "text-violet-500", glowColor: "oklch(0.6 0.2 290 / 0.06)" },
};

export function KpiStat({
  label,
  value,
  helper,
  icon: Icon,
  color = "default",
}: {
  label: string;
  value: string | number;
  helper?: string;
  icon?: ComponentType<{ className?: string }>;
  color?: KpiColor;
}) {
  const { iconClass, glowColor } = colorMap[color];

  return (
    <Card className="relative overflow-hidden">
      {Icon && glowColor && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at top right, ${glowColor}, transparent 65%)`,
          }}
        />
      )}
      <CardContent className="relative p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            {helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
          </div>
          {Icon ? <Icon className={cn("size-12 shrink-0", iconClass)} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}
