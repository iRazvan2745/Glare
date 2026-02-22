"use client";

import { apiBaseUrl } from "@/lib/api-base-url";
import {
  RiAddLine,
  RiFileCopyLine,
  RiLinkM,
  RiPulseLine,
  RiServerLine,
  RiTerminalBoxLine,
  RiUserAddLine,
} from "@remixicon/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsBoolean, parseAsString, useQueryState } from "nuqs";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";

import {
  ActionMenu,
  ControlPlaneEmptyState,
  SectionHeader,
  StatusBadge,
} from "@/components/control-plane";
import { DataTableFilter, useDataTableFilters } from "@/components/data-table-filter";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { deriveHealthStatus } from "@/lib/control-plane/health";
import { apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "@/components/ui/select";

type WorkerRecord = {
  id: string;
  name: string;
  region: string | null;
  ipAddress: string | null;
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

function WorkersPageContent() {
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
  const [workerIpDraft, setWorkerIpDraft] = useQueryState(
    "workerIp",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [sortBy, setSortBy] = useState("name-asc");
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
        const data = await apiFetchJson<{ workers?: WorkerRecord[] }>(`${apiBaseUrl}/api/workers`, {
          method: "GET",
          retries: 1,
        });
        const nextWorkers = data.workers ?? [];
        setWorkers(nextWorkers);

        if (nextWorkers.length === 0) {
          setWorkerUptimeById({});
        } else {
          const uptimeEntries = await Promise.all(
            nextWorkers.map(async (worker) => {
              try {
                const eventsData = await apiFetchJson<{ events?: SyncEventRecord[] }>(
                  `${apiBaseUrl}/api/workers/${worker.id}/sync-events?hours=24&limit=24`,
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
          `${apiBaseUrl}/api/rustic/repositories`,
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

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadWorkers(true);
        void loadRepositories(true);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadRepositories, loadWorkers, session?.user]);

  const workerFilterColumnsConfig = useMemo(
    () => [
      {
        id: "status",
        accessor: (worker: WorkerRecord) =>
          worker.isOnline ? "online" : worker.status === "degraded" ? "degraded" : "offline",
        displayName: "Status",
        icon: RiPulseLine,
        type: "option" as const,
        options: [
          { label: "Online", value: "online" },
          { label: "Offline", value: "offline" },
          { label: "Degraded", value: "degraded" },
        ],
      },
    ],
    [],
  );

  const {
    actions: workerFilterActions,
    columns: workerFilterColumns,
    filters: workerFilters,
    strategy: workerFilterStrategy,
  } = useDataTableFilters({
    strategy: "client",
    data: workers,
    columnsConfig: workerFilterColumnsConfig,
  });

  const statusFilter = useMemo(() => {
    const filter = workerFilters.find((entry) => entry.columnId === "status");
    return filter?.values ?? [];
  }, [workerFilters]);

  const filteredWorkers = useMemo(() => {
    let result = workers;

    if (statusFilter.length > 0) {
      result = result.filter((w) => {
        const derivedStatus = w.isOnline
          ? "online"
          : w.status === "degraded"
            ? "degraded"
            : "offline";
        return statusFilter.includes(derivedStatus);
      });
    }

    return [...result].sort((a, b) => {
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
  }, [sortBy, statusFilter, workers]);

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
    const normalizedWorkerIp = workerIpDraft.trim();

    if (!normalizedName) {
      toast.error("Worker name cannot be empty.");
      return;
    }
    if (!normalizedWorkerIp) {
      toast.error("Worker IP cannot be empty.");
      return;
    }

    setIsCreatingWorker(true);

    try {
      const data = await apiFetchJson<{ worker?: WorkerRecord; syncToken?: string }>(
        `${apiBaseUrl}/api/workers`,
        {
          method: "POST",
          body: JSON.stringify({ name: normalizedName, workerIp: normalizedWorkerIp }),
          retries: 1,
        },
      );
      if (data.worker) {
        setWorkers((previous) => [data.worker as WorkerRecord, ...previous]);
        setLatestWorkerId(data.worker.id);
      }
      if (data.syncToken) {
        setLatestSyncToken(data.syncToken);
      }
      await setWorkerNameDraft("");
      await setWorkerIpDraft("");
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
      const data = await apiFetchJson<{ worker?: WorkerRecord }>(
        `${apiBaseUrl}/api/workers/${editingWorkerId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: normalizedName }),
          retries: 1,
        },
      );
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
      await apiFetchJson(`${apiBaseUrl}/api/workers/${deletingWorkerId}`, {
        method: "DELETE",
        retries: 1,
      });

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
      const data = await apiFetchJson<{ repository?: RepositoryRecord }>(
        `${apiBaseUrl}/api/rustic/repositories/${selectedRepositoryIdToAttach}`,
        {
          method: "PATCH",
          body: JSON.stringify({ workerId: activeWorker.id }),
          retries: 1,
        },
      );
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
      const data = await apiFetchJson<{ repository?: RepositoryRecord }>(
        `${apiBaseUrl}/api/rustic/repositories/${repositoryId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ workerId: null }),
          retries: 1,
        },
      );
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
      const data = await apiFetchJson<{ repository?: RepositoryRecord }>(
        `${apiBaseUrl}/api/rustic/repositories`,
        {
          method: "POST",
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
          retries: 1,
        },
      );
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

  const workerInstallerScriptUrl =
    "https://raw.githubusercontent.com/iRazvan2745/Glare/main/apps/worker/installer/install.sh";
  const latestWorkerInstallCommand = latestSyncToken
    ? `curl -fsSL ${workerInstallerScriptUrl} -o /tmp/worker-installer && chmod +x /tmp/worker-installer && sudo mv /tmp/worker-installer /usr/local/bin/worker-installer && worker-installer --master-api-endpoint ${apiBaseUrl} --local-api-endpoint http://127.0.0.1:4001 --api-token '${latestSyncToken}'`
    : "";
  const quickS3Preview = useMemo(() => buildS3PathPreview(quickS3), [quickS3]);
  const onlineCount = workers.filter((worker) => worker.isOnline).length;
  const offlineCount = workers.length - onlineCount;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Worker Fleet"
        subtitle={`${onlineCount} online • ${offlineCount} offline`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/repositories" as never)}
            >
              Repositories
            </Button>
            <Dialog
              open={isCreateDialogOpen}
              onOpenChange={(nextValue) => void setIsCreateDialogOpen(nextValue)}
            >
              <DialogTrigger render={<Button size="sm" className="gap-2" />}>
                <RiUserAddLine className="size-4" />
                Create Worker
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Worker</DialogTitle>
                  <DialogDescription>
                    Give this worker a name and IP. Draft values are kept in query params.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
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
                  <label htmlFor="worker-ip" className="text-sm font-medium">
                    Worker IP
                  </label>
                  <Input
                    id="worker-ip"
                    value={workerIpDraft}
                    onChange={(event) => void setWorkerIpDraft(event.target.value)}
                    placeholder="192.168.1.42"
                    disabled={isCreatingWorker}
                    maxLength={45}
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
        }
      />

      <div>
        <p className="text-sm text-muted-foreground">
          Owner: {session?.user.email || "No active user"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Worker Fleet</CardTitle>
          <CardDescription>
            Operational capacity, health, and execution controls for worker nodes.
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
                  <RiFileCopyLine className="size-4" />
                </Button>
              </div>
              <p className="mt-3 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                Installer command
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="block w-full overflow-x-auto rounded bg-background p-2 text-xs">
                  {latestWorkerInstallCommand}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(latestWorkerInstallCommand);
                    toast.success("Installer command copied.");
                  }}
                >
                  <RiTerminalBoxLine className="size-4" />
                </Button>
              </div>
              {latestWorkerId ? (
                <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300">
                  Worker ID: {latestWorkerId}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <DataTableFilter
              columns={workerFilterColumns}
              filters={workerFilters}
              actions={workerFilterActions}
              strategy={workerFilterStrategy}
            />
            <Select value={sortBy} onValueChange={(e) => setSortBy(e!)}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="name-asc">Name A-Z</SelectItem>
                <SelectItem value="name-desc">Name Z-A</SelectItem>
                <SelectItem value="last-seen-desc">Last seen newest</SelectItem>
                <SelectItem value="last-seen-asc">Last seen oldest</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectPopup>
            </Select>
          </div>

          {isLoadingWorkers || isLoadingRepositories ? (
            <p className="text-sm text-muted-foreground">Loading worker setup...</p>
          ) : null}

          {!isLoadingWorkers && filteredWorkers.length === 0 ? (
            <ControlPlaneEmptyState
              icon={RiServerLine}
              title="No workers registered"
              description="Register a worker to start executing snapshot and retention jobs."
            />
          ) : null}

          {!isLoadingWorkers && filteredWorkers.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-190 text-xs">
                <thead>
                  <tr className="border-b bg-muted/30 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Worker</th>
                    <th className="px-3 py-2 font-medium">Region</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Last Seen</th>
                    <th className="px-3 py-2 font-medium">Uptime</th>
                    <th className="px-3 py-2 font-medium">Requests (24h)</th>
                    <th className="px-3 py-2 font-medium">Errors (24h)</th>
                    <th className="px-3 py-2 font-medium">Repos Attached</th>
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
                        <td className="px-3 py-2 text-muted-foreground">
                          {currentWorker.region ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge
                            status={deriveHealthStatus({
                              totalWorkers: 1,
                              offlineWorkers: currentWorker.isOnline ? 0 : 1,
                              errorRate24h:
                                currentWorker.requestsTotal > 0
                                  ? (currentWorker.errorTotal / currentWorker.requestsTotal) * 100
                                  : 0,
                            })}
                            label={currentWorker.isOnline ? "Online" : "Offline"}
                          />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {currentWorker.lastSeenAt
                            ? new Intl.DateTimeFormat(undefined, {
                                dateStyle: "short",
                                timeStyle: "short",
                              }).format(new Date(currentWorker.lastSeenAt))
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {formatUptime(currentWorker.uptimeMs)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {formatNumber(currentWorker.requestsTotal)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {formatNumber(currentWorker.errorTotal)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {linkedRepositories.length}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => setActiveRepositoryWorkerId(currentWorker.id)}
                            >
                              <RiLinkM className="size-3.5" />
                              Setup
                            </Button>
                            <ActionMenu
                              items={[
                                {
                                  label: "View",
                                  onSelect: () =>
                                    router.push(`/workers/${currentWorker.id}` as never),
                                },
                                {
                                  label: "Edit",
                                  onSelect: () => {
                                    void setEditWorkerNameDraft(currentWorker.name);
                                    void setEditingWorkerId(currentWorker.id);
                                  },
                                },
                                {
                                  label: "Logs",
                                  onSelect: () => toast.info("Logs view is not available yet."),
                                },
                                {
                                  label: "Restart",
                                  onSelect: () => toast.info("Restart action is stubbed."),
                                },
                                {
                                  label: "Drain",
                                  onSelect: () => toast.info("Drain action is stubbed."),
                                },
                                {
                                  label: "Delete",
                                  onSelect: () => {
                                    void setDeletingWorkerId(currentWorker.id);
                                  },
                                  destructive: true,
                                },
                              ]}
                            />
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
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Repository Setup</DialogTitle>
            <DialogDescription>
              {activeWorker
                ? `Manage repositories for ${activeWorker.name}.`
                : "Manage repositories for this worker."}
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-4 flex-1 overflow-y-auto px-4">
            <div className="space-y-4 pb-2">
              {/* Current repositories */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Attached repositories</p>
                {activeWorkerRepositories.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60">None yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {activeWorkerRepositories.map((repository) => (
                      <div
                        key={repository.id}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">{repository.name}</p>
                          <p className="text-[11px] text-muted-foreground">{repository.backend}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 px-2 text-xs"
                          disabled={isSavingRepoSetup}
                          onClick={() => void detachRepository(repository.id)}
                        >
                          Detach
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              {/* Attach existing */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Attach existing repository
                </p>
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedRepositoryIdToAttach}
                    onValueChange={(value) => setSelectedRepositoryIdToAttach(value ?? "")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select repository" />
                    </SelectTrigger>
                    <SelectPopup>
                      {attachableRepositories.length === 0 ? (
                        <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                          No repositories available
                        </p>
                      ) : (
                        attachableRepositories.map((repository) => (
                          <SelectItem key={repository.id} value={repository.id}>
                            {repository.name} ({repository.backend})
                            {repository.worker ? ` \u2014 on ${repository.worker.name}` : ""}
                          </SelectItem>
                        ))
                      )}
                    </SelectPopup>
                  </Select>
                  <Button
                    className="h-8 shrink-0"
                    disabled={!selectedRepositoryIdToAttach || isSavingRepoSetup}
                    onClick={() => void attachSelectedRepository()}
                  >
                    Attach
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Quick create */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground">Create new repository</p>

                <div className="space-y-1">
                  <Label htmlFor="repo-name">Name</Label>
                  <Input
                    id="repo-name"
                    placeholder="my-backups"
                    value={quickRepositoryName}
                    onChange={(event) => setQuickRepositoryName(event.target.value)}
                    disabled={isSavingRepoSetup}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="repo-backend">Backend</Label>
                  <Select
                    value={quickRepositoryBackend}
                    onValueChange={(value) =>
                      setQuickRepositoryBackend((value ?? "s3") as (typeof backendOptions)[number])
                    }
                    disabled={isSavingRepoSetup}
                  >
                    <SelectTrigger id="repo-backend">
                      <SelectValue placeholder="Backend" />
                    </SelectTrigger>
                    <SelectPopup>
                      {backendOptions.map((backend) => (
                        <SelectItem key={backend} value={backend}>
                          {backend}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>

                {quickRepositoryBackend === "s3" ? (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium text-muted-foreground">Preset</p>
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
                    </div>

                    <Separator />

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor="s3-endpoint">Endpoint</Label>
                        <Input
                          id="s3-endpoint"
                          placeholder="https://s3.amazonaws.com"
                          value={quickS3.endpoint}
                          onChange={(event) =>
                            setQuickS3((current) => ({ ...current, endpoint: event.target.value }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="s3-bucket">Bucket</Label>
                        <Input
                          id="s3-bucket"
                          placeholder="my-bucket"
                          value={quickS3.bucket}
                          onChange={(event) =>
                            setQuickS3((current) => ({ ...current, bucket: event.target.value }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="s3-region">Region</Label>
                        <Input
                          id="s3-region"
                          placeholder="us-east-1"
                          value={quickS3.region}
                          onChange={(event) =>
                            setQuickS3((current) => ({ ...current, region: event.target.value }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor="s3-prefix">Prefix</Label>
                        <Input
                          id="s3-prefix"
                          placeholder="backups/prod"
                          value={quickS3.prefix}
                          onChange={(event) =>
                            setQuickS3((current) => ({ ...current, prefix: event.target.value }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                      </div>
                    </div>

                    <Separator />

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor="s3-access-key">Access Key ID</Label>
                        <Input
                          id="s3-access-key"
                          type="password"
                          autoComplete="off"
                          value={quickS3.accessKeyId}
                          onChange={(event) =>
                            setQuickS3((current) => ({
                              ...current,
                              accessKeyId: event.target.value,
                            }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="s3-secret-key">Secret Access Key</Label>
                        <Input
                          id="s3-secret-key"
                          type="password"
                          autoComplete="off"
                          value={quickS3.secretAccessKey}
                          onChange={(event) =>
                            setQuickS3((current) => ({
                              ...current,
                              secretAccessKey: event.target.value,
                            }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor="s3-session-token">Session Token</Label>
                        <Input
                          id="s3-session-token"
                          type="password"
                          autoComplete="off"
                          value={quickS3.sessionToken}
                          onChange={(event) =>
                            setQuickS3((current) => ({
                              ...current,
                              sessionToken: event.target.value,
                            }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="s3-profile">AWS Profile</Label>
                        <Input
                          id="s3-profile"
                          placeholder="default"
                          value={quickS3.profile}
                          onChange={(event) =>
                            setQuickS3((current) => ({ ...current, profile: event.target.value }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                      </div>
                    </div>

                    <Separator />

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor="s3-storage-class">Storage Class</Label>
                        <Input
                          id="s3-storage-class"
                          placeholder="STANDARD"
                          value={quickS3.storageClass}
                          onChange={(event) =>
                            setQuickS3((current) => ({
                              ...current,
                              storageClass: event.target.value,
                            }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="s3-acl">ACL</Label>
                        <Input
                          id="s3-acl"
                          placeholder="private"
                          value={quickS3.acl}
                          onChange={(event) =>
                            setQuickS3((current) => ({ ...current, acl: event.target.value }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      <Label>
                        <Checkbox
                          checked={quickS3.pathStyle}
                          onCheckedChange={(checked) =>
                            setQuickS3((current) => ({
                              ...current,
                              pathStyle: checked === true,
                            }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                        Path style
                      </Label>
                      <Label>
                        <Checkbox
                          checked={quickS3.disableTls}
                          onCheckedChange={(checked) =>
                            setQuickS3((current) => ({
                              ...current,
                              disableTls: checked === true,
                            }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                        Disable TLS
                      </Label>
                      <Label>
                        <Checkbox
                          checked={quickS3.noVerifySsl}
                          onCheckedChange={(checked) =>
                            setQuickS3((current) => ({
                              ...current,
                              noVerifySsl: checked === true,
                            }))
                          }
                          disabled={isSavingRepoSetup}
                        />
                        Skip SSL verify
                      </Label>
                    </div>

                    <p className="rounded bg-muted px-2 py-1 text-[11px] font-mono text-muted-foreground">
                      {quickS3Preview}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label htmlFor="repo-path">Repository path</Label>
                    <Input
                      id="repo-path"
                      placeholder="/path/to/repo"
                      value={quickRepositoryPath}
                      onChange={(event) => setQuickRepositoryPath(event.target.value)}
                      disabled={isSavingRepoSetup}
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <Label htmlFor="repo-password">Password (optional)</Label>
                  <Input
                    id="repo-password"
                    type="password"
                    autoComplete="off"
                    value={quickRepositoryPassword}
                    onChange={(event) => setQuickRepositoryPassword(event.target.value)}
                    disabled={isSavingRepoSetup}
                  />
                </div>

                <Button
                  className="h-8 gap-1 text-xs"
                  disabled={isSavingRepoSetup || !quickRepositoryName.trim()}
                  onClick={() => void createAndAttachRepository()}
                >
                  <RiAddLine className="size-3.5" />
                  Create + Attach
                </Button>
              </div>
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

export default function WorkersPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Worker Fleet</h1>
          <p className="text-sm text-muted-foreground">Loading workers...</p>
        </div>
      }
    >
      <WorkersPageContent />
    </Suspense>
  );
}
