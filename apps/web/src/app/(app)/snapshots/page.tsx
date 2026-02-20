"use client";

import { apiBaseUrl } from "@/lib/api-base-url";
import {
  RiArrowRightSLine,
  RiDownloadCloud2Line,
  RiLoader4Line,
  RiTeamLine,
  RiTimerLine,
} from "@remixicon/react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTableFilter,
  useDataTableFilters,
  type FiltersState,
} from "@/components/data-table-filter";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiFetchJson } from "@/lib/api-fetch";
import { authClient } from "@/lib/auth-client";
import { parseAsBoolean, parseAsString, useQueryState } from "nuqs";
import { Spinner } from "@/components/ui/spinner";

import {
  API_BASE,
  type WorkerRecord,
  type RepositoryRecord,
  type SnapshotRecord,
  type SnapshotWorkerAttribution,
  type SnapshotListItem,
  type SnapshotActivity,
  type SnapshotWsMessage,
  type FileEntry,
  type FileTreeNode,
  numberToSize,
  parseMaybeJsonFromStdout,
  extractSnapshots,
  extractFileEntries,
  formatSnapshotMeta,
  formatDurationMs,
  formatTimeUntil,
  normalizeSnapshotKey,
  parseTimestampMs,
  getSnapshotFileLoadHint,
  sanitizeWorkerErrorMessage,
  buildSnapshotStreamWebSocketUrl,
  monthKey,
  dayKey,
} from "./_components/snapshot-helpers";
import { SnapshotDetailPanel, SnapshotActivityDetailPanel } from "./_components/snapshot-panels";

// ─── Main Page ───────────────────────────────────────────────────────────────

function SnapshotsPageContent() {
  const { data: session } = authClient.useSession();
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [selectedRepositoryId, setSelectedRepositoryId] = useQueryState(
    "selectedRepositoryId",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSnapshotsLoading, setIsSnapshotsLoading] = useState(false);
  const [isAttributionLoading, setIsAttributionLoading] = useState(false);
  const [isActivityLoading, setIsActivityLoading] = useState(false);
  const [isTriggeringBackup, setIsTriggeringBackup] = useState(false);
  const [snapshotWorkerFilterId, setSnapshotWorkerFilterId] = useQueryState(
    "snapshotWorkerFilterId",
    parseAsString.withDefault("all").withOptions({ history: "replace" }),
  );
  const [backupPathsInput, setBackupPathsInput] = useQueryState(
    "backupPaths",
    parseAsString.withDefault("/home").withOptions({ history: "replace" }),
  );
  const [backupTagsInput, setBackupTagsInput] = useQueryState(
    "backupTags",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [backupDryRun, setBackupDryRun] = useQueryState(
    "backupDryRun",
    parseAsBoolean.withDefault(false).withOptions({ history: "replace" }),
  );
  const [manualWorkerId, setManualWorkerId] = useQueryState(
    "backupWorkerId",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [snapshotAttribution, setSnapshotAttribution] = useState<SnapshotWorkerAttribution[]>([]);
  const [snapshotActivity, setSnapshotActivity] = useState<SnapshotActivity[]>([]);

  const [selectedSnapshotId, setSelectedSnapshotId] = useQueryState(
    "selectedSnapshotId",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [selectedActivityId, setSelectedActivityId] = useQueryState(
    "selectedActivityId",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isFilesLoading, setIsFilesLoading] = useState(false);
  const [fileBrowserHint, setFileBrowserHint] = useState<string | null>(null);
  const [isRunningRepositoryCheck, setIsRunningRepositoryCheck] = useState(false);
  const [isRunningRepositoryRepairIndex, setIsRunningRepositoryRepairIndex] = useState(false);
  const [isDiffingSnapshot, setIsDiffingSnapshot] = useState(false);
  const [diffSummary, setDiffSummary] = useState<{
    added: number;
    removed: number;
    changed: number;
  } | null>(null);
  const [isRestoringSnapshot, setIsRestoringSnapshot] = useState(false);

  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const [openFileNodes, setOpenFileNodes] = useState<Record<string, boolean>>({});
  const realtimeRefreshInFlightRef = useRef(false);
  const selectedRepository =
    repositories.find((repository) => repository.id === selectedRepositoryId) ?? null;
  const selectedManualWorkerName =
    selectedRepository?.backupWorkers.find((worker) => worker.id === manualWorkerId)?.name ?? "";

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadRepositories = useCallback(async () => {
    if (!session?.user) {
      setRepositories([]);
      setSelectedRepositoryId("");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await apiFetchJson<{
        repositories?: RepositoryRecord[];
      }>(`${API_BASE}/rustic/repositories`, {
        method: "GET",
        retries: 1,
      });
      const repositoryList = data.repositories ?? [];
      setRepositories(repositoryList);
      if (repositoryList.length > 0) {
        setSelectedRepositoryId((current) => current || repositoryList[0]!.id);
      }
    } catch {
      toast.error("Could not load repositories for snapshots.");
    } finally {
      setIsLoading(false);
    }
  }, [session?.user]);

  const loadSnapshots = useCallback(
    async (repositoryId: string, options?: { silent?: boolean; preserveSelection?: boolean }) => {
      const silent = options?.silent ?? false;
      const preserveSelection = options?.preserveSelection ?? false;
      if (!repositoryId) {
        setSnapshots([]);
        return;
      }

      if (!silent) {
        setIsSnapshotsLoading(true);
      }
      if (!preserveSelection) {
        setSelectedSnapshotId("");
        setSelectedActivityId("");
        setFiles([]);
        setFileBrowserHint(null);
        setOpenFileNodes({});
      }

      try {
        const data = await apiFetchJson<{
          rustic?: {
            parsedJson?: unknown;
            parsed_json?: unknown;
            stdout?: string;
          };
        }>(`${API_BASE}/rustic/repositories/${repositoryId}/snapshots`, {
          method: "POST",
          retries: 1,
        });
        const parsed =
          data.rustic?.parsedJson ??
          data.rustic?.parsed_json ??
          parseMaybeJsonFromStdout(data.rustic?.stdout);
        const parsedSnapshots = extractSnapshots(parsed);
        setSnapshots(parsedSnapshots);

        if (!preserveSelection && parsedSnapshots.length > 0) {
          setSelectedSnapshotId(parsedSnapshots[0]!.id);
        }
      } catch (error) {
        if (!silent) {
          toast.error(error instanceof Error ? error.message : "Could not load snapshots.");
          setSnapshots([]);
        }
      } finally {
        if (!silent) {
          setIsSnapshotsLoading(false);
        }
      }
    },
    [],
  );

  const loadSnapshotAttribution = useCallback(
    async (repositoryId: string, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!repositoryId) {
        setSnapshotAttribution([]);
        return;
      }

      if (!silent) {
        setIsAttributionLoading(true);
      }
      try {
        const data = await apiFetchJson<{
          snapshots?: SnapshotWorkerAttribution[];
        }>(`${API_BASE}/rustic/repositories/${repositoryId}/snapshot-workers`, {
          method: "GET",
          retries: 1,
        });
        setSnapshotAttribution(data.snapshots ?? []);
      } catch (error) {
        if (!silent) {
          toast.error(
            error instanceof Error ? error.message : "Could not load snapshot worker attribution.",
          );
          setSnapshotAttribution([]);
        }
      } finally {
        if (!silent) {
          setIsAttributionLoading(false);
        }
      }
    },
    [],
  );

  const loadSnapshotActivity = useCallback(
    async (repositoryId: string, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!repositoryId) {
        setSnapshotActivity([]);
        return;
      }

      if (!silent) {
        setIsActivityLoading(true);
      }
      try {
        const data = await apiFetchJson<{
          activities?: SnapshotActivity[];
        }>(`${API_BASE}/rustic/repositories/${repositoryId}/snapshot-activity`, {
          method: "GET",
          retries: 1,
        });
        setSnapshotActivity(data.activities ?? []);
      } catch (error) {
        if (!silent) {
          toast.error(error instanceof Error ? error.message : "Could not load snapshot activity.");
          setSnapshotActivity([]);
        }
      } finally {
        if (!silent) {
          setIsActivityLoading(false);
        }
      }
    },
    [],
  );

  const loadFiles = useCallback(
    async (snapshotId: string, workerId?: string) => {
      const normalizedSnapshotId = typeof snapshotId === "string" ? snapshotId.trim() : "";
      const normalizedWorkerId = typeof workerId === "string" ? workerId.trim() : "";
      const hasValidSnapshotId =
        normalizedSnapshotId.length > 0 &&
        normalizedSnapshotId !== "undefined" &&
        normalizedSnapshotId !== "null";
      const hasValidWorkerId =
        normalizedWorkerId.length > 0 &&
        normalizedWorkerId !== "undefined" &&
        normalizedWorkerId !== "null";

      if (!selectedRepositoryId || !hasValidSnapshotId) {
        setFiles([]);
        setFileBrowserHint(null);
        return;
      }

      setIsFilesLoading(true);
      try {
        setFileBrowserHint(null);
        const data = await apiFetchJson<{
          rustic?: {
            parsedJson?: unknown;
            parsed_json?: unknown;
            stdout?: string;
          };
        }>(`${API_BASE}/rustic/repositories/${selectedRepositoryId}/snapshot/files`, {
          method: "POST",
          body: JSON.stringify({
            snapshot: normalizedSnapshotId,
            ...(hasValidWorkerId ? { workerId: normalizedWorkerId } : {}),
          }),
          retries: 1,
        });

        const parsed =
          data.rustic?.parsedJson ??
          data.rustic?.parsed_json ??
          parseMaybeJsonFromStdout(data.rustic?.stdout);
        setFiles(extractFileEntries(parsed));
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "Could not load file browser.";
        const message = sanitizeWorkerErrorMessage(rawMessage);
        setFileBrowserHint(getSnapshotFileLoadHint(message));
        toast.error(message);
        setFiles([]);
      } finally {
        setIsFilesLoading(false);
      }
    },
    [selectedRepositoryId],
  );

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  useEffect(() => {
    if (!selectedRepositoryId) return;
    void Promise.all([
      loadSnapshots(selectedRepositoryId, { preserveSelection: false }),
      loadSnapshotAttribution(selectedRepositoryId),
      loadSnapshotActivity(selectedRepositoryId),
    ]);
  }, [selectedRepositoryId, loadSnapshots, loadSnapshotAttribution, loadSnapshotActivity]);

  useEffect(() => {
    if (!selectedRepositoryId) return;
    let isDisposed = false;
    let websocket: WebSocket | null = null;
    let fallbackIntervalId: number | null = null;
    let reconnectTimeoutId: number | null = null;
    let previousRunningCount = 0;

    const refreshSilently = (options?: { includeActivity?: boolean }) => {
      const includeActivity = options?.includeActivity ?? true;
      if (isDisposed || document.visibilityState !== "visible") return;
      if (realtimeRefreshInFlightRef.current) return;
      realtimeRefreshInFlightRef.current = true;
      const refreshTasks: Array<Promise<unknown>> = [
        loadSnapshots(selectedRepositoryId, { silent: true, preserveSelection: true }),
        loadSnapshotAttribution(selectedRepositoryId, { silent: true }),
      ];
      if (includeActivity) {
        refreshTasks.push(loadSnapshotActivity(selectedRepositoryId, { silent: true }));
      }
      void Promise.all(refreshTasks).finally(() => {
        realtimeRefreshInFlightRef.current = false;
      });
    };

    const ensureFallbackPolling = () => {
      if (fallbackIntervalId !== null) return;
      fallbackIntervalId = window.setInterval(refreshSilently, 10_000);
    };

    const clearFallbackPolling = () => {
      if (fallbackIntervalId === null) return;
      window.clearInterval(fallbackIntervalId);
      fallbackIntervalId = null;
    };

    const connectWebSocket = () => {
      if (isDisposed) return;

      const wsUrl = buildSnapshotStreamWebSocketUrl(
        selectedRepositoryId,
        apiBaseUrl,
      );
      if (!wsUrl) {
        ensureFallbackPolling();
        return;
      }

      try {
        websocket = new WebSocket(wsUrl);
      } catch {
        ensureFallbackPolling();
        reconnectTimeoutId = window.setTimeout(connectWebSocket, 5_000);
        return;
      }

      websocket.onopen = () => {
        clearFallbackPolling();
        refreshSilently({ includeActivity: false });
      };
      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(String((event as MessageEvent).data ?? "")) as SnapshotWsMessage;
          if (Array.isArray(data.activities)) {
            const nextRunningCount = data.activities.filter(
              (activity) => activity.kind === "running",
            ).length;
            setSnapshotActivity(data.activities);
            if (previousRunningCount > 0 && nextRunningCount === 0) {
              // A run likely finished; refresh snapshots/attribution once.
              refreshSilently({ includeActivity: false });
            }
            previousRunningCount = nextRunningCount;
            return;
          }
        } catch {
          // Fall back to silent refresh if payload is malformed.
        }
        refreshSilently();
      };
      websocket.onerror = () => {
        ensureFallbackPolling();
      };
      websocket.onclose = () => {
        websocket = null;
        if (isDisposed) return;
        ensureFallbackPolling();
        reconnectTimeoutId = window.setTimeout(connectWebSocket, 5_000);
      };
    };

    connectWebSocket();

    const onVisibilityChange = () => refreshSilently();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      isDisposed = true;
      if (websocket) {
        websocket.close();
      }
      if (reconnectTimeoutId !== null) {
        window.clearTimeout(reconnectTimeoutId);
      }
      if (fallbackIntervalId !== null) {
        window.clearInterval(fallbackIntervalId);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedRepositoryId, loadSnapshots, loadSnapshotAttribution, loadSnapshotActivity]);

  useEffect(() => {
    if (!selectedRepository) {
      setManualWorkerId("");
      return;
    }
    const hasSelectedWorker = selectedRepository.backupWorkers.some(
      (worker) => worker.id === manualWorkerId,
    );
    if (!hasSelectedWorker) {
      setManualWorkerId(selectedRepository.backupWorkers[0]?.id ?? "");
    }
  }, [selectedRepository, manualWorkerId]);

  // ── Derived data ───────────────────────────────────────────────────────────

  const snapshotWorkerFilterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const worker of selectedRepository?.backupWorkers ?? []) {
      byId.set(worker.id, worker.name);
    }
    for (const entry of snapshotAttribution) {
      for (const worker of entry.workers) {
        if (!byId.has(worker.id)) {
          byId.set(worker.id, worker.name);
        }
      }
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedRepository, snapshotAttribution]);

  useEffect(() => {
    if (
      snapshotWorkerFilterId !== "all" &&
      !snapshotWorkerFilterOptions.some((worker) => worker.id === snapshotWorkerFilterId)
    ) {
      setSnapshotWorkerFilterId("all");
    }
  }, [snapshotWorkerFilterId, snapshotWorkerFilterOptions, setSnapshotWorkerFilterId]);

  const snapshotWorkerFilterColumnsConfig = useMemo(
    () => [
      {
        id: "worker",
        accessor: (_snapshot: SnapshotRecord) => snapshotWorkerFilterId,
        displayName: "Worker",
        icon: RiTeamLine,
        type: "option" as const,
        options: snapshotWorkerFilterOptions.map((worker) => ({
          label: worker.name,
          value: worker.id,
        })),
      },
    ],
    [snapshotWorkerFilterId, snapshotWorkerFilterOptions],
  );

  const snapshotWorkerFilters = useMemo<FiltersState>(() => {
    if (snapshotWorkerFilterId === "all") return [];
    return [
      {
        columnId: "worker",
        type: "option",
        operator: "is",
        values: [snapshotWorkerFilterId],
      },
    ];
  }, [snapshotWorkerFilterId]);

  const onSnapshotWorkerFiltersChange = useCallback(
    (nextFilters: FiltersState | ((prev: FiltersState) => FiltersState)) => {
      const resolved =
        typeof nextFilters === "function" ? nextFilters(snapshotWorkerFilters) : nextFilters;
      const nextWorkerId = String(
        resolved.find((entry) => entry.columnId === "worker")?.values?.[0] ?? "all",
      );
      void setSnapshotWorkerFilterId(nextWorkerId);
    },
    [setSnapshotWorkerFilterId, snapshotWorkerFilters],
  );

  const {
    actions: snapshotWorkerFilterActions,
    columns: snapshotWorkerFilterColumns,
    filters: activeSnapshotWorkerFilters,
    strategy: snapshotWorkerFilterStrategy,
  } = useDataTableFilters({
    strategy: "server",
    data: [],
    columnsConfig: snapshotWorkerFilterColumnsConfig,
    filters: snapshotWorkerFilters,
    onFiltersChange: onSnapshotWorkerFiltersChange,
  });

  const attributionLookup = useMemo(() => {
    const byFullId = new Map<string, SnapshotWorkerAttribution>();
    const byShortId = new Map<string, SnapshotWorkerAttribution[]>();
    const timed = [] as Array<{ entry: SnapshotWorkerAttribution; timeMs: number }>;

    for (const entry of snapshotAttribution) {
      byFullId.set(normalizeSnapshotKey(entry.snapshotId), entry);
      for (const sourceSnapshotId of entry.sourceSnapshotIds ?? []) {
        byFullId.set(normalizeSnapshotKey(sourceSnapshotId), entry);
      }
      const shortKey = normalizeSnapshotKey(entry.snapshotShortId);
      const current = byShortId.get(shortKey) ?? [];
      current.push(entry);
      byShortId.set(shortKey, current);
      const timeMs = parseTimestampMs(entry.snapshotTime);
      if (Number.isFinite(timeMs)) {
        timed.push({ entry, timeMs });
      }
    }

    return { byFullId, byShortId, timed };
  }, [snapshotAttribution]);

  const resolveAttributionForSnapshot = useCallback(
    (snapshot: SnapshotRecord) => {
      const full = attributionLookup.byFullId.get(normalizeSnapshotKey(snapshot.id));
      if (full) return full;

      const shortMatches =
        attributionLookup.byShortId.get(normalizeSnapshotKey(snapshot.shortId)) ?? [];
      const snapshotMs = parseTimestampMs(snapshot.time);
      const hasSnapshotTime = Number.isFinite(snapshotMs);

      if (shortMatches.length === 1 && !hasSnapshotTime) return shortMatches[0]!;

      if (hasSnapshotTime) {
        const timedCandidates =
          shortMatches.length > 0
            ? shortMatches
                .map((entry) =>
                  Number.isFinite(parseTimestampMs(entry.snapshotTime))
                    ? { entry, timeMs: parseTimestampMs(entry.snapshotTime) }
                    : null,
                )
                .filter(
                  (candidate): candidate is { entry: SnapshotWorkerAttribution; timeMs: number } =>
                    candidate !== null && Number.isFinite(candidate.timeMs),
                )
            : attributionLookup.timed;

        const closestByTime = timedCandidates
          .map((item) => ({
            entry: item.entry,
            diff: Math.abs(snapshotMs - item.timeMs),
          }))
          .sort((a, b) => a.diff - b.diff)[0];

        if (closestByTime && closestByTime.diff <= 120_000) return closestByTime.entry;
      }

      // If ids match but timestamps are unavailable/misaligned, keep best id-based candidate.
      return shortMatches[0] ?? null;
    },
    [attributionLookup],
  );

  const filteredSnapshots = useMemo(() => {
    if (snapshotWorkerFilterId === "all") return snapshots;
    return snapshots.filter((snapshot) => {
      const attribution = resolveAttributionForSnapshot(snapshot);
      return attribution ? attribution.workerIds.includes(snapshotWorkerFilterId) : false;
    });
  }, [snapshots, snapshotWorkerFilterId, resolveAttributionForSnapshot]);

  const displaySnapshots = useMemo<SnapshotRecord[]>(() => {
    return filteredSnapshots.slice().sort((a, b) => {
      const aMs = a.time ? new Date(a.time).getTime() : 0;
      const bMs = b.time ? new Date(b.time).getTime() : 0;
      return bMs - aMs;
    });
  }, [filteredSnapshots]);

  const snapshotListItems = useMemo<SnapshotListItem[]>(() => {
    const fromSnapshots: SnapshotListItem[] = displaySnapshots.map((snapshot) => {
      const attribution = resolveAttributionForSnapshot(snapshot);
      const workerSummary =
        attribution && attribution.workers.length > 0
          ? attribution.workers.map((worker) => worker.name).join(", ")
          : null;
      return {
        kind: "snapshot",
        id: snapshot.id,
        time: snapshot.time,
        label: snapshot.label,
        workerSummary,
        meta: formatSnapshotMeta(snapshot),
        snapshot,
      };
    });

    const fromActivity: SnapshotListItem[] = snapshotActivity.map((activity) => ({
      kind: activity.kind,
      id: `activity:${activity.id}`,
      time: activity.startedAt ?? activity.nextRunAt ?? null,
      label: `${activity.planName ?? "Plan"} — ${activity.kind === "running" ? "In Progress" : "Pending"}`,
      workerSummary: activity.workerName ?? null,
      meta:
        activity.kind === "running"
          ? activity.progressPercent !== null
            ? `${Math.round(Math.max(0, Math.min(100, activity.progressPercent)))}%`
            : "Starting..."
          : `ETA ${activity.nextRunAt ? formatTimeUntil(activity.nextRunAt) : "—"}`,
      activity,
    }));

    return [...fromActivity, ...fromSnapshots].sort((a, b) => {
      const aMs = a.time ? new Date(a.time).getTime() : 0;
      const bMs = b.time ? new Date(b.time).getTime() : 0;
      return bMs - aMs;
    });
  }, [displaySnapshots, resolveAttributionForSnapshot, snapshotActivity]);

  useEffect(() => {
    if (
      selectedSnapshotId &&
      !displaySnapshots.some((snapshot) => snapshot.id === selectedSnapshotId)
    ) {
      setSelectedSnapshotId("");
    }
  }, [displaySnapshots, selectedSnapshotId]);

  useEffect(() => {
    if (
      selectedActivityId &&
      !snapshotActivity.some((activity) => `activity:${activity.id}` === selectedActivityId)
    ) {
      setSelectedActivityId("");
    }
  }, [snapshotActivity, selectedActivityId]);

  useEffect(() => {
    if (!selectedSnapshotId && !selectedActivityId && snapshotListItems.length > 0) {
      const first = snapshotListItems[0]!;
      if (first.kind === "snapshot") {
        setSelectedSnapshotId(first.id);
      } else {
        setSelectedActivityId(first.id);
      }
    }
  }, [selectedActivityId, selectedSnapshotId, snapshotListItems]);

  const treeData = useMemo(() => {
    const monthMap = new Map<string, Map<string, SnapshotListItem[]>>();

    for (const item of snapshotListItems) {
      const date = item.time ? new Date(item.time) : new Date(0);
      const month = monthKey(date);
      const day = dayKey(date);
      if (!monthMap.has(month)) monthMap.set(month, new Map());
      const dayMap = monthMap.get(month)!;
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day)!.push(item);
    }

    return Array.from(monthMap.entries()).map(([month, dayMap]) => ({
      month,
      days: Array.from(dayMap.entries()).map(([day, dayItems]) => ({
        day,
        items: dayItems,
      })),
    }));
  }, [snapshotListItems]);

  const selectedSnapshot =
    displaySnapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? null;
  const previousSnapshot = useMemo(() => {
    if (!selectedSnapshot) return null;
    const selectedIndex = displaySnapshots.findIndex(
      (snapshot) => snapshot.id === selectedSnapshot.id,
    );
    if (selectedIndex < 0) return null;
    return displaySnapshots[selectedIndex + 1] ?? null;
  }, [displaySnapshots, selectedSnapshot]);
  const selectedActivity =
    snapshotActivity.find((activity) => `activity:${activity.id}` === selectedActivityId) ?? null;
  const selectedSnapshotAttribution = useMemo(() => {
    if (!selectedSnapshot) return null;
    const direct = attributionLookup.byFullId.get(normalizeSnapshotKey(selectedSnapshot.id));
    return direct ?? resolveAttributionForSnapshot(selectedSnapshot);
  }, [attributionLookup, resolveAttributionForSnapshot, selectedSnapshot]);
  const selectedSnapshotWorkerId =
    selectedSnapshotAttribution?.workerIds.find((workerId) => workerId.trim().length > 0) ?? "";

  useEffect(() => {
    if (!selectedSnapshot?.id?.trim()) return;
    void loadFiles(selectedSnapshot.id, selectedSnapshotWorkerId || undefined);
  }, [selectedSnapshot, selectedSnapshotWorkerId, loadFiles]);

  useEffect(() => {
    setDiffSummary(null);
  }, [selectedSnapshotId, selectedRepositoryId]);

  const fileTree = useMemo<FileTreeNode[]>(() => {
    // Use a persistent lookup map keyed by full path so children accumulate correctly
    const nodeByPath = new Map<string, FileTreeNode>();

    // Ensure a node exists at every segment of the given path
    function ensurePath(segments: string[], kind: "file" | "dir", sizeLabel: string) {
      for (let i = 0; i < segments.length; i++) {
        const fullPath = segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;

        if (!nodeByPath.has(fullPath)) {
          nodeByPath.set(fullPath, {
            name: segments[i]!,
            path: fullPath,
            kind: isLast ? kind : "dir",
            sizeLabel: isLast ? sizeLabel : "",
            children: [],
          });
        } else if (isLast) {
          // Update kind/size if we see the actual entry
          const existing = nodeByPath.get(fullPath)!;
          existing.kind = kind;
          if (sizeLabel) existing.sizeLabel = sizeLabel;
        } else {
          // Intermediate segment must be a dir
          nodeByPath.get(fullPath)!.kind = "dir";
        }

        // Link to parent
        if (i > 0) {
          const parentPath = segments.slice(0, i).join("/");
          const parent = nodeByPath.get(parentPath)!;
          const child = nodeByPath.get(fullPath)!;
          if (!parent.children.includes(child)) {
            parent.children.push(child);
          }
        }
      }
    }

    for (const entry of files) {
      const cleanPath = entry.path.trim().replace(/^\/+|\/+$/g, "");
      if (!cleanPath) continue;
      const segments = cleanPath.split("/").filter(Boolean);
      ensurePath(segments, entry.kind, entry.sizeLabel);
    }

    // Root nodes are those whose path has no "/" (single segment)
    const roots = Array.from(nodeByPath.values()).filter((node) => !node.path.includes("/"));

    const sortTree = (nodes: FileTreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const node of nodes) {
        sortTree(node.children);
      }
      return nodes;
    };

    return sortTree(roots);
  }, [files]);

  const runRepositoryCheck = useCallback(async () => {
    if (!selectedRepositoryId) {
      toast.error("Select a repository first.");
      return;
    }

    setIsRunningRepositoryCheck(true);
    try {
      await apiFetchJson(`${API_BASE}/rustic/repositories/${selectedRepositoryId}/check`, {
        method: "POST",
        body: JSON.stringify({
          workerId: selectedSnapshotWorkerId || undefined,
        }),
        retries: 1,
      });

      toast.success("Repository check completed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not run repository check.");
    } finally {
      setIsRunningRepositoryCheck(false);
    }
  }, [selectedRepositoryId, selectedSnapshotWorkerId]);

  const runRepositoryRepairIndex = useCallback(async () => {
    if (!selectedRepositoryId) {
      toast.error("Select a repository first.");
      return;
    }

    setIsRunningRepositoryRepairIndex(true);
    try {
      await apiFetchJson(`${API_BASE}/rustic/repositories/${selectedRepositoryId}/repair-index`, {
        method: "POST",
        body: JSON.stringify({
          workerId: selectedSnapshotWorkerId || undefined,
        }),
        retries: 1,
      });

      toast.success("Repository index repair completed.");
      if (selectedSnapshotId) {
        void loadFiles(selectedSnapshotId, selectedSnapshotWorkerId || undefined);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not repair repository index.");
    } finally {
      setIsRunningRepositoryRepairIndex(false);
    }
  }, [loadFiles, selectedRepositoryId, selectedSnapshotId, selectedSnapshotWorkerId]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function runSnapshotDiffWithPrevious() {
    if (!selectedRepositoryId || !selectedSnapshot || !previousSnapshot) {
      toast.error("Need two snapshots to diff.");
      return;
    }

    setIsDiffingSnapshot(true);
    try {
      const result = await apiFetchJson<{
        summary: { added: number; removed: number; changed: number };
      }>(`${API_BASE}/rustic/repositories/${selectedRepositoryId}/snapshot/diff`, {
        method: "POST",
        body: JSON.stringify({
          fromSnapshot: previousSnapshot.id,
          toSnapshot: selectedSnapshot.id,
          workerId: selectedSnapshotWorkerId || undefined,
        }),
        retries: 1,
      });
      setDiffSummary(result.summary);
      toast.success("Snapshot diff completed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not diff snapshots.");
    } finally {
      setIsDiffingSnapshot(false);
    }
  }

  async function restoreSelectedSnapshot(target: string) {
    if (!selectedRepositoryId || !selectedSnapshot) {
      toast.error("Select a snapshot first.");
      return;
    }
    if (!target.trim()) {
      toast.error("Restore target is required.");
      return;
    }

    setIsRestoringSnapshot(true);
    try {
      await apiFetchJson(`${API_BASE}/rustic/repositories/${selectedRepositoryId}/restore`, {
        method: "POST",
        body: JSON.stringify({
          snapshot: selectedSnapshot.id,
          target,
          workerId: selectedSnapshotWorkerId || undefined,
        }),
        retries: 1,
      });
      toast.success("Restore completed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restore snapshot.");
    } finally {
      setIsRestoringSnapshot(false);
    }
  }

  const fetchDirs = useCallback(
    async (path: string): Promise<string[]> => {
      if (!selectedRepositoryId) return [];
      try {
        const data = await apiFetchJson<{ dirs?: string[] }>(
          `${API_BASE}/rustic/repositories/${selectedRepositoryId}/ls-dirs`,
          {
            method: "POST",
            body: JSON.stringify({
              path,
              workerId: selectedSnapshotWorkerId || undefined,
            }),
            retries: 0,
          },
        );
        return data.dirs ?? [];
      } catch {
        return [];
      }
    },
    [selectedRepositoryId, selectedSnapshotWorkerId],
  );

  async function triggerBackupNow() {
    if (!selectedRepositoryId) {
      toast.error("Select a repository first.");
      return;
    }

    const paths = backupPathsInput
      .split("\n")
      .map((path) => path.trim())
      .filter(Boolean);
    const tags = backupTagsInput
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (paths.length === 0) {
      toast.error("Add at least one backup path.");
      return;
    }
    if (!manualWorkerId) {
      toast.error("Select a backup worker.");
      return;
    }

    setIsTriggeringBackup(true);
    try {
      await apiFetchJson(`${API_BASE}/rustic/repositories/${selectedRepositoryId}/backup`, {
        method: "POST",
        body: JSON.stringify({
          workerId: manualWorkerId,
          paths,
          tags,
          dryRun: backupDryRun,
        }),
        retries: 1,
      });

      toast.success(backupDryRun ? "Dry-run snapshot started." : "Snapshot started.");
      await Promise.all([
        loadSnapshots(selectedRepositoryId),
        loadSnapshotAttribution(selectedRepositoryId),
        loadSnapshotActivity(selectedRepositoryId),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not trigger snapshot.");
    } finally {
      setIsTriggeringBackup(false);
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderSnapshotRow(item: SnapshotListItem) {
    const isSelected =
      item.kind === "snapshot" ? item.id === selectedSnapshotId : item.id === selectedActivityId;
    return (
      <button
        key={item.id}
        type="button"
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
          isSelected
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        }`}
        onClick={() => {
          if (item.kind === "snapshot") {
            setSelectedSnapshotId(item.id);
            setSelectedActivityId("");
            setOpenFileNodes({});
          } else {
            setSelectedActivityId(item.id);
            setSelectedSnapshotId("");
          }
        }}
      >
        {item.kind === "snapshot" ? (
          <RiDownloadCloud2Line className="size-3.5 shrink-0 text-emerald-500" />
        ) : item.kind === "running" ? (
          <RiLoader4Line className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <RiTimerLine className="size-3.5 shrink-0 text-amber-500" />
        )}
        <span className="truncate">{item.label}</span>
        {item.workerSummary ? (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            {item.workerSummary}
          </Badge>
        ) : null}
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">[{item.meta}]</span>
      </button>
    );
  }

  // ── Main layout ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recovery Points</h1>
        <p className="text-sm text-muted-foreground">Browse and manage recovery points.</p>
      </div>

      {/* Repository selector + backup trigger */}
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <Label className="mb-1.5 text-xs">Repository</Label>
              <Select
                value={selectedRepositoryId}
                onValueChange={(value) => setSelectedRepositoryId(value ?? "")}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue
                    placeholder={isLoading ? "Loading repositories..." : "Choose repository"}
                  />
                </SelectTrigger>
                <SelectPopup>
                  {repositories.map((repository) => (
                    <SelectItem key={repository.id} value={repository.id}>
                      {repository.name} ({repository.backend})
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Assigned workers:{" "}
                {selectedRepository?.backupWorkers.length
                  ? selectedRepository.backupWorkers.map((worker) => worker.name).join(", ")
                  : "None"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Last snapshot:{" "}
                {displaySnapshots[0]?.time
                  ? new Intl.DateTimeFormat(undefined, {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(displaySnapshots[0].time))
                  : "—"}{" "}
                • Count: {displaySnapshots.length}
              </p>
            </div>
          </div>
        </div>

        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            <RiArrowRightSLine className="size-3 transition-transform [[data-state=open]>&]:rotate-90" />
            Trigger Snapshot
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid gap-3 border-t px-4 py-3 lg:grid-cols-[2fr_1fr]">
              <div className="space-y-1.5">
                <Label className="text-xs">Snapshot paths (one per line)</Label>
                <Textarea
                  className="min-h-20 font-mono text-xs"
                  value={backupPathsInput}
                  onChange={(event) => setBackupPathsInput(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Run on worker</Label>
                <Select
                  value={manualWorkerId}
                  onValueChange={(value) => setManualWorkerId(value ?? "")}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Choose worker">
                      {selectedManualWorkerName || "Choose worker"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {(selectedRepository?.backupWorkers ?? []).map((worker) => (
                      <SelectItem key={worker.id} value={worker.id}>
                        {worker.name} ({worker.status})
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Label className="text-xs">Tags (comma-separated)</Label>
                <Input
                  className="h-8 text-xs"
                  value={backupTagsInput}
                  onChange={(event) => setBackupTagsInput(event.target.value)}
                  placeholder="manual, on-demand"
                />
                <div className="flex items-center justify-between rounded border px-2 py-1">
                  <span className="text-[11px] text-muted-foreground">Dry run</span>
                  <Switch
                    checked={backupDryRun}
                    onCheckedChange={(checked) => {
                      void setBackupDryRun(checked);
                    }}
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => void triggerBackupNow()}
                  disabled={!selectedRepositoryId || !manualWorkerId || isTriggeringBackup}
                >
                  {isTriggeringBackup ? (
                    <>
                      <RiLoader4Line className="mr-1.5 size-3 animate-spin" />
                      Running...
                    </>
                  ) : (
                    "Create Snapshot Now"
                  )}
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <div className="rounded-lg border bg-card px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Snapshot Activity</h2>
          {isActivityLoading ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <RiLoader4Line className="size-3 animate-spin" />
              Refreshing
            </span>
          ) : null}
        </div>
        {snapshotActivity.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No pending or in-progress plan runs for this repository.
          </p>
        ) : (
          <div className="space-y-2">
            {snapshotActivity.map((activity) => {
              const progress = Math.max(0, Math.min(100, activity.progressPercent ?? 0));
              return (
                <div key={activity.id} className="rounded border p-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant={activity.kind === "running" ? "default" : "outline"}>
                      {activity.kind === "running" ? "In Progress" : "Pending"}
                    </Badge>
                    <span className="font-medium">{activity.planName ?? "Plan"}</span>
                    {activity.workerName ? (
                      <span className="text-muted-foreground">• {activity.workerName}</span>
                    ) : null}
                    <span className="ml-auto text-muted-foreground">
                      {activity.kind === "running"
                        ? `elapsed ${formatDurationMs(activity.elapsedMs)}`
                        : `runs in ${formatTimeUntil(activity.nextRunAt)}`}
                    </span>
                  </div>
                  {activity.kind === "running" ? (
                    <div className="mt-2">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {progress > 0 ? `${progress}%` : "Estimating progress..."}
                      </div>
                      {(activity.phase || activity.currentPath) && (
                        <div className="mt-1 truncate text-[11px] text-muted-foreground">
                          {[activity.phase, activity.currentPath].filter(Boolean).join(" - ")}
                        </div>
                      )}
                      {(activity.filesDone !== null || activity.bytesDone !== null) && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {activity.filesDone !== null && activity.filesTotal !== null
                            ? `${activity.filesDone.toLocaleString()}/${activity.filesTotal.toLocaleString()} files`
                            : null}
                          {activity.bytesDone !== null && activity.bytesTotal !== null
                            ? ` · ${numberToSize(activity.bytesDone)} / ${numberToSize(activity.bytesTotal)}`
                            : null}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Next run:{" "}
                      {activity.nextRunAt ? new Date(activity.nextRunAt).toLocaleString() : "—"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Split-panel explorer */}
      <div
        className="flex items-stretch overflow-hidden rounded-lg border bg-card"
        style={{ height: "calc(100vh - 300px)", minHeight: "500px" }}
      >
        {/* ── Left panel: snapshot tree ── */}
        <div className="flex h-full w-130 shrink-0 flex-col border-r">
          {/* Filter */}
          <div className="border-b px-3 py-3">
            <DataTableFilter
              columns={snapshotWorkerFilterColumns}
              filters={activeSnapshotWorkerFilters}
              actions={snapshotWorkerFilterActions}
              strategy={snapshotWorkerFilterStrategy}
            />
          </div>

          {/* Snapshot list */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {isAttributionLoading ? (
              <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
                <RiLoader4Line className="size-3 animate-spin" />
                Loading snapshot worker attribution...
              </div>
            ) : null}
            {isSnapshotsLoading ? (
              <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                <Spinner />
                Loading recovery points...
              </div>
            ) : snapshotListItems.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No recovery points yet. Trigger Snapshot to create the first recovery point.
              </p>
            ) : (
              <div className="space-y-1">
                {treeData.map((monthNode) => {
                  const monthOpen = openMonths[monthNode.month] ?? true;
                  const totalItems = monthNode.days.reduce((sum, d) => sum + d.items.length, 0);
                  return (
                    <div key={monthNode.month}>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium hover:bg-muted/50"
                        onClick={() =>
                          setOpenMonths((current) => ({
                            ...current,
                            [monthNode.month]: !monthOpen,
                          }))
                        }
                      >
                        <RiArrowRightSLine
                          className={`size-3 transition-transform ${monthOpen ? "rotate-90" : ""}`}
                        />
                        {monthNode.month}
                        <span className="text-[10px] font-normal text-muted-foreground">
                          {totalItems} items
                        </span>
                      </button>

                      {monthOpen && (
                        <div className="ml-3 mt-0.5 space-y-0.5">
                          {monthNode.days.map((dayNode) => {
                            const dayOpen = openDays[dayNode.day] ?? true;
                            return (
                              <div key={dayNode.day}>
                                <button
                                  type="button"
                                  className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs hover:bg-muted/50"
                                  onClick={() =>
                                    setOpenDays((current) => ({
                                      ...current,
                                      [dayNode.day]: !dayOpen,
                                    }))
                                  }
                                >
                                  <RiArrowRightSLine
                                    className={`size-3 transition-transform ${dayOpen ? "rotate-90" : ""}`}
                                  />
                                  {dayNode.day}
                                  <span className="text-[10px] text-muted-foreground">
                                    {dayNode.items.length} items
                                  </span>
                                </button>
                                {dayOpen && (
                                  <div className="ml-4 mt-0.5 space-y-0.5">
                                    {dayNode.items.map((item) => renderSnapshotRow(item))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel: snapshot details ── */}
        <div className="flex h-full flex-1 flex-col">
          {selectedSnapshot ? (
            <SnapshotDetailPanel
              snapshot={selectedSnapshot}
              workers={
                selectedSnapshotAttribution && selectedSnapshotAttribution.workers.length > 0
                  ? selectedSnapshotAttribution.workers
                  : (selectedRepository?.backupWorkers ?? [])
              }
              runSummary={
                selectedSnapshotAttribution && selectedSnapshotAttribution.runCount > 0
                  ? {
                      runCount: selectedSnapshotAttribution.runCount,
                      successCount: selectedSnapshotAttribution.successCount,
                      failureCount: selectedSnapshotAttribution.failureCount,
                    }
                  : null
              }
              fileTree={fileTree}
              isFilesLoading={isFilesLoading}
              fileBrowserHint={fileBrowserHint}
              isRunningRepositoryCheck={isRunningRepositoryCheck}
              isRunningRepositoryRepairIndex={isRunningRepositoryRepairIndex}
              onRunRepositoryCheck={runRepositoryCheck}
              onRunRepositoryRepairIndex={runRepositoryRepairIndex}
              openFileNodes={openFileNodes}
              setOpenFileNodes={setOpenFileNodes}
              diffSummary={diffSummary}
              isDiffing={isDiffingSnapshot}
              onDiffWithPrevious={previousSnapshot ? runSnapshotDiffWithPrevious : undefined}
              onRestore={restoreSelectedSnapshot}
              isRestoring={isRestoringSnapshot}
              onFetchDirs={fetchDirs}
              onForget={async (snapshotId) => {
                if (!selectedRepositoryId) return;
                try {
                  await apiFetchJson(
                    `${API_BASE}/rustic/repositories/${selectedRepositoryId}/forget-snapshot`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        snapshotId,
                        workerId: selectedSnapshotWorkerId || undefined,
                      }),
                      retries: 1,
                    },
                  );
                  toast.success(`Snapshot ${snapshotId.slice(0, 8)} forgotten.`);
                  void loadSnapshots(selectedRepositoryId);
                  void loadSnapshotAttribution(selectedRepositoryId);
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Could not forget snapshot.",
                  );
                }
              }}
            />
          ) : selectedActivity ? (
            <SnapshotActivityDetailPanel activity={selectedActivity} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a snapshot or pending item to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SnapshotsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Recovery Points</h1>
          <p className="text-sm text-muted-foreground">Loading recovery points...</p>
        </div>
      }
    >
      <SnapshotsPageContent />
    </Suspense>
  );
}
