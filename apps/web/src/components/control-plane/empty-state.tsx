import type { ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

type RemixIcon = ComponentType<{ className?: string }>;

export function ControlPlaneEmptyState({
  icon: Icon,
  title,
  description,
  cta,
}: {
  icon: RemixIcon;
  title: string;
  description: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <Empty className="rounded-lg border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon className="size-4" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {cta ? (
        <Button size="sm" onClick={cta.onClick}>
          {cta.label}
        </Button>
      ) : null}
    </Empty>
  );
}
