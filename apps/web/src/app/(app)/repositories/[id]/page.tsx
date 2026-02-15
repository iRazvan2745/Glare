"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  Database,
  HardDrive,
  KeyRound,
  Loader2,
  Server,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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

const BACKEND_META: Record<string, { label: string; icon: typeof Cloud; tone: string }> = {
  s3: { label: "S3", icon: Cloud, tone: "text-sky-500" },
  local: { label: "Local", icon: HardDrive, tone: "text-emerald-500" },
  b2: { label: "B2", icon: Cloud, tone: "text-indigo-500" },
  rest: { label: "REST", icon: Server, tone: "text-amber-500" },
  webdav: { label: "WebDAV", icon: Server, tone: "text-orange-500" },
  sftp: { label: "SFTP", icon: Server, tone: "text-teal-500" },
  rclone: { label: "rclone", icon: Database, tone: "text-violet-500" },
  other: { label: "Other", icon: Database, tone: "text-muted-foreground" },
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function timeAgo(value: string | null) {
  if (!value) return "never";
  const diffMs = Date.now() - new Date(value).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("token") ||
    normalized.includes("key")
  );
}

function maskValue(value: string) {
  if (value.length <= 6) return "••••••";
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

export default function RepositoryInfoPage() {
  const params = useParams<{ id: string }>();
  const repositoryId = params?.id ?? "";
  const { data: session } = authClient.useSession();

  const [repository, setRepository] = useState<RepositoryRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitLoading, setIsInitLoading] = useState(false);
  const [error, setError] = useState("");

  const loadRepository = useCallback(async () => {
    if (!repositoryId) return;

    setIsLoading(true);
    setError("");

    try {
      const res = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories/${repositoryId}`, {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to load repository");
      }

      const data = (await res.json()) as { repository?: RepositoryRecord };
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

  const sensitiveOptionCount = useMemo(
    () => optionEntries.filter(([key]) => isSensitiveKey(key)).length,
    [optionEntries],
  );

  const backend = repository ? BACKEND_META[repository.backend] ?? BACKEND_META.other : BACKEND_META.other;
  const BackendIcon = backend.icon;

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
      const res = await fetch(
        `${env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories/${repository.id}/init`,
        {
          method: "POST",
          credentials: "include",
        },
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to initialize repository");
      }

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

  if (!session?.user) {
    return (
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">Session required.</p>
        <Button render={<a href="/login" />}>Go to login</Button>
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
            <Button variant="outline" render={<a href="/repositories" />}>
              <ArrowLeft className="size-4" />
              Back to repositories
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <Card className="overflow-hidden border-border/80">
        <CardContent className="relative p-0">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(120,120,120,0.08),transparent_55%)]" />
          <div className="relative space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon-sm" render={<a href="/repositories" />}>
                    <ArrowLeft className="size-4" />
                  </Button>
                  <Badge variant="outline" className="gap-1.5 p-3 text-[11px]">
                    <BackendIcon className={`size-3.5 ${backend.tone}`} />
                    {backend.label}
                  </Badge>
                  <Badge variant={repository.isInitialized ? "secondary" : "outline"} className="p-3">
                    {repository.isInitialized ? "Initialized" : "Not initialized"}
                  </Badge>
                  {repository.hasPassword && <Badge variant="outline" className="p-3">Password protected</Badge>}
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">{repository.name}</h1>
                <p className="max-w-4xl break-all font-mono text-xs text-muted-foreground">
                  {repository.repository}
                </p>
              </div>

              <Button
                size="sm"
                onClick={() => void handleInit()}
                disabled={!repository.worker || repository.isInitialized || isInitLoading}
              >
                {isInitLoading ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                {repository.isInitialized ? "Initialized" : "Initialize"}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Initialization</p>
                  <p className="mt-1 text-sm font-medium">
                    {repository.isInitialized ? "Repository ready" : "Pending init"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {repository.isInitialized ? formatDateTime(repository.initializedAt) : "No initialization recorded"}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Worker</p>
                  <p className="mt-1 text-sm font-medium">
                    {repository.worker ? repository.worker.name : "Not attached"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {repository.worker
                      ? repository.worker.isOnline
                        ? `Online, seen ${timeAgo(repository.worker.lastSeenAt)}`
                        : `Offline, seen ${timeAgo(repository.worker.lastSeenAt)}`
                      : "Attach a worker for init/backup"}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Options</p>
                  <p className="mt-1 text-sm font-medium">{optionEntries.length} configured</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {sensitiveOptionCount} sensitive value{sensitiveOptionCount === 1 ? "" : "s"}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Security</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                    {repository.hasPassword ? (
                      <>
                        <ShieldCheck className="size-4 text-emerald-500" />
                        Password set
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="size-4 text-amber-500" />
                        No password
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Protect repository credentials in transit and at rest.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Repository Options</CardTitle>
            <CardDescription>Runtime and backend options attached to this repository.</CardDescription>
          </CardHeader>
          <CardContent>
            {optionEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No custom options configured.</p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                {optionEntries.map(([key, value], index) => (
                  <div key={key}>
                    <div className="grid grid-cols-[minmax(0,180px)_1fr] gap-3 px-3 py-2">
                      <span className="truncate font-mono text-xs text-muted-foreground">{key}</span>
                      <span className="truncate font-mono text-xs">
                        {isSensitiveKey(key) ? maskValue(value) : value}
                      </span>
                    </div>
                    {index < optionEntries.length - 1 ? <Separator /> : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            <CardDescription>Lifecycle timestamps and current attachment status.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="text-sm font-medium">{formatDateTime(repository.createdAt)}</p>
            </div>
            <Separator />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Updated</p>
              <p className="text-sm font-medium">{formatDateTime(repository.updatedAt)}</p>
            </div>
            <Separator />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Initialized</p>
              <p className="text-sm font-medium">
                {repository.isInitialized ? formatDateTime(repository.initializedAt) : "Not yet initialized"}
              </p>
            </div>
            <Separator />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Worker status</p>
              <p className="text-sm font-medium">
                {repository.worker
                  ? repository.worker.isOnline
                    ? `${repository.worker.name} (online)`
                    : `${repository.worker.name} (offline)`
                  : "No worker attached"}
              </p>
            </div>
            <Separator />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Repository id</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{repository.id}</p>
            </div>
            <Separator />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Encryption</p>
              <p className="inline-flex items-center gap-1.5 text-sm font-medium">
                <KeyRound className="size-4 text-primary" />
                {repository.hasPassword ? "Password configured" : "No repository password"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
