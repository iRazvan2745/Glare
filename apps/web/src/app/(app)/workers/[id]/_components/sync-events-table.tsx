"use client";

import {
  DataTableFilter,
  type ColumnConfig,
  type DataTableFilterActions,
  type FilterStrategy,
  type FiltersState,
} from "@/components/data-table-filter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/control-plane";

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

interface SyncEventsTableProps {
  events: SyncEventRecord[];
  page: number;
  pageCount: number;
  tableTotal: number;
  onPageChange: (page: number) => void;
  filterColumns: readonly ColumnConfig[];
  filterFilters: FiltersState;
  filterActions: DataTableFilterActions;
  filterStrategy: FilterStrategy;
}

export function SyncEventsTable({
  events,
  page,
  pageCount,
  onPageChange,
  filterColumns,
  filterFilters,
  filterActions,
  filterStrategy,
}: SyncEventsTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Events</CardTitle>
        <CardDescription>Status-filtered worker events with anomaly emphasis.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <DataTableFilter
          columns={filterColumns}
          filters={filterFilters}
          actions={filterActions}
          strategy={filterStrategy}
        />

        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events for the selected filter.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Timestamp</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Uptime</th>
                  <th className="px-3 py-2 font-medium text-right">Requests</th>
                  <th className="px-3 py-2 font-medium text-right">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((event) => (
                  <tr
                    key={event.id}
                    className={event.status !== "online" ? "bg-amber-500/5" : undefined}
                  >
                    <td className="px-3 py-2 tabular-nums">{formatDateTime(event.createdAt)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        status={
                          event.status === "offline"
                            ? "outage"
                            : event.status === "degraded"
                              ? "degraded"
                              : "healthy"
                        }
                        label={event.status}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatUptime(event.uptimeMs)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(event.requestsTotal)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(event.errorTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between text-xs">
          <p className="text-muted-foreground">
            Page {page} of {pageCount}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
