import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/control-plane/status-badge";
import type { HealthStatus } from "@/lib/control-plane/health";

export type TimelineEvent = {
  id: string;
  title: string;
  detail: string;
  status: HealthStatus;
  at: string;
};

export function TimelineEventRow({ event }: { event: TimelineEvent }) {
  const diffSec = Math.max(1, Math.floor((Date.now() - new Date(event.at).getTime()) / 1000));
  const relative =
    diffSec < 60
      ? `${diffSec}s ago`
      : diffSec < 3600
        ? `${Math.floor(diffSec / 60)}m ago`
        : diffSec < 86400
          ? `${Math.floor(diffSec / 3600)}h ago`
          : `${Math.floor(diffSec / 86400)}d ago`;

  return (
    <div className="flex items-start gap-3 border-b border-border/60 py-3 last:border-b-0">
      <div className="mt-0.5">
        <StatusBadge status={event.status} />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium">{event.title}</p>
        <p className="truncate text-xs text-muted-foreground">{event.detail}</p>
      </div>
      <p className="shrink-0 text-xs text-muted-foreground">{relative}</p>
    </div>
  );
}

export function ActivityFeed({ title = "Recent Activity", events }: { title?: string; events: TimelineEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No incidents in last 7 days.</p>
        ) : (
          events.map((event) => <TimelineEventRow key={event.id} event={event} />)
        )}
      </CardContent>
    </Card>
  );
}
