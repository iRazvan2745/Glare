"use client";

import { Copy, Link2, Pencil, Plus, Search, Terminal, Trash2, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsBoolean, parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";
import { env } from "@glare/env/web";

type WorkerRecord = {
  id: string;
  name: string;
  status: "online" | "degraded" | "offline" | string;
  lastSeenAt: string | null;
  uptimeMs: number;
  requestsTotal: number;
  errorTotal: number;
  isOnline: boolean;
  createdAt: string;
  updatedAt: string;
};

type SyncEventRecord = {
  id: string;
  status: string;
  createdAt: string;
};

type RepositoryRecord = {
  id: string;
  name: string;
  backend: string;
  repository: string;
  hasPassword: boolean;
  options: Record<string, string>;
  worker: {
    id: string;
    name: string;
    status: string;
    isOnline: boolean;
    lastSeenAt: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type S3Draft = {
  endpoint: string;
  bucket: string;
  prefix: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  profile: string;
  storageClass: string;
  acl: string;
  pathStyle: boolean;
  disableTls: boolean;
  noVerifySsl: boolean;
};

type S3Preset = {
  id: string;
  label: string;
  description: string;
  values: Partial<S3Draft>;
};

const backendOptions = ["s3", "local", "b2", "rest", "webdav", "sftp", "rclone", "other"] as const;

function createDefaultS3Draft(): S3Draft {
  return {
    endpoint: "https://s3.amazonaws.com",
    bucket: "",
    prefix: "",
    region: "",
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    profile: "",
    storageClass: "",
    acl: "",
    pathStyle: true,
    disableTls: false,
    noVerifySsl: false,
  };
}

const s3Presets: S3Preset[] = [
  {
    id: "aws",
    label: "AWS S3",
    description: "Standard AWS S3",
    values: {
      endpoint: "https://s3.amazonaws.com",
      region: "us-east-1",
      pathStyle: true,
      disableTls: false,
      noVerifySsl: false,
    },
  },
  {
    id: "minio",
    label: "MinIO",
    description: "Local/self-hosted MinIO",
    values: {
      endpoint: "http://127.0.0.1:9000",
      pathStyle: true,
      disableTls: true,
      noVerifySsl: false,
    },
  },
  {
    id: "r2",
    label: "Cloudflare R2",
    description: "Account endpoint required",
    values: {
      endpoint: "https://<accountid>.r2.cloudflarestorage.com",
      region: "auto",
      pathStyle: true,
      disableTls: false,
      noVerifySsl: false,
    },
  },
  {
    id: "b2",
    label: "Backblaze B2",
    description: "B2 S3-compatible endpoint",
    values: {
      endpoint: "https://s3.us-west-004.backblazeb2.com",
      region: "us-west-004",
      pathStyle: true,
      disableTls: false,
      noVerifySsl: false,
    },
  },
  {
    id: "gov",
    label: "AWS GovCloud",
    description: "US GovCloud endpoint",
    values: {
      endpoint: "https://s3.us-gov-west-1.amazonaws.com",
      region: "us-gov-west-1",
      pathStyle: true,
      disableTls: false,
      noVerifySsl: false,
    },
  },
];

function applyS3Preset(current: S3Draft, preset: S3Preset): S3Draft {
  return {
    ...current,
    ...preset.values,
    pathStyle: preset.values.pathStyle ?? true,
  };
}

function buildS3PathPreview(s3: S3Draft) {
  const endpoint = (s3.endpoint.trim() || "https://s3.amazonaws.com").replace(/\/+$/, "");
  const bucket = s3.bucket.trim().replace(/^\/+|\/+$/g, "");
  const prefix = s3.prefix.trim().replace(/^\/+|\/+$/g, "");

  if (!bucket) {
    return "s3:<endpoint>/<bucket>[/prefix]";
  }

  return `s3:${endpoint}/${bucket}${prefix ? `/${prefix}` : ""}`;
}

function formatUptime(ms: number) {
  if (ms <= 0) return "\u2014";
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

export default function WorkersPage() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [workerUptimeById, setWorkerUptimeById] = useState<Record<string, string[]>>({});
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [isLoadingWorkers, setIsLoadingWorkers] = useState(true);
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(true);
  const [isCreatingWorker, setIsCreatingWorker] = useState(false);
  const [isUpdatingWorker, setIsUpdatingWorker] = useState(false);
  const [isDeletingWorker, setIsDeletingWorker] = useState(false);
  const [isSavingRepoSetup, setIsSavingRepoSetup] = useState(false);
  const [latestSyncToken, setLatestSyncToken] = useState("");
  const [latestWorkerId, setLatestWorkerId] = useState("");

  const [activeRepositoryWorkerId, setActiveRepositoryWorkerId] = useState("");
  const [selectedRepositoryIdToAttach, setSelectedRepositoryIdToAttach] = useState("");
  const [quickRepositoryName, setQuickRepositoryName] = useState("");
  const [quickRepositoryBackend, setQuickRepositoryBackend] =
    useState<(typeof backendOptions)[number]>("s3");
  const [quickRepositoryPath, setQuickRepositoryPath] = useState("");
  const [quickRepositoryPassword, setQuickRepositoryPassword] = useState("");
  const [quickS3, setQuickS3] = useState<S3Draft>(createDefaultS3Draft);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useQueryState(
    "create",
    parseAsBoolean.withDefault(false).withOptions({ history: "replace" }),
  );
  const [workerNameDraft, setWorkerNameDraft] = useQueryState(
    "workerName",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [searchQuery, setSearchQuery] = useQueryState(
    "q",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [statusFilter, setStatusFilter] = useQueryState(
    "status",
    parseAsString.withDefault("all").withOptions({ history: "replace" }),
  );
  const [sortBy, setSortBy] = useQueryState(
    "sort",
    parseAsString.withDefault("name-asc").withOptions({ history: "replace" }),
  );
  const [editingWorkerId, setEditingWorkerId] = useQueryState(
    "edit",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [editWorkerNameDraft, setEditWorkerNameDraft] = useQueryState(
    "editName",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [deletingWorkerId, setDeletingWorkerId] = useQueryState(
    "delete",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );

  const loadWorkers = useCallback(
    async (silent = false) => {
      if (!session?.user) {
        setWorkers([]);
        setIsLoadingWorkers(false);
        return;
      }

      if (!silent) {
        setIsLoadingWorkers(true);
      }

      try {
        const data = await apiFetchJson<{ workers?: WorkerRecord[] }>(
          `${env.NEXT_PUBLIC_SERVER_URL}/api/workers`,
          {
            method: "GET",
            retries: 1,
          },
        );
        const nextWorkers = data.workers ?? [];
        setWorkers(nextWorkers);

        if (nextWorkers.length === 0) {
          setWorkerUptimeById({});
        } else {
          const uptimeEntries = await Promise.all(
            nextWorkers.map(async (worker) => {
              try {
                const eventsData = await apiFetchJson<{ events?: SyncEventRecord[] }>(
                  `${env.NEXT_PUBLIC_SERVER_URL}/api/workers/${worker.id}/sync-events?hours=24`,
                  {
                    method: "GET",
                    retries: 1,
                  },
                );
                const statuses = (eventsData.events ?? []).slice(-6).map((event) => event.status);
                return [worker.id, statuses] as const;
              } catch {
                return [worker.id, []] as const;
              }
            }),
          );

          setWorkerUptimeById(Object.fromEntries(uptimeEntries));
        }
      } catch {
        if (!silent) {
          toast.error("Could not load workers.");
        }
      } finally {
        if (!silent) {
          setIsLoadingWorkers(false);
        }
      }
    },
    [session?.user],
  );

  const loadRepositories = useCallback(
    async (silent = false) => {
      if (!session?.user) {
        setRepositories([]);
        setIsLoadingRepositories(false);
        return;
      }

      if (!silent) {
        setIsLoadingRepositories(true);
      }

      try {
        const data = await apiFetchJson<{ repositories?: RepositoryRecord[] }>(
          `${env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories`,
          {
            method: "GET",
            retries: 1,
          },
        );
        setRepositories(data.repositories ?? []);
      } catch {
        if (!silent) {
          toast.error("Could not load repositories.");
        }
      } finally {
        if (!silent) {
          setIsLoadingRepositories(false);
        }
      }
    },
    [session?.user],
  );

  useEffect(() => {
    void loadWorkers();
    void loadRepositories();
  }, [loadRepositories, loadWorkers]);

  useEffect(() => {
    if (!session?.user) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadWorkers(true);
      void loadRepositories(true);
    }, 5000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadWorkers(true);
        void loadRepositories(true);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadRepositories, loadWorkers, session?.user]);

  const filteredWorkers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const statusFiltered = workers.filter((currentWorker) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "online") return currentWorker.isOnline;
      if (statusFilter === "offline") return !currentWorker.isOnline;
      return currentWorker.status === statusFilter;
    });

    const searchFiltered = normalizedQuery
      ? statusFiltered.filter((currentWorker) =>
          currentWorker.name.toLowerCase().includes(normalizedQuery),
        )
      : statusFiltered;

    return [...searchFiltered].sort((a, b) => {
      if (sortBy === "last-seen-desc") {
        return new Date(b.lastSeenAt ?? 0).getTime() - new Date(a.lastSeenAt ?? 0).getTime();
      }
      if (sortBy === "last-seen-asc") {
        return new Date(a.lastSeenAt ?? 0).getTime() - new Date(b.lastSeenAt ?? 0).getTime();
      }
      if (sortBy === "status") {
        return `${a.status}`.localeCompare(`${b.status}`);
      }
      if (sortBy === "name-desc") {
        return b.name.localeCompare(a.name);
      }
      return a.name.localeCompare(b.name);
    });
  }, [searchQuery, sortBy, statusFilter, workers]);

  const repositoriesByWorkerId = useMemo(() => {
    const map = new Map<string, RepositoryRecord[]>();

    for (const repository of repositories) {
      const workerId = repository.worker?.id;
      if (!workerId) continue;

      const next = map.get(workerId) ?? [];
      next.push(repository);
      map.set(workerId, next);
    }

    return map;
  }, [repositories]);

  const activeWorker = useMemo(
    () => workers.find((worker) => worker.id === activeRepositoryWorkerId) ?? null,
    [activeRepositoryWorkerId, workers],
  );

  const activeWorkerRepositories = useMemo(() => {
    if (!activeWorker) return [];
    return repositoriesByWorkerId.get(activeWorker.id) ?? [];
  }, [activeWorker, repositoriesByWorkerId]);

  const attachableRepositories = useMemo(() => {
    if (!activeWorker) return [];

    return repositories.filter((repository) => repository.worker?.id !== activeWorker.id);
  }, [activeWorker, repositories]);

  function resetRepositoryDialogState() {
    setActiveRepositoryWorkerId("");
    setSelectedRepositoryIdToAttach("");
    setQuickRepositoryName("");
    setQuickRepositoryBackend("s3");
    setQuickRepositoryPath("");
    setQuickRepositoryPassword("");
    setQuickS3(createDefaultS3Draft());
  }

  async function createWorker() {
    const normalizedName = workerNameDraft.trim();

    if (!normalizedName) {
      toast.error("Worker name cannot be empty.");
      return;
    }

    setIsCreatingWorker(true);

    try {
      const response = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/workers`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: normalizedName }),
      });

      if (!response.ok) {
        throw new Error("Failed to create worker");
      }

      const data = (await response.json()) as { worker?: WorkerRecord; syncToken?: string };
      if (data.worker) {
        setWorkers((previous) => [data.worker as WorkerRecord, ...previous]);
        setLatestWorkerId(data.worker.id);
      }
      if (data.syncToken) {
        setLatestSyncToken(data.syncToken);
      }
      await setWorkerNameDraft("");
      await setIsCreateDialogOpen(false);
      toast.success("Worker created.");
    } catch {
      toast.error("Could not create worker.");
    } finally {
      setIsCreatingWorker(false);
    }
  }

  async function updateWorkerName() {
    if (!editingWorkerId) {
      return;
    }

    const normalizedName = editWorkerNameDraft.trim();
    if (!normalizedName) {
      toast.error("Worker name cannot be empty.");
      return;
    }

    setIsUpdatingWorker(true);
    try {
      const response = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/workers/${editingWorkerId}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: normalizedName }),
      });

      if (!response.ok) {
        throw new Error("Failed to update worker");
      }

      const data = (await response.json()) as { worker?: WorkerRecord };
      if (data.worker) {
        setWorkers((previous) =>
          previous.map((item) => (item.id === data.worker!.id ? data.worker! : item)),
        );
      }

      await setEditingWorkerId("");
      await setEditWorkerNameDraft("");
      toast.success("Worker updated.");
    } catch {
      toast.error("Could not update worker.");
    } finally {
      setIsUpdatingWorker(false);
    }
  }

  async function deleteWorker() {
    if (!deletingWorkerId) {
      return;
    }

    setIsDeletingWorker(true);
    try {
      const response = await fetch(
        `${env.NEXT_PUBLIC_SERVER_URL}/api/workers/${deletingWorkerId}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to delete worker");
      }

      setWorkers((previous) => previous.filter((item) => item.id !== deletingWorkerId));
      setRepositories((previous) =>
        previous.map((repository) =>
          repository.worker?.id === deletingWorkerId ? { ...repository, worker: null } : repository,
        ),
      );
      if (latestWorkerId === deletingWorkerId) {
        setLatestWorkerId("");
        setLatestSyncToken("");
      }
      await setDeletingWorkerId("");
      toast.success("Worker deleted.");
    } catch {
      toast.error("Could not delete worker.");
    } finally {
      setIsDeletingWorker(false);
    }
  }

  async function attachSelectedRepository() {
    if (!activeWorker || !selectedRepositoryIdToAttach) {
      return;
    }

    setIsSavingRepoSetup(true);
    try {
      const response = await fetch(
        `${env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories/${selectedRepositoryIdToAttach}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ workerId: activeWorker.id }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to attach repository");
      }

      const data = (await response.json()) as { repository?: RepositoryRecord };
      if (data.repository) {
        setRepositories((previous) =>
          previous.map((repository) =>
            repository.id === data.repository!.id ? data.repository! : repository,
          ),
        );
      }
      setSelectedRepositoryIdToAttach("");
      toast.success("Repository linked to worker.");
    } catch {
      toast.error("Could not link repository.");
    } finally {
      setIsSavingRepoSetup(false);
    }
  }

  async function detachRepository(repositoryId: string) {
    setIsSavingRepoSetup(true);
    try {
      const response = await fetch(
        `${env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories/${repositoryId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ workerId: null }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to detach repository");
      }

      const data = (await response.json()) as { repository?: RepositoryRecord };
      if (data.repository) {
        setRepositories((previous) =>
          previous.map((repository) =>
            repository.id === data.repository!.id ? data.repository! : repository,
          ),
        );
      }

      toast.success("Repository detached.");
    } catch {
      toast.error("Could not detach repository.");
    } finally {
      setIsSavingRepoSetup(false);
    }
  }

  async function createAndAttachRepository() {
    if (!activeWorker) {
      return;
    }

    const name = quickRepositoryName.trim();
    const repositoryPath = quickRepositoryPath.trim();

    if (!name) {
      toast.error("Repository name is required.");
      return;
    }

    if (quickRepositoryBackend === "s3" && !quickS3.bucket.trim()) {
      toast.error("S3 bucket is required.");
      return;
    }

    if (quickRepositoryBackend !== "s3" && !repositoryPath) {
      toast.error("Repository path is required.");
      return;
    }

    setIsSavingRepoSetup(true);
    try {
      const response = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/rustic/repositories`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          backend: quickRepositoryBackend,
          repository: quickRepositoryBackend === "s3" ? undefined : repositoryPath,
          workerId: activeWorker.id,
          password: quickRepositoryPassword.trim() || undefined,
          s3:
            quickRepositoryBackend === "s3"
              ? {
                  endpoint: quickS3.endpoint.trim() || undefined,
                  bucket: quickS3.bucket.trim(),
                  prefix: quickS3.prefix.trim() || undefined,
                  region: quickS3.region.trim() || undefined,
                  accessKeyId: quickS3.accessKeyId.trim() || undefined,
                  secretAccessKey: quickS3.secretAccessKey.trim() || undefined,
                  sessionToken: quickS3.sessionToken.trim() || undefined,
                  profile: quickS3.profile.trim() || undefined,
                  storageClass: quickS3.storageClass.trim() || undefined,
                  acl: quickS3.acl.trim() || undefined,
                  pathStyle: quickS3.pathStyle,
                  disableTls: quickS3.disableTls,
                  noVerifySsl: quickS3.noVerifySsl,
                }
              : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create repository");
      }

      const data = (await response.json()) as { repository?: RepositoryRecord };
      if (data.repository) {
        setRepositories((previous) => [data.repository!, ...previous]);
      }

      setQuickRepositoryName("");
      setQuickRepositoryBackend("s3");
      setQuickRepositoryPath("");
      setQuickRepositoryPassword("");
      setQuickS3(createDefaultS3Draft());
      toast.success("Repository created and linked.");
    } catch {
      toast.error("Could not create repository.");
    } finally {
      setIsSavingRepoSetup(false);
    }
  }

  const latestWorkerRunCommand = latestSyncToken
    ? `cargo run --manifest-path apps/worker/Cargo.toml -- --master-api-endpoint ${env.NEXT_PUBLIC_SERVER_URL} --local-api-endpoint http://127.0.0.1:4001 --api-token '${latestSyncToken}'`
    : "";
  const quickS3Preview = useMemo(() => buildS3PathPreview(quickS3), [quickS3]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workers</h1>
          <p className="text-sm text-muted-foreground">
            Workers are assigned directly to your user. Use Rustic Setup per worker to attach
            repositories.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push("/repositories" as never)}>
            Repositories
          </Button>
          <Dialog
            open={isCreateDialogOpen}
            onOpenChange={(nextValue) => void setIsCreateDialogOpen(nextValue)}
          >
            <DialogTrigger render={<Button size="sm" className="gap-2" />}>
              <UserRoundPlus className="size-4" />
              Create Worker
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Worker</DialogTitle>
                <DialogDescription>
                  Give this worker a name. Your draft is kept in query params.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <label htmlFor="worker-name" className="text-sm font-medium">
                  Name
                </label>
                <Input
                  id="worker-name"
                  autoFocus
                  value={workerNameDraft}
                  onChange={(event) => void setWorkerNameDraft(event.target.value)}
                  placeholder="Nightly report runner"
                  disabled={isCreatingWorker}
                  maxLength={120}
                />
              </div>

              <DialogFooter>
                <DialogClose render={<Button variant="outline" disabled={isCreatingWorker} />}>
                  Cancel
                </DialogClose>
                <Button onClick={() => void createWorker()} disabled={isCreatingWorker}>
                  {isCreatingWorker ? "Creating..." : "Create Worker"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div>
        <p className="text-sm text-muted-foreground">
          Owner: {session?.user.email || "No active user"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Worker Directory</CardTitle>
          <CardDescription>
            Create, search, and review workers tied to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {latestSyncToken ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                Worker sync token (shown once)
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="block w-full overflow-x-auto rounded bg-background p-2 text-xs">
                  {latestSyncToken}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(latestSyncToken);
                    toast.success("Sync token copied.");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <p className="mt-3 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                Run command
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="block w-full overflow-x-auto rounded bg-background p-2 text-xs">
                  {latestWorkerRunCommand}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(latestWorkerRunCommand);
                    toast.success("Run command copied.");
                  }}
                >
                  <Terminal className="size-4" />
                </Button>
              </div>
              {latestWorkerId ? (
                <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300">
                  Worker ID: {latestWorkerId}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => void setSearchQuery(event.target.value)}
              placeholder="Search workers"
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded border bg-background px-2 text-xs"
              value={statusFilter}
              onChange={(event) => void setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="degraded">Degraded</option>
            </select>
            <select
              className="h-8 rounded border bg-background px-2 text-xs"
              value={sortBy}
              onChange={(event) => void setSortBy(event.target.value)}
            >
              <option value="name-asc">Name A-Z</option>
              <option value="name-desc">Name Z-A</option>
              <option value="last-seen-desc">Last seen newest</option>
              <option value="last-seen-asc">Last seen oldest</option>
              <option value="status">Status</option>
            </select>
          </div>

          {isLoadingWorkers || isLoadingRepositories ? (
            <p className="text-sm text-muted-foreground">Loading worker setup...</p>
          ) : null}

          {!isLoadingWorkers && filteredWorkers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No workers found. Create one to get started.
            </p>
          ) : null}

          {!isLoadingWorkers && filteredWorkers.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[760px] text-xs">
                <thead>
                  <tr className="border-b bg-muted/30 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Worker</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Uptime (6)</th>
                    <th className="px-3 py-2 font-medium">Metrics</th>
                    <th className="px-3 py-2 font-medium">Repositories</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredWorkers.map((currentWorker) => {
                    const linkedRepositories = repositoriesByWorkerId.get(currentWorker.id) ?? [];

                    return (
                      <tr key={currentWorker.id}>
                        <td className="px-3 py-2">
                          <Link
                            href={`/workers/${currentWorker.id}`}
                            className="font-medium hover:underline"
                          >
                            {currentWorker.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded px-2 py-0.5 ${
                              currentWorker.isOnline
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {currentWorker.isOnline ? "Online" : "Offline"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            {Array.from({ length: 6 }).map((_, index) => {
                              const status = workerUptimeById[currentWorker.id]?.[index] ?? "unknown";
                              const tone =
                                status === "online"
                                  ? "bg-emerald-500/80"
                                  : status === "degraded"
                                    ? "bg-amber-500/80"
                                    : status === "offline"
                                      ? "bg-rose-500/70"
                                      : "bg-muted";

                              return (
                                <span
                                  key={`${currentWorker.id}-uptime-${index}`}
                                  className={`inline-block h-4 w-2 rounded-sm ${tone}`}
                                  aria-label={`Uptime slot ${index + 1}: ${status}`}
                                  title={`Status: ${status}`}
                                />
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          req {formatNumber(currentWorker.requestsTotal)} / err{" "}
                          {formatNumber(currentWorker.errorTotal)} / up {formatUptime(currentWorker.uptimeMs)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {linkedRepositories.length > 0
                            ? linkedRepositories.map((repository) => repository.name).join(", ")
                            : "none"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => setActiveRepositoryWorkerId(currentWorker.id)}
                            >
                              <Link2 className="size-3.5" />
                              Rustic Setup
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="outline"
                              onClick={() => {
                                void setEditingWorkerId(currentWorker.id);
                                void setEditWorkerNameDraft(currentWorker.name);
                              }}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="destructive"
                              onClick={() => {
                                void setDeletingWorkerId(currentWorker.id);
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(editingWorkerId)}
        onOpenChange={(nextValue) => {
          if (!nextValue) {
            void setEditingWorkerId("");
            void setEditWorkerNameDraft("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Worker</DialogTitle>
            <DialogDescription>Update the worker name.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="edit-worker-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="edit-worker-name"
              value={editWorkerNameDraft}
              onChange={(event) => void setEditWorkerNameDraft(event.target.value)}
              maxLength={120}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isUpdatingWorker} />}>
              Cancel
            </DialogClose>
            <Button onClick={() => void updateWorkerName()} disabled={isUpdatingWorker}>
              {isUpdatingWorker ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deletingWorkerId)}
        onOpenChange={(nextValue) => {
          if (!nextValue) {
            void setDeletingWorkerId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Worker</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isDeletingWorker} />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => void deleteWorker()}
              disabled={isDeletingWorker}
            >
              {isDeletingWorker ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(activeRepositoryWorkerId)}
        onOpenChange={(nextValue) => {
          if (!nextValue) {
            resetRepositoryDialogState();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rustic Setup</DialogTitle>
            <DialogDescription>
              {activeWorker
                ? `Attach repositories for ${activeWorker.name}.`
                : "Attach repositories to this worker."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">Current repositories</p>
              {activeWorkerRepositories.length === 0 ? (
                <p className="text-xs text-muted-foreground">No repositories attached yet.</p>
              ) : (
                <ul className="space-y-2">
                  {activeWorkerRepositories.map((repository) => (
                    <li
                      key={repository.id}
                      className="flex items-center justify-between gap-2 rounded border p-2"
                    >
                      <div>
                        <p className="text-xs font-medium">{repository.name}</p>
                        <p className="text-[11px] text-muted-foreground">{repository.backend}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={isSavingRepoSetup}
                        onClick={() => void detachRepository(repository.id)}
                      >
                        Detach
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Attach existing repository
              </p>
              <div className="flex items-center gap-2">
                <select
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={selectedRepositoryIdToAttach}
                  onChange={(event) => setSelectedRepositoryIdToAttach(event.target.value)}
                >
                  <option value="">Select repository</option>
                  {attachableRepositories.map((repository) => (
                    <option key={repository.id} value={repository.id}>
                      {repository.name} ({repository.backend})
                      {repository.worker ? ` - currently ${repository.worker.name}` : ""}
                    </option>
                  ))}
                </select>
                <Button
                  className="h-9"
                  disabled={!selectedRepositoryIdToAttach || isSavingRepoSetup}
                  onClick={() => void attachSelectedRepository()}
                >
                  Attach
                </Button>
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">Quick create and attach</p>
              <div className="grid gap-2">
                <Input
                  placeholder="Repository name"
                  value={quickRepositoryName}
                  onChange={(event) => setQuickRepositoryName(event.target.value)}
                  disabled={isSavingRepoSetup}
                />
                <select
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={quickRepositoryBackend}
                  onChange={(event) =>
                    setQuickRepositoryBackend(event.target.value as (typeof backendOptions)[number])
                  }
                  disabled={isSavingRepoSetup}
                >
                  {backendOptions.map((backend) => (
                    <option key={backend} value={backend}>
                      {backend}
                    </option>
                  ))}
                </select>
                {quickRepositoryBackend === "s3" ? (
                  <div className="space-y-2 rounded-md border p-2">
                    <div className="flex flex-wrap gap-1">
                      {s3Presets.map((preset) => (
                        <Button
                          key={preset.id}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          disabled={isSavingRepoSetup}
                          onClick={() => setQuickS3((current) => applyS3Preset(current, preset))}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                    <Input
                      placeholder="Endpoint (https://s3.amazonaws.com)"
                      value={quickS3.endpoint}
                      onChange={(event) =>
                        setQuickS3((current) => ({ ...current, endpoint: event.target.value }))
                      }
                      disabled={isSavingRepoSetup}
                    />
                    <Input
                      placeholder="Bucket"
                      value={quickS3.bucket}
                      onChange={(event) =>
                        setQuickS3((current) => ({ ...current, bucket: event.target.value }))
                      }
                      disabled={isSavingRepoSetup}
                    />
                    <Input
                      placeholder="Prefix"
                      value={quickS3.prefix}
                      onChange={(event) =>
                        setQuickS3((current) => ({ ...current, prefix: event.target.value }))
                      }
                      disabled={isSavingRepoSetup}
                    />
                    <Input
                      placeholder="Region"
                      value={quickS3.region}
                      onChange={(event) =>
                        setQuickS3((current) => ({ ...current, region: event.target.value }))
                      }
                      disabled={isSavingRepoSetup}
                    />
                    <Input
                      placeholder="Access Key ID"
                      value={quickS3.accessKeyId}
                      onChange={(event) =>
                        setQuickS3((current) => ({ ...current, accessKeyId: event.target.value }))
                      }
                      disabled={isSavingRepoSetup}
                    />
                    <Input
                      placeholder="Secret Access Key"
                      value={quickS3.secretAccessKey}
                      onChange={(event) =>
                        setQuickS3((current) => ({
                          ...current,
                          secretAccessKey: event.target.value,
                        }))
                      }
                      disabled={isSavingRepoSetup}
                    />
                    <Input
                      placeholder="Session Token"
                      value={quickS3.sessionToken}
                      onChange={(event) =>
                        setQuickS3((current) => ({ ...current, sessionToken: event.target.value }))
                      }
                      disabled={isSavingRepoSetup}
                    />
                    <Input
                      placeholder="AWS Profile"
                      value={quickS3.profile}
                      onChange={(event) =>
                        setQuickS3((current) => ({ ...current, profile: event.target.value }))
                      }
                      disabled={isSavingRepoSetup}
                    />
                    <Input
                      placeholder="Storage Class"
                      value={quickS3.storageClass}
                      onChange={(event) =>
                        setQuickS3((current) => ({ ...current, storageClass: event.target.value }))
                      }
                      disabled={isSavingRepoSetup}
                    />
                    <Input
                      placeholder="ACL"
                      value={quickS3.acl}
                      onChange={(event) =>
                        setQuickS3((current) => ({ ...current, acl: event.target.value }))
                      }
                      disabled={isSavingRepoSetup}
                    />
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={quickS3.pathStyle}
                          onChange={(event) =>
                            setQuickS3((current) => ({
                              ...current,
                              pathStyle: event.target.checked,
                            }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                        Path Style
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={quickS3.disableTls}
                          onChange={(event) =>
                            setQuickS3((current) => ({
                              ...current,
                              disableTls: event.target.checked,
                            }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                        Disable TLS
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={quickS3.noVerifySsl}
                          onChange={(event) =>
                            setQuickS3((current) => ({
                              ...current,
                              noVerifySsl: event.target.checked,
                            }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                        Skip SSL Verify
                      </label>
                    </div>
                    <p className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                      {quickS3Preview}
                    </p>
                  </div>
                ) : (
                  <Input
                    placeholder="Repository path"
                    value={quickRepositoryPath}
                    onChange={(event) => setQuickRepositoryPath(event.target.value)}
                    disabled={isSavingRepoSetup}
                  />
                )}
                <Input
                  placeholder="Password (optional)"
                  value={quickRepositoryPassword}
                  onChange={(event) => setQuickRepositoryPassword(event.target.value)}
                  disabled={isSavingRepoSetup}
                />
              </div>
              <Button
                variant="outline"
                className="h-8 gap-1 text-xs"
                disabled={isSavingRepoSetup}
                onClick={() => void createAndAttachRepository()}
              >
                <Plus className="size-3.5" />
                Create + Attach
              </Button>
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isSavingRepoSetup} />}>
              Close
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
