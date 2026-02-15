"use client";

import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Circle,
  File,
  FileText,
  Folder,
  FolderOpen,
  HardDriveDownload,
  Loader2,
  Shield,
  Timer,
  Trash2,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { env } from "@glare/env/web";
import {
  parseAsBoolean,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
} from "nuqs";

const API_BASE = "/api";

// ─── Types ───────────────────────────────────────────────────────────────────

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
  primaryWorker: WorkerRecord | null;
  backupWorkers: WorkerRecord[];
};

type SnapshotRecord = {
  id: string;
  originalId?: string;
  parentId?: string;
  treeId?: string;
  programVersion?: string;
  time: string | null;
  shortId: string;
  label: string;
  paths: string[];
  sizeLabel: string;
  durationLabel: string;
  hostname?: string;
  username?: string;
  tags?: string[];
  filesNew?: number;
  filesChanged?: number;
  filesUnmodified?: number;
  totalBytesProcessed?: string;
  totalFilesProcessed?: number;
  totalDirsProcessed?: number;
  dataBlobsAdded?: string;
  treeBlobs?: number;
};

type SnapshotWorkerAttribution = {
  snapshotId: string;
  snapshotShortId: string;
  snapshotTime: string | null;
  runGroupIds: string[];
  workerIds: string[];
  workers: WorkerRecord[];
  runCount: number;
  successCount: number;
  failureCount: number;
  lastRunAt: string | null;
};

type DisplaySnapshot = SnapshotRecord & {
  sourceSnapshotIds: string[];
  mergedWorkers: WorkerRecord[];
  mergedRunCount: number;
  mergedSuccessCount: number;
  mergedFailureCount: number;
};

type SnapshotListItem =
  | {
      kind: "snapshot";
      id: string;
      time: string | null;
      label: string;
      workerSummary: string | null;
      meta: string;
      snapshot: DisplaySnapshot;
    }
  | {
      kind: "running" | "pending";
      id: string;
      time: string | null;
      label: string;
      workerSummary: string | null;
      meta: string;
      activity: SnapshotActivity;
    };

type SnapshotActivity = {
  id: string;
  kind: "running" | "pending";
  status: "running" | "pending";
  planId: string | null;
  planName: string | null;
  workerId: string | null;
  workerName: string | null;
  startedAt: string | null;
  nextRunAt: string | null;
  elapsedMs: number | null;
  estimatedTotalMs: number | null;
  progressPercent: number | null;
  phase: string | null;
  currentPath: string | null;
  filesDone: number | null;
  filesTotal: number | null;
  bytesDone: number | null;
  bytesTotal: number | null;
  lastEventAt: string | null;
  message: string;
};

type SnapshotWsMessage = {
  event?: "ready" | "tick";
  ts?: number;
  repositoryId?: string;
  activities?: SnapshotActivity[];
};

type FileEntry = {
  name: string;
  path: string;
  kind: "file" | "dir";
  sizeLabel: string;
};

type FileTreeNode = {
  name: string;
  path: string;
  kind: "file" | "dir";
  sizeLabel: string;
  children: FileTreeNode[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseMaybeJsonFromStdout(stdout: string | undefined) {
  if (!stdout) return null;
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter((line): line is unknown => line !== null);
    return lines.length > 0 ? lines : null;
  }
}

function numberToSize(value: unknown) {
  const size =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(size) || size <= 0) return "";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let current = size;
  let idx = 0;
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024;
    idx += 1;
  }
  return `${current.toFixed(current >= 10 ? 1 : 2)} ${units[idx]}`;
}

function numberToDuration(value: unknown) {
  const sec =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(sec) || sec <= 0) return "";
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

function extractSnapshots(raw: unknown): SnapshotRecord[] {
  const rootCandidates = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? (Object.values(raw as Record<string, unknown>).find(Array.isArray) ?? [])
      : [];
  if (!Array.isArray(rootCandidates)) return [];

  const candidates = rootCandidates.flatMap((item) => {
    if (
      item &&
      typeof item === "object" &&
      "snapshots" in item &&
      Array.isArray((item as { snapshots?: unknown }).snapshots)
    ) {
      return (item as { snapshots: unknown[] }).snapshots;
    }
    return [item];
  });

  return candidates
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const summary =
        record.summary && typeof record.summary === "object"
          ? (record.summary as Record<string, unknown>)
          : null;
      const id =
        (typeof record.id === "string" && record.id) ||
        (typeof record.short_id === "string" && record.short_id) ||
        (typeof record.snapshot_id === "string" && record.snapshot_id) ||
        "";
      if (!id) return null;

      const time =
        (typeof record.time === "string" && record.time) ||
        (typeof record.timestamp === "string" && record.timestamp) ||
        (typeof record.datetime === "string" && record.datetime) ||
        null;
      const shortId = id.slice(0, 8);
      const paths = Array.isArray(record.paths)
        ? record.paths.filter((path): path is string => typeof path === "string")
        : [];
      const sizeLabel = numberToSize(
        record.total_size ??
          record.size ??
          record.bytes ??
          summary?.total_bytes_processed ??
          summary?.data_added_files ??
          summary?.data_added,
      );
      const durationLabel = numberToDuration(
        record.duration ??
          record.duration_seconds ??
          record.seconds ??
          summary?.backup_duration ??
          summary?.total_duration,
      );
      const label = time
        ? `Backup ${new Date(time).toLocaleString()}`
        : `Backup ${shortId}`;

      const tags = Array.isArray(record.tags)
        ? record.tags.filter((t): t is string => typeof t === "string")
        : undefined;
      const hostname =
        typeof record.hostname === "string" ? record.hostname : undefined;
      const username =
        typeof record.username === "string" ? record.username : undefined;

      const filesNew =
        typeof summary?.files_new === "number"
          ? summary.files_new
          : typeof record.files_new === "number"
            ? record.files_new
            : undefined;
      const filesChanged =
        typeof summary?.files_changed === "number"
          ? summary.files_changed
          : typeof record.files_changed === "number"
            ? record.files_changed
            : undefined;
      const filesUnmodified =
        typeof summary?.files_unmodified === "number"
          ? summary.files_unmodified
          : typeof record.files_unmodified === "number"
            ? record.files_unmodified
            : undefined;
      const totalBytesProcessed = numberToSize(
        summary?.total_bytes_processed ?? record.total_bytes_processed,
      );
      const totalFilesProcessed =
        typeof summary?.total_files_processed === "number"
          ? summary.total_files_processed
          : typeof record.total_files_processed === "number"
            ? record.total_files_processed
            : undefined;
      const totalDirsProcessed =
        typeof summary?.total_dirs_processed === "number"
          ? summary.total_dirs_processed
          : typeof record.total_dirs_processed === "number"
            ? record.total_dirs_processed
            : undefined;
      const dataBlobsAdded = numberToSize(
        summary?.data_added ?? record.data_added,
      );
      const treeBlobs =
        typeof summary?.tree_blobs === "number"
          ? summary.tree_blobs
          : typeof record.tree_blobs === "number"
            ? record.tree_blobs
            : undefined;

      return {
        id,
        originalId:
          typeof record.original === "string" ? record.original : undefined,
        parentId: typeof record.parent === "string" ? record.parent : undefined,
        treeId: typeof record.tree === "string" ? record.tree : undefined,
        programVersion:
          typeof record.program_version === "string"
            ? record.program_version
            : undefined,
        time,
        shortId,
        label,
        paths,
        sizeLabel,
        durationLabel,
        hostname,
        username,
        tags,
        filesNew,
        filesChanged,
        filesUnmodified,
        totalBytesProcessed,
        totalFilesProcessed: totalFilesProcessed as number | undefined,
        totalDirsProcessed: totalDirsProcessed as number | undefined,
        dataBlobsAdded,
        treeBlobs,
      } as SnapshotRecord;
    })
    .filter((item): item is SnapshotRecord => item !== null)
    .sort((a, b) => {
      const aMs = a.time ? new Date(a.time).getTime() : 0;
      const bMs = b.time ? new Date(b.time).getTime() : 0;
      return bMs - aMs;
    });
}

function extractFileEntries(raw: unknown): FileEntry[] {
  const nodes: Record<string, unknown>[] = [];
  const stringPaths: string[] = [];
  const stack: unknown[] = [raw];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (typeof current === "string") {
      const normalized = current.trim().replace(/^\/+|\/+$/g, "");
      if (normalized) stringPaths.push(normalized);
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (typeof current !== "object") continue;

    const record = current as Record<string, unknown>;
    const hasPathLikeField =
      typeof record.path === "string" ||
      typeof record.name === "string" ||
      typeof record.file === "string";
    if (hasPathLikeField) {
      nodes.push(record);
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value) || (value && typeof value === "object")) {
        stack.push(value);
      }
    }
  }

  const objectEntries = nodes
    .map((record) => {
      const pathValue =
        (typeof record.path === "string" && record.path) ||
        (typeof record.file === "string" && record.file) ||
        (typeof record.name === "string" && record.name) ||
        "";
      if (!pathValue) return null;

      const typeValue =
        `${record.type ?? record.kind ?? record.node_type ?? ""}`.toLowerCase();
      const kind: "file" | "dir" =
        typeValue.includes("dir") || typeValue.includes("tree") || typeValue === "d"
          ? "dir"
          : "file";
      const segments = pathValue.split("/").filter(Boolean);
      const name =
        segments.length > 0 ? segments[segments.length - 1]! : pathValue;
      return {
        name,
        path: pathValue,
        kind,
        sizeLabel: numberToSize(
          record.size ?? record.total_size ?? record.bytes,
        ),
      } as FileEntry;
    })
    .filter((item): item is FileEntry => item !== null);

  const pathCandidates = Array.from(new Set(stringPaths));
  const stringEntries =
    pathCandidates.length === 0
      ? []
      : pathCandidates.map((pathValue) => {
          const hasChildren = pathCandidates.some(
            (candidate) =>
              candidate !== pathValue &&
              candidate.startsWith(`${pathValue}/`),
          );
          const segments = pathValue.split("/").filter(Boolean);
          const name =
            segments.length > 0
              ? segments[segments.length - 1]!
              : pathValue;
          return {
            name,
            path: pathValue,
            kind: hasChildren ? "dir" : "file",
            sizeLabel: "",
          } as FileEntry;
        });

  const entries = [...objectEntries, ...stringEntries];

  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function formatSnapshotMeta(snapshot: SnapshotRecord) {
  const chunks = [] as string[];
  if (snapshot.sizeLabel) chunks.push(snapshot.sizeLabel);
  if (snapshot.durationLabel) chunks.push(`in ${snapshot.durationLabel}`);
  chunks.push(`ID: ${snapshot.shortId}`);
  return chunks.join(", ");
}

function formatDurationMs(ms: number | null) {
  if (!ms || ms <= 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTimeUntil(isoTime: string | null) {
  if (!isoTime) return "—";
  const deltaMs = new Date(isoTime).getTime() - Date.now();
  if (deltaMs <= 0) return "now";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function normalizeSnapshotKey(value: string) {
  return value.trim().toLowerCase();
}

function getSnapshotFileLoadHint(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("tree id") && normalized.includes("not found in index")) {
    return [
      "Repository index appears inconsistent for this snapshot.",
      "Run: rustic check",
      "Then: rustic repair index",
      "Retry loading files for this snapshot.",
    ].join("\n");
  }
  if (normalized.includes("rustic_core") && normalized.includes("internal operations")) {
    return [
      "Snapshot file listing failed inside rustic internal operations.",
      "Run: rustic check",
      "Then: rustic repair index",
      "Retry loading files for this snapshot.",
    ].join("\n");
  }
  if (normalized.includes("lock") && normalized.includes("repository")) {
    return [
      "Repository appears to be locked by another process.",
      "Wait for current operation to finish, then retry.",
      "If lock is stale, run: rustic unlock",
    ].join("\n");
  }
  return null;
}

function sanitizeWorkerErrorMessage(message: string) {
  return message.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "").trim();
}

function buildSnapshotStreamWebSocketUrl(repositoryId: string) {
  if (!repositoryId) return null;

  const rawBase =
    env.NEXT_PUBLIC_SERVER_URL?.replace(/\/+$/, "") ??
    (typeof window !== "undefined" ? window.location.origin : "");
  if (!rawBase) return null;

  const wsBase = rawBase.startsWith("https://")
    ? `wss://${rawBase.slice("https://".length)}`
    : rawBase.startsWith("http://")
      ? `ws://${rawBase.slice("http://".length)}`
      : rawBase;

  if (!wsBase.startsWith("ws://") && !wsBase.startsWith("wss://")) {
    return null;
  }

  return `${wsBase}/api/rustic/repositories/${repositoryId}/snapshot-ws`;
}

function monthKey(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function dayKey(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SnapshotDetailPanel({
  snapshot,
  workers,
  runSummary,
  selectedWorkerId,
  onSelectedWorkerChange,
  fileTree,
  isFilesLoading,
  fileBrowserHint,
  isRunningRepositoryCheck,
  isRunningRepositoryRepairIndex,
  onRunRepositoryCheck,
  onRunRepositoryRepairIndex,
  openFileNodes,
  setOpenFileNodes,
  onForget,
}: {
  snapshot: SnapshotRecord;
  workers: WorkerRecord[];
  runSummary: { runCount: number; successCount: number; failureCount: number } | null;
  selectedWorkerId: string;
  onSelectedWorkerChange: (workerId: string) => void;
  fileTree: FileTreeNode[];
  isFilesLoading: boolean;
  fileBrowserHint: string | null;
  isRunningRepositoryCheck: boolean;
  isRunningRepositoryRepairIndex: boolean;
  onRunRepositoryCheck?: () => Promise<void> | void;
  onRunRepositoryRepairIndex?: () => Promise<void> | void;
  openFileNodes: Record<string, boolean>;
  setOpenFileNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onForget?: (snapshotId: string) => Promise<void> | void;
}) {
  const selectedWorkerName = workers.find((worker) => worker.id === selectedWorkerId)?.name ?? "";
  const [isForgetDialogOpen, setIsForgetDialogOpen] = useState(false);
  const [isForgetting, setIsForgetting] = useState(false);

  const formattedTime = snapshot.time
    ? new Date(snapshot.time).toLocaleString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : snapshot.shortId;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{formattedTime}</h2>
        {onForget && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-destructive hover:text-destructive"
              disabled={isForgetting}
              onClick={() => setIsForgetDialogOpen(true)}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Forget (Destructive)
            </Button>
            <AlertDialog open={isForgetDialogOpen} onOpenChange={setIsForgetDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Forget snapshot?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Snapshot {snapshot.id.slice(0, 8)} will be permanently removed from the repository.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsForgetDialogOpen(false)}
                    disabled={isForgetting}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={isForgetting}
                    onClick={async () => {
                      setIsForgetting(true);
                      setIsForgetDialogOpen(false);
                      try {
                        await onForget(snapshot.id);
                      } finally {
                        setIsForgetting(false);
                      }
                    }}
                  >
                    {isForgetting ? "Forgetting..." : "Forget Snapshot"}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>

      {/* Timeline content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="relative space-y-3">
          {/* ── Snapshot operation ── */}
          <TimelineEntry
            icon={<Shield className="size-3.5 text-amber-500" />}
            title={`${formattedTime} - Snapshot`}
            subtitle={snapshot.durationLabel ? `in ${snapshot.durationLabel}` : undefined}
            defaultOpen
          >
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-xs font-medium">
                <ChevronDown className="size-3 transition-transform [[data-state=closed]>&]:rotate-[-90deg]" />
                Details
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1.5 space-y-2 rounded-md border bg-muted/30 p-2.5">
                  <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    <DetailRow label="Snapshot ID" value={snapshot.shortId} />
                    <DetailRow
                      label="Rustic Version"
                      value={snapshot.programVersion ?? "—"}
                    />
                    <DetailRow
                      label="Original ID"
                      value={snapshot.originalId ?? "—"}
                    />
                    <DetailRow
                      label="Parent ID"
                      value={snapshot.parentId ?? "—"}
                    />
                    <DetailRow label="Tree ID" value={snapshot.treeId ?? "—"} />
                    <DetailRow
                      label="Workers"
                      value={
                        workers.length > 0
                          ? workers.map((worker) => worker.name).join(", ")
                          : "Unknown"
                      }
                    />
                    <DetailRow
                      label="Worker Runs"
                      value={
                        runSummary
                          ? `${runSummary.successCount} succeeded / ${runSummary.failureCount} failed (${runSummary.runCount} total)`
                          : "—"
                      }
                    />
                  </div>
                  <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    <DetailRow
                      label="User and Host"
                      value={
                        snapshot.username || snapshot.hostname
                          ? `${snapshot.username ?? ""}@${snapshot.hostname ?? ""}`
                          : "—"
                      }
                    />
                    <DetailRow
                      label="Tags"
                      value={
                        snapshot.tags && snapshot.tags.length > 0
                          ? snapshot.tags.join(", ")
                          : "—"
                      }
                    />
                  </div>
                  <Separator />
                  <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-3">
                    <DetailRow
                      label="Files Added"
                      value={snapshot.filesNew?.toLocaleString() ?? "—"}
                    />
                    <DetailRow
                      label="Files Changed"
                      value={snapshot.filesChanged?.toLocaleString() ?? "—"}
                    />
                    <DetailRow
                      label="Files Unmodified"
                      value={snapshot.filesUnmodified?.toLocaleString() ?? "—"}
                    />
                  </div>
                  <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-3">
                    <DetailRow
                      label="Bytes Added"
                      value={snapshot.dataBlobsAdded || "—"}
                    />
                    <DetailRow
                      label="Total Bytes Processed"
                      value={snapshot.totalBytesProcessed || "—"}
                    />
                    <DetailRow
                      label="Total Files Processed"
                      value={
                        snapshot.totalFilesProcessed?.toLocaleString() ?? "—"
                      }
                    />
                    <DetailRow
                      label="Total Dirs Processed"
                      value={
                        snapshot.totalDirsProcessed?.toLocaleString() ?? "—"
                      }
                    />
                    <DetailRow
                      label="Tree Blobs"
                      value={snapshot.treeBlobs?.toLocaleString() ?? "—"}
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Snapshot Browser */}
            <Collapsible defaultOpen className="mt-2">
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-xs font-medium">
                <ChevronDown className="size-3 transition-transform [[data-state=closed]>&]:rotate-[-90deg]" />
                Snapshot Browser
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 rounded-md border bg-muted/30 p-2">
                  <div className="mb-2">
                    <Label className="mb-1 block text-[11px] text-muted-foreground">
                      Show files from worker
                    </Label>
                    <Select
                      value={selectedWorkerId}
                      onValueChange={(value) => onSelectedWorkerChange(value ?? "")}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="Choose worker">
                          {selectedWorkerName || "Choose worker"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {workers.map((worker) => (
                          <SelectItem key={worker.id} value={worker.id}>
                            {worker.name} ({worker.status})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {fileBrowserHint && (
                    <Alert variant="warning" className="mb-2">
                      <AlertTriangle className="size-4" />
                      <AlertTitle>Snapshot index issue detected</AlertTitle>
                      <AlertDescription>
                        {fileBrowserHint.split("\n").map((line) => (
                          <span key={line} className="block text-xs">
                            {line}
                          </span>
                        ))}
                      </AlertDescription>
                      <AlertAction>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={
                            isRunningRepositoryCheck ||
                            isRunningRepositoryRepairIndex ||
                            !onRunRepositoryCheck
                          }
                          onClick={() => void onRunRepositoryCheck?.()}
                        >
                          {isRunningRepositoryCheck ? "Running check..." : "Run Check"}
                        </Button>
                        <Button
                          size="xs"
                          variant="destructive-outline"
                          disabled={
                            isRunningRepositoryCheck ||
                            isRunningRepositoryRepairIndex ||
                            !onRunRepositoryRepairIndex
                          }
                          onClick={() => void onRunRepositoryRepairIndex?.()}
                        >
                          {isRunningRepositoryRepairIndex
                            ? "Repairing..."
                            : "Repair Index"}
                        </Button>
                      </AlertAction>
                    </Alert>
                  )}
                  {isFilesLoading ? (
                    <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      Loading files...
                    </div>
                  ) : fileTree.length === 0 ? (
                    <p className="py-4 text-xs text-muted-foreground">
                      No files found.
                    </p>
                  ) : (
                    <FileTreeView
                      nodes={fileTree}
                      openFileNodes={openFileNodes}
                      setOpenFileNodes={setOpenFileNodes}
                    />
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </TimelineEntry>

          {/* ── Backup operation ── */}
          <TimelineEntry
            icon={<HardDriveDownload className="size-3.5 text-emerald-500" />}
            title={`${formattedTime} - Backup`}
            subtitle={snapshot.durationLabel ? `in ${snapshot.durationLabel}` : undefined}
          >
            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-xs font-medium">
                <ChevronRight className="size-3 transition-transform [[data-state=open]>&]:rotate-90" />
                Backup Details
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
                  <DetailRow label="Paths" value={snapshot.paths.join(", ") || "—"} />
                  <DetailRow label="Size" value={snapshot.sizeLabel || "—"} />
                  <DetailRow label="Duration" value={snapshot.durationLabel || "—"} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </TimelineEntry>
        </div>
      </div>
    </div>
  );
}

function TimelineEntry({
  icon,
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="relative pl-6">
      {/* Timeline dot */}
      <div className="absolute left-0 top-0.5 flex size-5 items-center justify-center rounded-full border bg-background">
        {icon}
      </div>
      {/* Timeline line */}
      <div className="absolute bottom-0 left-[9px] top-6 w-px bg-border" />

      <button
        type="button"
        className="mb-1 flex items-center gap-2 text-xs"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="font-medium">{title}</span>
        {subtitle && (
          <span className="text-muted-foreground">{subtitle}</span>
        )}
      </button>

      {isOpen && <div className="space-y-2 pb-2">{children}</div>}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-[10px] font-medium leading-none text-muted-foreground">{label}</dt>
      <dd className="truncate text-[11px] leading-snug" title={value}>
        {value}
      </dd>
    </div>
  );
}

function SnapshotActivityDetailPanel({ activity }: { activity: SnapshotActivity }) {
  const progress = Math.max(0, Math.min(100, activity.progressPercent ?? 0));
  const filesProgress =
    activity.filesDone !== null && activity.filesTotal !== null
      ? `${activity.filesDone.toLocaleString()} / ${activity.filesTotal.toLocaleString()}`
      : "—";
  const bytesProgress =
    activity.bytesDone !== null && activity.bytesTotal !== null
      ? `${numberToSize(activity.bytesDone)} / ${numberToSize(activity.bytesTotal)}`
      : "—";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          {activity.planName ?? "Snapshot plan"}{" "}
          <span className="text-muted-foreground font-normal">
            ({activity.kind === "running" ? "In Progress" : "Pending"})
          </span>
        </h2>
        <Badge variant={activity.kind === "running" ? "default" : "outline"}>
          {activity.kind === "running" ? "Running" : "Pending"}
        </Badge>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            <DetailRow label="Worker" value={activity.workerName ?? "—"} />
            <DetailRow
              label="Started"
              value={activity.startedAt ? new Date(activity.startedAt).toLocaleString() : "—"}
            />
            <DetailRow
              label="Next Run"
              value={activity.nextRunAt ? new Date(activity.nextRunAt).toLocaleString() : "—"}
            />
            <DetailRow
              label="Elapsed"
              value={
                activity.elapsedMs !== null
                  ? formatDurationMs(activity.elapsedMs)
                  : "—"
              }
            />
            <DetailRow label="Phase" value={activity.phase ?? "—"} />
            <DetailRow label="Current Path" value={activity.currentPath ?? "—"} />
            <DetailRow label="Files" value={filesProgress} />
            <DetailRow label="Bytes" value={bytesProgress} />
            <DetailRow
              label="Last Update"
              value={activity.lastEventAt ? new Date(activity.lastEventAt).toLocaleString() : "—"}
            />
          </div>
          <DetailRow label="Current Task" value={activity.message || "Waiting for update..."} />
          {activity.kind === "running" ? (
            <div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {progress > 0 ? `${progress}%` : "Estimating progress..."}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FileTreeView({
  nodes,
  openFileNodes,
  setOpenFileNodes,
  depth = 0,
}: {
  nodes: FileTreeNode[];
  openFileNodes: Record<string, boolean>;
  setOpenFileNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  depth?: number;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => {
        const isOpen = openFileNodes[node.path] ?? depth < 1;
        return (
          <div key={node.path}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs hover:bg-muted/60"
              style={{ paddingLeft: `${6 + depth * 16}px` }}
              onClick={() => {
                if (node.kind === "dir") {
                  setOpenFileNodes((current) => ({
                    ...current,
                    [node.path]: !isOpen,
                  }));
                }
              }}
            >
              {node.kind === "dir" ? (
                <>
                  <ChevronRight
                    className={`size-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  {isOpen ? (
                    <FolderOpen className="size-3.5 shrink-0 text-amber-500" />
                  ) : (
                    <Folder className="size-3.5 shrink-0 text-amber-500" />
                  )}
                </>
              ) : (
                <>
                  <span className="inline-block w-3 shrink-0" />
                  {node.name.endsWith(".txt") || node.name.endsWith(".md") ? (
                    <FileText className="size-3.5 shrink-0 text-sky-500" />
                  ) : (
                    <File className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                </>
              )}
              <span className="truncate">{node.name}</span>
              {node.sizeLabel && (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {node.sizeLabel}
                </span>
              )}
            </button>
            {node.kind === "dir" && isOpen && node.children.length > 0 ? (
              <FileTreeView
                nodes={node.children}
                openFileNodes={openFileNodes}
                setOpenFileNodes={setOpenFileNodes}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

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
  const [viewMode, setViewMode] = useQueryState(
    "viewMode",
    parseAsStringEnum(["tree", "list"])
      .withDefault("tree")
      .withOptions({ history: "replace" }),
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
  const [selectedSnapshotWorkerId, setSelectedSnapshotWorkerId] = useQueryState(
    "selectedSnapshotWorkerId",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isFilesLoading, setIsFilesLoading] = useState(false);
  const [fileBrowserHint, setFileBrowserHint] = useState<string | null>(null);
  const [isRunningRepositoryCheck, setIsRunningRepositoryCheck] = useState(false);
  const [isRunningRepositoryRepairIndex, setIsRunningRepositoryRepairIndex] = useState(false);

  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const [openFileNodes, setOpenFileNodes] = useState<Record<string, boolean>>(
    {},
  );
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
      const response = await fetch(
        `${API_BASE}/rustic/repositories`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to load repositories");

      const data = (await response.json()) as {
        repositories?: RepositoryRecord[];
      };
      const repositoryList = data.repositories ?? [];
      setRepositories(repositoryList);
      if (repositoryList.length > 0) {
        setSelectedRepositoryId(
          (current) => current || repositoryList[0]!.id,
        );
      }
    } catch {
      toast.error("Could not load repositories for snapshots.");
    } finally {
      setIsLoading(false);
    }
  }, [session?.user]);

  const loadSnapshots = useCallback(
    async (
      repositoryId: string,
      options?: { silent?: boolean; preserveSelection?: boolean },
    ) => {
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
      const response = await fetch(
        `${API_BASE}/rustic/repositories/${repositoryId}/snapshots`,
        { method: "POST", credentials: "include" },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || "Failed to load snapshots");
      }

      const data = (await response.json()) as {
        rustic?: {
          parsedJson?: unknown;
          parsed_json?: unknown;
          stdout?: string;
        };
      };
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
          toast.error(
            error instanceof Error ? error.message : "Could not load snapshots.",
          );
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
      const response = await fetch(
        `${API_BASE}/rustic/repositories/${repositoryId}/snapshot-workers`,
        { credentials: "include" },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || "Failed to load snapshot worker attribution");
      }

      const data = (await response.json()) as {
        snapshots?: SnapshotWorkerAttribution[];
      };
      setSnapshotAttribution(data.snapshots ?? []);
    } catch (error) {
        if (!silent) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not load snapshot worker attribution.",
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
      const response = await fetch(
        `${API_BASE}/rustic/repositories/${repositoryId}/snapshot-activity`,
        { credentials: "include" },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || "Failed to load snapshot activity");
      }

      const data = (await response.json()) as {
        activities?: SnapshotActivity[];
      };
      setSnapshotActivity(data.activities ?? []);
    } catch (error) {
        if (!silent) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not load snapshot activity.",
          );
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
    async (snapshotId: string, workerId: string) => {
      if (!selectedRepositoryId || !snapshotId || !workerId) {
        setFiles([]);
        setFileBrowserHint(null);
        return;
      }

      setIsFilesLoading(true);
      try {
        setFileBrowserHint(null);
        const response = await fetch(
          `${API_BASE}/rustic/repositories/${selectedRepositoryId}/snapshot/files`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ snapshot: snapshotId, workerId }),
          },
        );
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error || "Failed to load files");
        }

        const data = (await response.json()) as {
          rustic?: {
            parsedJson?: unknown;
            parsed_json?: unknown;
            stdout?: string;
          };
        };
        const parsed =
          data.rustic?.parsedJson ??
          data.rustic?.parsed_json ??
          parseMaybeJsonFromStdout(data.rustic?.stdout);
        setFiles(extractFileEntries(parsed));
      } catch (error) {
        const rawMessage =
          error instanceof Error ? error.message : "Could not load file browser.";
        const message = sanitizeWorkerErrorMessage(rawMessage);
        setFileBrowserHint(getSnapshotFileLoadHint(message));
        toast.error(
          message,
        );
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

      const wsUrl = buildSnapshotStreamWebSocketUrl(selectedRepositoryId);
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
    if (!selectedSnapshotId || !selectedSnapshotWorkerId) return;
    void loadFiles(selectedSnapshotId, selectedSnapshotWorkerId);
  }, [selectedSnapshotId, selectedSnapshotWorkerId, loadFiles]);

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

  const attributionBySnapshotKey = useMemo(() => {
    const map = new Map<string, SnapshotWorkerAttribution>();
    for (const entry of snapshotAttribution) {
      map.set(normalizeSnapshotKey(entry.snapshotId), entry);
      map.set(normalizeSnapshotKey(entry.snapshotShortId), entry);
    }
    return map;
  }, [snapshotAttribution]);

  const displaySnapshots = useMemo<DisplaySnapshot[]>(() => {
    const groups = new Map<string, SnapshotRecord[]>();

    for (const snapshot of snapshots) {
      const attribution =
        attributionBySnapshotKey.get(normalizeSnapshotKey(snapshot.id)) ??
        attributionBySnapshotKey.get(normalizeSnapshotKey(snapshot.shortId)) ??
        null;
      const date = snapshot.time ? new Date(snapshot.time) : null;
      const secondBucket = date
        ? new Date(Math.floor(date.getTime() / 1_000) * 1_000).toISOString()
        : snapshot.id;
      const runGroupKey =
        attribution && attribution.runGroupIds.length > 0
          ? `rungroup:${attribution.runGroupIds.slice().sort().join(",")}`
          : null;
      const key = runGroupKey ? runGroupKey : secondBucket;
      const current = groups.get(key) ?? [];
      current.push(snapshot);
      groups.set(key, current);
    }

    const merged = Array.from(groups.values()).map((group) => {
      const representative = group[0]!;
      const workerMap = new Map<string, WorkerRecord>();
      let runCount = 0;
      let successCount = 0;
      let failureCount = 0;

      for (const snapshot of group) {
        const attribution =
          attributionBySnapshotKey.get(normalizeSnapshotKey(snapshot.id)) ??
          attributionBySnapshotKey.get(normalizeSnapshotKey(snapshot.shortId)) ??
          null;
        if (!attribution) continue;
        for (const worker of attribution.workers) {
          workerMap.set(worker.id, worker);
        }
        runCount += attribution.runCount;
        successCount += attribution.successCount;
        failureCount += attribution.failureCount;
      }

      const mergedPaths = Array.from(
        new Set(group.flatMap((snapshot) => snapshot.paths)),
      );

      return {
        ...representative,
        paths: mergedPaths,
        sourceSnapshotIds: group.map((snapshot) => snapshot.id),
        mergedWorkers: Array.from(workerMap.values()),
        mergedRunCount: runCount,
        mergedSuccessCount: successCount,
        mergedFailureCount: failureCount,
      } satisfies DisplaySnapshot;
    });

    return merged.sort((a, b) => {
      const aMs = a.time ? new Date(a.time).getTime() : 0;
      const bMs = b.time ? new Date(b.time).getTime() : 0;
      return bMs - aMs;
    });
  }, [snapshots, attributionBySnapshotKey]);

  const snapshotListItems = useMemo<SnapshotListItem[]>(() => {
    const fromSnapshots: SnapshotListItem[] = displaySnapshots.map((snapshot) => {
      const workerSummary =
        snapshot.mergedWorkers.length > 0
          ? snapshot.mergedWorkers.map((worker) => worker.name).join(", ")
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
  }, [displaySnapshots, snapshotActivity]);

  useEffect(() => {
    if (selectedSnapshotId && !displaySnapshots.some((snapshot) => snapshot.id === selectedSnapshotId)) {
      setSelectedSnapshotId("");
    }
  }, [displaySnapshots, selectedSnapshotId]);

  useEffect(() => {
    if (selectedActivityId && !snapshotActivity.some((activity) => `activity:${activity.id}` === selectedActivityId)) {
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
  const selectedActivity =
    snapshotActivity.find((activity) => `activity:${activity.id}` === selectedActivityId) ?? null;

  useEffect(() => {
    if (!selectedSnapshot) {
      setSelectedSnapshotWorkerId("");
      return;
    }

    const hasSelectedWorker = selectedSnapshot.mergedWorkers.some(
      (worker) => worker.id === selectedSnapshotWorkerId,
    );
    if (!hasSelectedWorker) {
      setSelectedSnapshotWorkerId(selectedSnapshot.mergedWorkers[0]?.id ?? "");
    }
  }, [selectedSnapshot, selectedSnapshotWorkerId]);

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
    const roots = Array.from(nodeByPath.values()).filter(
      (node) => !node.path.includes("/"),
    );

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
      const response = await fetch(
        `${API_BASE}/rustic/repositories/${selectedRepositoryId}/check`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workerId: selectedSnapshotWorkerId || undefined,
          }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Repository check failed");
      }

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
      const response = await fetch(
        `${API_BASE}/rustic/repositories/${selectedRepositoryId}/repair-index`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workerId: selectedSnapshotWorkerId || undefined,
          }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Repository index repair failed");
      }

      toast.success("Repository index repair completed.");
      if (selectedSnapshotId && selectedSnapshotWorkerId) {
        void loadFiles(selectedSnapshotId, selectedSnapshotWorkerId);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not repair repository index.");
    } finally {
      setIsRunningRepositoryRepairIndex(false);
    }
  }, [loadFiles, selectedRepositoryId, selectedSnapshotId, selectedSnapshotWorkerId]);

  // ── Actions ────────────────────────────────────────────────────────────────

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
      const response = await fetch(
        `${API_BASE}/rustic/repositories/${selectedRepositoryId}/backup`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workerId: manualWorkerId,
            paths,
            tags,
            dryRun: backupDryRun,
          }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || "Failed to trigger backup");
      }

      toast.success(
        backupDryRun ? "Dry-run backup started." : "Backup started.",
      );
      await Promise.all([
        loadSnapshots(selectedRepositoryId),
        loadSnapshotAttribution(selectedRepositoryId),
        loadSnapshotActivity(selectedRepositoryId),
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not trigger backup.",
      );
    } finally {
      setIsTriggeringBackup(false);
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderSnapshotRow(item: SnapshotListItem) {
    const isSelected =
      item.kind === "snapshot"
        ? item.id === selectedSnapshotId
        : item.id === selectedActivityId;
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
            setSelectedSnapshotWorkerId(item.snapshot.mergedWorkers[0]?.id ?? "");
            setOpenFileNodes({});
          } else {
            setSelectedActivityId(item.id);
            setSelectedSnapshotId("");
            setSelectedSnapshotWorkerId(item.activity.workerId ?? "");
          }
        }}
      >
        {item.kind === "snapshot" ? (
          <HardDriveDownload className="size-3.5 shrink-0 text-emerald-500" />
        ) : item.kind === "running" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <Timer className="size-3.5 shrink-0 text-amber-500" />
        )}
        <span className="truncate">{item.label}</span>
        {item.workerSummary ? (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            {item.workerSummary}
          </Badge>
        ) : null}
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          [{item.meta}]
        </span>
      </button>
    );
  }

  // ── Main layout ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Snapshots</h1>
        <p className="text-sm text-muted-foreground">
          Browse and manage backup snapshots.
        </p>
      </div>

      {/* Repository selector + backup trigger */}
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <Label className="mb-1.5 text-xs">Repository</Label>
              <Select
                value={selectedRepositoryId}
                onValueChange={(value) =>
                  setSelectedRepositoryId(value ?? "")
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue
                    placeholder={
                      isLoading
                        ? "Loading repositories..."
                        : "Choose repository"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {repositories.map((repository) => (
                    <SelectItem key={repository.id} value={repository.id}>
                      {repository.name} ({repository.backend})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Assigned workers:{" "}
                {selectedRepository?.backupWorkers.length
                  ? selectedRepository.backupWorkers.map((worker) => worker.name).join(", ")
                  : "None"}
              </p>
            </div>
          </div>
        </div>

        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3 transition-transform [[data-state=open]>&]:rotate-90" />
            Create Backup
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid gap-3 border-t px-4 py-3 lg:grid-cols-[2fr_1fr]">
              <div className="space-y-1.5">
                <Label className="text-xs">Backup paths (one per line)</Label>
                <Textarea
                  className="min-h-20 font-mono text-xs"
                  value={backupPathsInput}
                  onChange={(event) =>
                    setBackupPathsInput(event.target.value)
                  }
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
                  <SelectContent>
                    {(selectedRepository?.backupWorkers ?? []).map((worker) => (
                      <SelectItem key={worker.id} value={worker.id}>
                        {worker.name} ({worker.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label className="text-xs">Tags (comma-separated)</Label>
                <Input
                  className="h-8 text-xs"
                  value={backupTagsInput}
                  onChange={(event) =>
                    setBackupTagsInput(event.target.value)
                  }
                  placeholder="manual, on-demand"
                />
                <div className="flex items-center justify-between rounded border px-2 py-1">
                  <span className="text-[11px] text-muted-foreground">
                    Dry run
                  </span>
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
                      <Loader2 className="mr-1.5 size-3 animate-spin" />
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
              <Loader2 className="size-3 animate-spin" />
              Refreshing
            </span>
          ) : null}
        </div>
        {snapshotActivity.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No pending or in-progress plan snapshots for this repository.
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
                      Next run: {activity.nextRunAt ? new Date(activity.nextRunAt).toLocaleString() : "—"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Split-panel explorer */}
      <div className="flex overflow-hidden rounded-lg border bg-card" style={{ height: "calc(100vh - 300px)", minHeight: "500px" }}>
        {/* ── Left panel: snapshot tree ── */}
        <div className="flex w-130 shrink-0 flex-col border-r">
          {/* Tabs */}
          <div className="border-b px-3 py-3">
            <Tabs
              value={viewMode}
              onValueChange={(v) => setViewMode(v as "tree" | "list")}
            >
              <TabsList className="h-7 p-0.5">
                <TabsTrigger value="tree" className="px-3 text-xs">
                  Tree View
                </TabsTrigger>
                <TabsTrigger value="list" className="px-3 text-xs">
                  List View
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Snapshot list */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {isAttributionLoading ? (
              <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Loading snapshot worker attribution...
              </div>
            ) : null}
            {isSnapshotsLoading ? (
              <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Loading snapshots...
              </div>
            ) : snapshotListItems.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No snapshots available.
              </p>
            ) : viewMode === "list" ? (
              <div className="space-y-0.5">
                {snapshotListItems.map((item) => renderSnapshotRow(item))}
              </div>
            ) : (
              <div className="space-y-1">
                {treeData.map((monthNode) => {
                  const monthOpen = openMonths[monthNode.month] ?? true;
                  const totalItems = monthNode.days.reduce(
                    (sum, d) => sum + d.items.length,
                    0,
                  );
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
                        <ChevronRight
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
                            const dayOpen =
                              openDays[dayNode.day] ?? true;
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
                                  <ChevronRight
                                    className={`size-3 transition-transform ${dayOpen ? "rotate-90" : ""}`}
                                  />
                                  {dayNode.day}
                                  <span className="text-[10px] text-muted-foreground">
                                    {dayNode.items.length} items
                                  </span>
                                </button>
                                {dayOpen && (
                                  <div className="ml-4 mt-0.5 space-y-0.5">
                                    {dayNode.items.map((item) =>
                                      renderSnapshotRow(item),
                                    )}
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
        <div className="flex flex-1 flex-col">
          {selectedSnapshot ? (
            <SnapshotDetailPanel
              snapshot={selectedSnapshot}
              workers={selectedSnapshot.mergedWorkers}
              runSummary={
                selectedSnapshot.mergedRunCount > 0
                  ? {
                      runCount: selectedSnapshot.mergedRunCount,
                      successCount: selectedSnapshot.mergedSuccessCount,
                      failureCount: selectedSnapshot.mergedFailureCount,
                    }
                  : null
              }
              selectedWorkerId={selectedSnapshotWorkerId}
              onSelectedWorkerChange={(workerId) => setSelectedSnapshotWorkerId(workerId)}
              fileTree={fileTree}
              isFilesLoading={isFilesLoading}
              fileBrowserHint={fileBrowserHint}
              isRunningRepositoryCheck={isRunningRepositoryCheck}
              isRunningRepositoryRepairIndex={isRunningRepositoryRepairIndex}
              onRunRepositoryCheck={runRepositoryCheck}
              onRunRepositoryRepairIndex={runRepositoryRepairIndex}
              openFileNodes={openFileNodes}
              setOpenFileNodes={setOpenFileNodes}
              onForget={async (snapshotId) => {
                if (!selectedRepositoryId) return;
                try {
                  const response = await fetch(
                    `${API_BASE}/rustic/repositories/${selectedRepositoryId}/forget-snapshot`,
                    {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        snapshotId,
                        workerId: selectedSnapshotWorkerId || undefined,
                      }),
                    },
                  );
                  if (!response.ok) {
                    const data = (await response.json().catch(() => null)) as { error?: string } | null;
                    throw new Error(data?.error || "Failed to forget snapshot");
                  }
                  toast.success(`Snapshot ${snapshotId.slice(0, 8)} forgotten.`);
                  void loadSnapshots(selectedRepositoryId);
                  void loadSnapshotAttribution(selectedRepositoryId);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not forget snapshot.");
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
          <h1 className="text-2xl font-semibold tracking-tight">Snapshots</h1>
          <p className="text-sm text-muted-foreground">Loading snapshots...</p>
        </div>
      }
    >
      <SnapshotsPageContent />
    </Suspense>
  );
}
