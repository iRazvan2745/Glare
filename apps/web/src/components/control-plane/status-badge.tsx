import { RiAlarmWarningLine, RiCheckboxCircleLine, RiErrorWarningLine } from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import type { HealthStatus } from "@/lib/control-plane/health";
import { statusToLabel } from "@/lib/control-plane/health";

const toneByStatus: Record<HealthStatus, string> = {
  healthy: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  degraded: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  outage: "border-red-500/30 bg-red-500/10 text-red-300",
};

export function StatusBadge({ status, label }: { status: HealthStatus; label?: string }) {
  const Icon =
    status === "healthy"
      ? RiCheckboxCircleLine
      : status === "degraded"
        ? RiErrorWarningLine
        : RiAlarmWarningLine;

  return (
    <Badge variant="outline" className={`gap-1.5 ${toneByStatus[status]}`}>
      <Icon className="size-3.5" />
      {label ?? statusToLabel(status)}
    </Badge>
  );
}
