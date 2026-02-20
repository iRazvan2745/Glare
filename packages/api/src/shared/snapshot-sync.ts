import { db } from "@glare/db";
import { backupPlanRun } from "@glare/db/schema/backup-plan-runs";

import { recordBackupMetric } from "./backup-metrics";
import { logError, logInfo, logWarn } from "./logger";
import { recordStorageUsageSample } from "./storage-usage";

const WORKER_ONLINE_THRESHOLD_MS = 45_000;
const USER_SYNC_DEBOUNCE_MS = 5 * 60 * 1_000; // 5 minutes

const lastSyncByUser = new Map<string, number>();

// ─── option helpers (mirrored from rustic module) ────────────────────────────

function parseOptionsJson(optionsJson: string | null): Record<string, string> {
  if (!optionsJson) return {};
  try {
    const parsed = JSON.parse(optionsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function hasRcloneOptions(options: Record<string, string>) {
  return Object.keys(options).some((k) => k === "rclone.type" || k.startsWith("rclone.config."));
}

function hasLegacyS3Options(options: Record<string, string>) {
  return Object.keys(options).some((k) => k.startsWith("s3."));
}

function enrichRcloneOptionsFromS3(options: Record<string, string>): Record<string, string> {
  const next = { ...options };
  if (!next["rclone.type"]) next["rclone.type"] = "s3";

  const mappings: Array<[string, string]> = [
    ["s3.endpoint", "endpoint"],
    ["s3.region", "region"],
    ["s3.access-key-id", "access_key_id"],
    ["s3.secret-access-key", "secret_access_key"],
    ["s3.session-token", "session_token"],
    ["s3.profile", "profile"],
    ["s3.storage-class", "storage_class"],
    ["s3.acl", "acl"],
  ];
  for (const [src, dst] of mappings) {
    if (next[src] && !next[`rclone.config.${dst}`]) next[`rclone.config.${dst}`] = next[src];
  }
  if (next["s3.path-style"] === "true" && !next["rclone.config.force_path_style"])
    next["rclone.config.force_path_style"] = "true";
  if (next["s3.disable-tls"] === "true" && !next["rclone.config.disable_http2"])
    next["rclone.config.disable_http2"] = "true";
  if (next["s3.no-verify-ssl"] === "true" && !next["rclone.config.no_check_certificate"])
    next["rclone.config.no_check_certificate"] = "true";
  if (!next["rclone.config.provider"]) {
    const ep = (next["s3.endpoint"] ?? "").toLowerCase();
    next["rclone.config.provider"] = ep.includes("r2.cloudflarestorage.com") ? "Cloudflare" : "AWS";
  }
  return next;
}

function normalizeRcloneRepository(
  repositoryPath: string,
  repositoryId: string,
  options: Record<string, string>,
) {
  const trimmed = repositoryPath.trim();
  const remoteFromOption = options["rclone.remote"]?.trim() || null;
  if (trimmed.startsWith("rclone:")) {
    const rest = trimmed.slice("rclone:".length);
    const sep = rest.indexOf(":");
    const remoteFromPath = sep >= 0 ? rest.slice(0, sep).trim() : "";
    const remote = remoteFromOption || remoteFromPath || `glare-${repositoryId.slice(0, 8)}`;
    options["rclone.remote"] = remote;
    return trimmed;
  }
  const remote = remoteFromOption || `glare-${repositoryId.slice(0, 8)}`;
  const normalizedPath = trimmed.replace(/^\/+/, "");
  options["rclone.remote"] = remote;
  return `rclone:${remote}:${normalizedPath}`;
}

function deriveRcloneRepository(
  repositoryPath: string,
  repositoryId: string,
  options: Record<string, string>,
) {
  return normalizeRcloneRepository(repositoryPath, repositoryId, options);
}

// ─── snapshot date helper ────────────────────────────────────────────────────

function parseSnapshotDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1_000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── core sync ───────────────────────────────────────────────────────────────

async function fetchSnapshotsFromWorker(
  endpoint: string,
  syncToken: string,
  payload: unknown,
): Promise<unknown[]> {
  const url = `${endpoint.replace(/\/+$/, "")}/rustic/repository-snapshots`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${syncToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return [];
  }

  if (!data || typeof data !== "object") return [];
  const rustic = (data as Record<string, unknown>).rustic;
  if (!rustic || typeof rustic !== "object") return [];
  const parsedJson = (rustic as Record<string, unknown>).parsedJson;
  return Array.isArray(parsedJson) ? parsedJson : [];
}

async function syncPlanSnapshots(input: {
  userId: string;
  planId: string;
  repositoryId: string;
  workerId: string;
  repository: string;
  backend: string;
  password: string | null;
  optionsJson: string | null;
  endpoint: string;
  syncToken: string;
}) {
  const rawOptions = parseOptionsJson(input.optionsJson);
  const snapshotOptions = hasRcloneOptions(rawOptions)
    ? rawOptions
    : input.backend === "s3" && hasLegacyS3Options(rawOptions)
      ? enrichRcloneOptionsFromS3(rawOptions)
      : rawOptions;

  const needsRclone =
    input.backend === "rclone" ||
    (input.backend === "s3" &&
      (hasRcloneOptions(snapshotOptions) || hasLegacyS3Options(snapshotOptions)));

  const snapshotsRepository = needsRclone
    ? deriveRcloneRepository(input.repository, input.repositoryId, snapshotOptions)
    : input.repository;

  const snapshots = await fetchSnapshotsFromWorker(input.endpoint, input.syncToken, {
    repository: snapshotsRepository,
    password: input.password ?? undefined,
    backend: needsRclone ? "rclone" : input.backend,
    options: needsRclone ? snapshotOptions : undefined,
  });

  if (snapshots.length === 0) return;

  // Load all known snapshot IDs for this repository
  const existingResult = await db.$client.query<{ snapshot_id: string }>(
    `SELECT LOWER(snapshot_id) AS snapshot_id
       FROM "backup_plan_run"
      WHERE user_id = $1 AND repository_id = $2 AND snapshot_id IS NOT NULL`,
    [input.userId, input.repositoryId],
  );
  const known = new Set<string>(existingResult.rows.map((r) => r.snapshot_id));

  let newCount = 0;
  for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot !== "object") continue;
    const s = snapshot as Record<string, unknown>;

    // Prefer the full id over short_id for storage in the DB
    const snapshotId: string | null =
      (typeof s.id === "string" && s.id.trim()) ||
      (typeof s.short_id === "string" && s.short_id.trim()) ||
      null;
    if (!snapshotId) continue;

    const normalizedId = snapshotId.toLowerCase();
    if (known.has(normalizedId)) continue;

    // Also skip if we know the 8-char prefix
    const prefix = normalizedId.slice(0, 8);
    if ([...known].some((k) => k.startsWith(prefix) || prefix.startsWith(k.slice(0, 8)))) {
      continue;
    }

    const snapshotTime = parseSnapshotDate(s.time) ?? parseSnapshotDate(s.timestamp) ?? null;
    const runTime = snapshotTime ?? new Date();

    const runId = crypto.randomUUID();
    try {
      await db.insert(backupPlanRun).values({
        id: runId,
        planId: input.planId,
        userId: input.userId,
        repositoryId: input.repositoryId,
        workerId: input.workerId,
        type: "backup",
        status: "success",
        error: null,
        durationMs: null,
        snapshotId,
        snapshotTime,
        outputJson: JSON.stringify(snapshot),
        startedAt: runTime,
        finishedAt: runTime,
      });
      known.add(normalizedId);
      newCount += 1;
    } catch (err) {
      logWarn("snapshot sync: failed to insert run", {
        userId: input.userId,
        repositoryId: input.repositoryId,
        snapshotId,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    try {
      await recordStorageUsageSample({
        userId: input.userId,
        repositoryId: input.repositoryId,
        runId,
        output: snapshot,
      });
      await recordBackupMetric({
        runId,
        userId: input.userId,
        repositoryId: input.repositoryId,
        planId: input.planId,
        workerId: input.workerId,
        snapshotId,
        snapshotTime,
        output: snapshot,
      });
    } catch (error) {
      logError("snapshot sync: metric recording failed", {
        runId,
        userId: input.userId,
        repositoryId: input.repositoryId,
        snapshotId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (newCount > 0) {
    logInfo("snapshot sync: imported snapshots", {
      userId: input.userId,
      repositoryId: input.repositoryId,
      workerId: input.workerId,
      newCount,
    });
  }
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Syncs all snapshots from all active workers for a specific user.
 * Debounced to at most once every 5 minutes per user (override with force: true).
 */
export async function syncUserSnapshots(userId: string, opts?: { force?: boolean }): Promise<void> {
  const now = Date.now();
  const last = lastSyncByUser.get(userId) ?? 0;
  if (!opts?.force && now - last < USER_SYNC_DEBOUNCE_MS) return;
  lastSyncByUser.set(userId, now);

  const result = await db.$client.query<{
    plan_id: string;
    repository_id: string;
    worker_id: string;
    repository: string;
    backend: string;
    password: string | null;
    options_json: string | null;
    endpoint: string;
    sync_token: string;
    last_seen_at: Date | null;
  }>(
    `SELECT
       p.id          AS plan_id,
       p.repository_id,
       p.worker_id,
       r.repository,
       r.backend,
       r.password,
       r.options_json,
       w.endpoint,
       w.sync_token,
       w.last_seen_at
     FROM "backup_plan" p
     JOIN "rustic_repository" r ON r.id = p.repository_id
     JOIN "worker"             w ON w.id = p.worker_id
     WHERE p.user_id = $1
       AND w.endpoint   IS NOT NULL
       AND w.sync_token IS NOT NULL
     ORDER BY p.repository_id, p.created_at ASC`,
    [userId],
  );

  // De-duplicate: one sync per (repository_id, worker_id) pair using the first matching plan
  const seen = new Set<string>();
  for (const row of result.rows) {
    const key = `${row.repository_id}:${row.worker_id}`;
    if (seen.has(key)) continue;

    const lastSeen =
      row.last_seen_at instanceof Date
        ? row.last_seen_at
        : row.last_seen_at
          ? new Date(row.last_seen_at)
          : null;
    if (!lastSeen || Date.now() - lastSeen.getTime() > WORKER_ONLINE_THRESHOLD_MS) continue;
    seen.add(key);

    try {
      await syncPlanSnapshots({
        userId,
        planId: row.plan_id,
        repositoryId: row.repository_id,
        workerId: row.worker_id,
        repository: row.repository,
        backend: row.backend,
        password: row.password,
        optionsJson: row.options_json,
        endpoint: row.endpoint,
        syncToken: row.sync_token,
      });
    } catch (err) {
      logWarn("snapshot sync: error syncing plan", {
        userId,
        planId: row.plan_id,
        repositoryId: row.repository_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Syncs all users that have at least one repository with an assigned worker. */
export async function syncAllUsersSnapshots(): Promise<void> {
  const result = await db.$client.query<{ user_id: string }>(
    `SELECT DISTINCT p.user_id
       FROM "backup_plan" p
       JOIN "worker" w ON w.id = p.worker_id
      WHERE w.endpoint IS NOT NULL AND w.sync_token IS NOT NULL`,
    [],
  );
  for (const { user_id } of result.rows) {
    try {
      await syncUserSnapshots(user_id, { force: true });
    } catch (err) {
      logError("snapshot sync: error for user", {
        userId: user_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Starts the background 30-minute sync interval. Call once at server startup. */
export function startSnapshotSyncInterval(intervalMs = 30 * 60 * 1_000): void {
  logInfo("snapshot sync: background interval started", { intervalMs });
  setInterval(async () => {
    try {
      await syncAllUsersSnapshots();
    } catch (err) {
      logError("snapshot sync: interval error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, intervalMs);
}
