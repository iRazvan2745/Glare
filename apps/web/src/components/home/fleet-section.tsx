"use client";

import { RiServerLine } from "@remixicon/react";

import {
  ActionMenu,
  ActivityFeed,
  ControlPlaneEmptyState,
  StatusBadge,
} from "@/components/control-plane";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type WorkerRecord = {
  id: string;
  name: string;
  isOnline: boolean;
  lastSeenAt: string | null;
};

type ActivityEvent = {
  id: string;
  title: string;
  detail: string;
  status: "healthy" | "degraded" | "outage";
  at: string;
};

function timeAgo(value: string | null) {
  if (!value) return "never";
  const diffSec = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

interface FleetSectionProps {
  workers: WorkerRecord[];
  activityEvents: ActivityEvent[];
}

export function FleetSection({ workers, activityEvents }: FleetSectionProps) {
  return (
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
              <div
                key={worker.id}
                className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2"
              >
                <RiServerLine className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{worker.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Last seen {timeAgo(worker.lastSeenAt)}
                  </p>
                </div>
                <StatusBadge
                  status={worker.isOnline ? "healthy" : "outage"}
                  label={worker.isOnline ? "Online" : "Offline"}
                />
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
  );
}
