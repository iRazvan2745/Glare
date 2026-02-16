"use client";

import { RiArrowLeftLine, RiEyeLine, RiEyeOffLine, RiHistoryLine, RiPlayCircleLine } from "@remixicon/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";

import { ActivityFeed, KpiStat, ResourceHeader, StatusBadge } from "@/components/control-plane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetchJson } from "@/lib/api-fetch";
import { deriveHealthStatus } from "@/lib/control-plane/health";
import { authClient } from "@/lib/auth-client";
import { env } from "@glare/env/web";

type WorkerRecord = {
  id: string;
  name: string;
  status: string;
  isOnline: boolean;
  lastSeenAt: string | null;
};

type RepositoryRecord = {
  id: string;
  name: string;
  backend: string;
  repository: string;
  isInitialized: boolean;
  initializedAt: string | null;
  hasPassword: boolean;
  options: Record<string, string>;
  worker: WorkerRecord | null;
  createdAt: string;
  updatedAt: string;
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function maskValue(value: string) {
  if (!value) return "—";
  if (value.length <= 6) return "••••••";
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase();
  return normalized.includes("secret") || normalized.includes("password") || normalized.includes("token") || normalized.includes("key");
}

export default function RepositoryInfoPage() {
  const params = useParams<{ id: string }>();
  const repositoryId = params?.id ?? "";
  const { data: session } = authClient.useSession();

  const [repository, setRepository] = useState<RepositoryRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitLoading, setIsInitLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);

  const loadRepository = useCallback(async () => {
    if (!repositoryId) return;

    setIsLoading(true);
    setError("");

    try {
      const data = await apiFetchJson<{ repository?: RepositoryRecord }>(
        `${env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories/${repositoryId}`,
        {
          method: "GET",
          retries: 1,
        },
      );
      if (!data.repository) throw new Error("Repository not found");
      setRepository(data.repository);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load repository");
    } finally {
      setIsLoading(false);
    }
  }, [repositoryId]);

  useEffect(() => {
    if (!session?.user) {
      setIsLoading(false);
      return;
    }
    void loadRepository();
  }, [loadRepository, session?.user]);

  const optionEntries = useMemo(
    () => Object.entries(repository?.options ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [repository?.options],
  );

  const activity = useMemo(
    () =>
      repository
        ? [
            {
              id: "updated",
              title: "Configuration updated",
              detail: `Last modified ${formatDateTime(repository.updatedAt)}`,
              status: "healthy" as const,
              at: repository.updatedAt,
            },
            {
              id: "created",
              title: "Repository registered",
              detail: `Created ${formatDateTime(repository.createdAt)}`,
              status: "healthy" as const,
              at: repository.createdAt,
            },
            {
              id: "init",
              title: repository.isInitialized ? "Initialized" : "Initialization pending",
              detail: repository.isInitialized ? `Initialized ${formatDateTime(repository.initializedAt)}` : "Run initialization on assigned worker",
              status: repository.isInitialized ? ("healthy" as const) : ("degraded" as const),
              at: repository.initializedAt ?? repository.updatedAt,
            },
          ]
        : [],
    [repository],
  );

  async function handleInit() {
    if (!repository?.worker) {
      toast.error("Attach a worker before initializing.");
      return;
    }
    if (repository.isInitialized) {
      toast.info("Repository is already initialized.");
      return;
    }

    setIsInitLoading(true);
    try {
      await apiFetchJson(`${env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories/${repository.id}/init`, {
        method: "POST",
        retries: 1,
      });

      setRepository((current) =>
        current
          ? {
              ...current,
              isInitialized: true,
              initializedAt: new Date().toISOString(),
            }
          : current,
      );
      toast.success("Repository initialized.");
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : "Could not initialize repository.");
    } finally {
      setIsInitLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading repository details...</div>
      </div>
    );
  }

  if (error || !repository) {
    return (
      <div className="space-y-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Repository not available</CardTitle>
            <CardDescription>{error || "Unable to find this repository."}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<Link href="/repositories" />}>
              <RiArrowLeftLine className="size-4" />
              Back to repositories
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const health = deriveHealthStatus({
    totalWorkers: repository.worker ? 1 : 0,
    offlineWorkers: repository.worker && !repository.worker.isOnline ? 1 : 0,
    unlinkedRepositories: repository.worker ? 0 : 1,
    errorRate24h: repository.isInitialized ? 0 : 1,
  });

  return (
    <div className="space-y-4 p-4">
      <ResourceHeader
        name={repository.name}
        status={health}
        metadata={[
          `Backend ${repository.backend.toUpperCase()}`,
          repository.worker ? `Primary worker ${repository.worker.name}` : "No primary worker",
          repository.hasPassword ? "Encryption configured" : "No repository password",
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" render={<Link href="/repositories" />}>
              <RiArrowLeftLine className="size-4" />
              Repositories
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleInit()} disabled={repository.isInitialized || isInitLoading}>
              <RiPlayCircleLine className="size-4" />
              {repository.isInitialized ? "Initialized" : "Initialize"}
            </Button>
            <Button variant="outline" size="sm" render={<Link href="/snapshots" />}>
              <RiHistoryLine className="size-4" />
              View Recovery Points
            </Button>
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        <KpiStat label="Last snapshot" value="—" helper="Recovery point telemetry pending" />
        <KpiStat label="Last failure" value="—" helper="No failures recorded" />
        <KpiStat label="Storage health" value={repository.isInitialized ? "Reachable" : "Pending init"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Backend</CardTitle>
              <CardDescription>Repository backend and path details.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between rounded border p-2">
                <span className="text-muted-foreground">Backend</span>
                <Badge variant="outline">{repository.backend}</Badge>
              </div>
              <div className="rounded border p-2 font-mono text-xs">{repository.repository}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Credentials</CardTitle>
              <CardDescription>Sensitive values are masked by default.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <Button variant="outline" size="sm" className="h-7" onClick={() => setShowSecrets((value) => !value)}>
                {showSecrets ? <RiEyeOffLine className="size-4" /> : <RiEyeLine className="size-4" />}
                {showSecrets ? "Hide" : "Reveal"}
              </Button>
              {optionEntries.length === 0 ? (
                <p className="text-muted-foreground">No credentials/options configured.</p>
              ) : (
                optionEntries.map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[minmax(0,180px)_1fr] gap-2 rounded border p-2">
                    <span className="truncate font-mono text-muted-foreground">{key}</span>
                    <span className="truncate font-mono">{isSensitiveKey(key) && !showSecrets ? maskValue(value) : value}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Worker Assignment</CardTitle>
              <CardDescription>Execution context for init and snapshot operations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {repository.worker ? (
                <>
                  <p className="font-medium">{repository.worker.name}</p>
                  <StatusBadge status={repository.worker.isOnline ? "healthy" : "outage"} label={repository.worker.isOnline ? "Online" : "Offline"} />
                </>
              ) : (
                <p className="text-muted-foreground">No worker assigned.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Retention / Schedule Summary</CardTitle>
              <CardDescription>Policy overview for this repository.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">No schedule attached.</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Lifecycle</CardTitle>
              <CardDescription>Repository lifecycle timestamps.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded border p-2">Created: {formatDateTime(repository.createdAt)}</div>
              <div className="rounded border p-2">Updated: {formatDateTime(repository.updatedAt)}</div>
              <div className="rounded border p-2">Initialized: {formatDateTime(repository.initializedAt)}</div>
            </CardContent>
          </Card>

          <ActivityFeed title="Recent Activity" events={activity} />
        </div>
      </div>
    </div>
  );
}
