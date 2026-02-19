"use client";

import { useCallback, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type SyncEventRecord = {
  id: string;
  status: string;
  uptimeMs: number;
  requestsTotal: number;
  errorTotal: number;
  createdAt: string;
};

function formatDateTime(dateString: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(dateString));
}

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

interface UptimeHeatmapProps {
  events: SyncEventRecord[];
}

export function UptimeHeatmap({ events }: UptimeHeatmapProps) {
  const [hoveredEvent, setHoveredEvent] = useState<SyncEventRecord | null>(null);
  const [heatmapPointer, setHeatmapPointer] = useState<{
    clientX: number;
    clientY: number;
  } | null>(null);

  const heatmapEvents = events.slice(-72);
  const activeEvent = hoveredEvent ?? heatmapEvents[heatmapEvents.length - 1] ?? null;

  const setHoveredIfChanged = useCallback((event: SyncEventRecord | null) => {
    setHoveredEvent((prev) => {
      if (!event) return null;
      return prev?.id === event.id ? prev : event;
    });
  }, []);

  const setPointerFromElement = useCallback((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setHeatmapPointer({ clientX: rect.left + rect.width / 2, clientY: rect.top });
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Uptime Heatmap</CardTitle>
        <CardDescription>Recent heartbeat status across last 72 sync events.</CardDescription>
      </CardHeader>
      <CardContent>
        {heatmapEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sync events recorded in the last 24 hours.
          </p>
        ) : (
          <div>
            <div className="relative">
              <div className="pointer-events-none grid grid-cols-12 gap-1">
                {heatmapEvents.map((event) => {
                  const tone =
                    event.status === "online"
                      ? "bg-emerald-500/80"
                      : event.status === "degraded"
                        ? "bg-amber-500/80"
                        : "bg-rose-500/70";
                  return (
                    <span
                      key={event.id}
                      className={`inline-block h-6 w-full rounded-sm ${tone}`}
                      aria-hidden
                    />
                  );
                })}
              </div>
              <div
                className="absolute inset-0 grid grid-cols-12"
                onMouseLeave={() => {
                  setHoveredEvent(null);
                  setHeatmapPointer(null);
                }}
              >
                {heatmapEvents.map((event) => (
                  <span
                    key={event.id}
                    className="inline-block h-full w-full cursor-pointer"
                    aria-label={`${event.status} at ${formatDateTime(event.createdAt)}`}
                    onMouseEnter={(e) => {
                      setHoveredIfChanged(event);
                      setPointerFromElement(e.currentTarget);
                    }}
                    onFocus={(e) => {
                      setHoveredIfChanged(event);
                      setPointerFromElement(e.currentTarget);
                    }}
                    tabIndex={0}
                  />
                ))}
              </div>
              {activeEvent && heatmapPointer ? (
                <div
                  className="pointer-events-none fixed z-[100] max-w-[280px] rounded-md border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-md"
                  style={{
                    left: `${heatmapPointer.clientX}px`,
                    top: `${heatmapPointer.clientY - 10}px`,
                    transform: "translate(-50%, -100%)",
                  }}
                >
                  <span className="font-medium">{formatDateTime(activeEvent.createdAt)}</span>
                  {" • "}
                  {activeEvent.status}
                  {" • "}
                  req: {formatNumber(activeEvent.requestsTotal)}
                  {" • "}
                  err: {formatNumber(activeEvent.errorTotal)}
                  {" • "}
                  up: {formatUptime(activeEvent.uptimeMs)}
                </div>
              ) : null}
            </div>
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
                <span className="size-2 rounded-full bg-rose-500/70" />
                Offline
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
