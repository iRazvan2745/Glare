import type { ReactNode } from "react";

import { StatusBadge } from "@/components/control-plane/status-badge";
import type { HealthStatus } from "@/lib/control-plane/health";

export function ResourceHeader({
  name,
  status,
  metadata,
  actions,
}: {
  name: string;
  status: HealthStatus;
  metadata: string[];
  actions?: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
          <StatusBadge status={status} />
          <p className="text-xs text-muted-foreground">{metadata.join(" • ")}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
