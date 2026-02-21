// ─── Constants ───────────────────────────────────────────────────────────────

export const API_BASE = "/api";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WorkerRecord = {
  id: string;
  name: string;
  status: string;
  isOnline: boolean;
  lastSeenAt: string | null;
};

export type RepositoryRecord = {
  id: string;
  name: string;
  backend: string;
  repository: string;
  primaryWorker: WorkerRecord | null;
  backupWorkers: WorkerRecord[];
};

export type SnapshotRecord = {
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

export type SnapshotWorkerAttribution = {
  snapshotId: string;
  sourceSnapshotIds?: string[];
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

export type SnapshotListItem =
  | {
      kind: "snapshot";
      id: string;
      time: string | null;
      label: string;
      workerSummary: string | null;
      meta: string;
      snapshot: SnapshotRecord;
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

export type SnapshotActivity = {
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

export type FileEntry = {
  name: string;
  path: string;
  kind: "file" | "dir";
  sizeLabel: string;
};

export type FileTreeNode = {
  name: string;
  path: string;
  kind: "file" | "dir";
  sizeLabel: string;
  children: FileTreeNode[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function parseMaybeJsonFromStdout(stdout: string | undefined) {
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

export function numberToSize(value: unknown) {
  const size = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
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

export function numberToDuration(value: unknown) {
  const sec = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(sec) || sec <= 0) return "";
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

export function extractSnapshots(raw: unknown): SnapshotRecord[] {
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
        ? record.paths.filter((p): p is string => typeof p === "string")
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
      const label = time ? `Backup ${new Date(time).toLocaleString()}` : `Backup ${shortId}`;

      const tags = Array.isArray(record.tags)
        ? record.tags.filter((t): t is string => typeof t === "string")
        : undefined;
      const hostname = typeof record.hostname === "string" ? record.hostname : undefined;
      const username = typeof record.username === "string" ? record.username : undefined;

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
      const dataBlobsAdded = numberToSize(summary?.data_added ?? record.data_added);
      const treeBlobs =
        typeof summary?.tree_blobs === "number"
          ? summary.tree_blobs
          : typeof record.tree_blobs === "number"
            ? record.tree_blobs
            : undefined;

      return {
        id,
        originalId: typeof record.original === "string" ? record.original : undefined,
        parentId: typeof record.parent === "string" ? record.parent : undefined,
        treeId: typeof record.tree === "string" ? record.tree : undefined,
        programVersion:
          typeof record.program_version === "string" ? record.program_version : undefined,
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

export function extractFileEntries(raw: unknown): FileEntry[] {
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

      const typeValue = `${record.type ?? record.kind ?? record.node_type ?? ""}`.toLowerCase();
      const kind: "file" | "dir" =
        typeValue.includes("dir") || typeValue.includes("tree") || typeValue === "d"
          ? "dir"
          : "file";
      const segments = pathValue.split("/").filter(Boolean);
      const name = segments.length > 0 ? segments[segments.length - 1]! : pathValue;
      return {
        name,
        path: pathValue,
        kind,
        sizeLabel: numberToSize(record.size ?? record.total_size ?? record.bytes),
      } as FileEntry;
    })
    .filter((item): item is FileEntry => item !== null);

  const pathCandidates = Array.from(new Set(stringPaths));
  const stringEntries =
    pathCandidates.length === 0
      ? []
      : pathCandidates.map((pathValue) => {
          const hasChildren = pathCandidates.some(
            (candidate) => candidate !== pathValue && candidate.startsWith(`${pathValue}/`),
          );
          const segments = pathValue.split("/").filter(Boolean);
          const name = segments.length > 0 ? segments[segments.length - 1]! : pathValue;
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

export function formatSnapshotMeta(snapshot: SnapshotRecord) {
  const chunks = [] as string[];
  if (snapshot.sizeLabel) chunks.push(snapshot.sizeLabel);
  if (snapshot.durationLabel) chunks.push(`in ${snapshot.durationLabel}`);
  chunks.push(`ID: ${snapshot.shortId}`);
  return chunks.join(", ");
}

export function formatDurationMs(ms: number | null) {
  if (!ms || ms <= 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatTimeUntil(isoTime: string | null) {
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

export function normalizeSnapshotKey(value: string) {
  return value.trim().toLowerCase();
}

export function parseTimestampMs(value: string | null | undefined) {
  if (!value) return Number.NaN;
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;

  const candidates = new Set<string>();
  candidates.add(trimmed);
  candidates.add(trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T"));
  candidates.add(trimmed.replace(/\s+([+-]\d{2}:\d{2}|[+-]\d{4}|Z)$/i, "$1"));
  candidates.add(
    trimmed
      .replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T")
      .replace(/\s+([+-]\d{2}:\d{2}|[+-]\d{4}|Z)$/i, "$1"),
  );

  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;

    const hasZone = /([zZ]|[+-]\d{2}:\d{2}|[+-]\d{4})$/.test(candidate);
    if (!hasZone) {
      const parsedUtc = Date.parse(`${candidate}Z`);
      if (Number.isFinite(parsedUtc)) return parsedUtc;
    }
  }

  return Number.NaN;
}

export function getSnapshotFileLoadHint(message: string) {
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

export function sanitizeWorkerErrorMessage(message: string) {
  return message.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "").trim();
}

export function buildSnapshotStreamSseUrl(repositoryId: string, serverUrl?: string) {
  if (!repositoryId) return null;

  const rawBase =
    serverUrl?.replace(/\/+$/, "") ?? (typeof window !== "undefined" ? window.location.origin : "");
  if (!rawBase) return null;

  if (!rawBase.startsWith("http://") && !rawBase.startsWith("https://")) {
    return null;
  }

  return `${rawBase}/api/rustic/repositories/${repositoryId}/snapshot-stream`;
}

export function monthKey(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

export function dayKey(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}
