import { backupEvent } from "@glare/db/schema/backup-events";
import { backupPlanRun } from "@glare/db/schema/backup-plan-runs";
import { backupPlanWorker } from "@glare/db/schema/backup-plan-workers";
import { backupPlan } from "@glare/db/schema/backup-plans";
import { db } from "@glare/db";
import { rusticRepositoryBackupWorker } from "@glare/db/schema/repository-backup-workers";
import { rusticRepository } from "@glare/db/schema/repositories";
import { worker as workerTable } from "@glare/db/schema/workers";
import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { type } from "arktype";
import { Elysia, t } from "elysia";
import { hasRoleAtLeast } from "../../shared/auth/authorization";
import { getAuthenticatedUser } from "../../shared/auth/session";
import { logError, logInfo, logWarn } from "../../shared/logger";
import { sendDiscordNotification } from "../../shared/notifications";
import { detectBackupSizeAnomaly, recordBackupMetric } from "../../shared/backup-metrics";
import { recordStorageUsageSample } from "../../shared/storage-usage";
import { writeAuditLog } from "../../shared/audit-log";

const WORKER_ONLINE_THRESHOLD_MS = 45_000;
const BACKEND_VALUES = ["local", "s3", "b2", "rest", "webdav", "sftp", "rclone", "other"] as const;

const workerIdType = type("string.uuid");
const repositoryIdType = type("string.uuid");
const workerIdSchema = {
  safeParse(input: unknown) {
    if (!workerIdType.allows(input)) {
      return { success: false as const };
    }
    return { success: true as const, data: input as string };
  },
};
const repositoryIdSchema = {
  safeParse(input: unknown) {
    if (!repositoryIdType.allows(input)) {
      return { success: false as const };
    }
    return { success: true as const, data: input as string };
  },
};

const errorResponseSchema = t.Object({
  error: t.String(),
});

const snapshotWsTickIntervals = new Map<string, ReturnType<typeof setInterval>>();

const rusticWorkerStatsSchema = t.Object({
  id: t.String({ format: "uuid" }),
  name: t.String(),
  workerStatus: t.String(),
  isOnline: t.Boolean(),
  lastSeenAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
  uptimeMs: t.Number(),
  requestsTotal: t.Number(),
  errorTotal: t.Number(),
  errorRatePercent: t.Number(),
  syncEnabled: t.Boolean(),
});

const rusticWorkerStatsListSchema = t.Object({
  workers: t.Array(rusticWorkerStatsSchema),
  summary: t.Object({
    totalWorkers: t.Number(),
    onlineWorkers: t.Number(),
    degradedWorkers: t.Number(),
    offlineWorkers: t.Number(),
    totalRequests: t.Number(),
    totalErrors: t.Number(),
    averageErrorRatePercent: t.Number(),
  }),
});

const rusticRepositorySchema = t.Object({
  id: t.String({ format: "uuid" }),
  name: t.String(),
  backend: t.String(),
  repository: t.String(),
  isInitialized: t.Boolean(),
  initializedAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
  hasPassword: t.Boolean(),
  options: t.Record(t.String(), t.String()),
  primaryWorker: t.Union([
    t.Object({
      id: t.String({ format: "uuid" }),
      name: t.String(),
      status: t.String(),
      isOnline: t.Boolean(),
      lastSeenAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
    }),
    t.Null(),
  ]),
  worker: t.Union([
    t.Object({
      id: t.String({ format: "uuid" }),
      name: t.String(),
      status: t.String(),
      isOnline: t.Boolean(),
      lastSeenAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
    }),
    t.Null(),
  ]),
  backupWorkers: t.Array(
    t.Object({
      id: t.String({ format: "uuid" }),
      name: t.String(),
      status: t.String(),
      isOnline: t.Boolean(),
      lastSeenAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
    }),
  ),
  createdAt: t.String({ format: "date-time" }),
  updatedAt: t.String({ format: "date-time" }),
});

const repositoryStatsSchema = t.Object({
  totalRepositories: t.Number(),
  linkedWorkers: t.Number(),
  unlinkedRepositories: t.Number(),
  byBackend: t.Object({
    local: t.Number(),
    s3: t.Number(),
    b2: t.Number(),
    rest: t.Number(),
    webdav: t.Number(),
    sftp: t.Number(),
    rclone: t.Number(),
    other: t.Number(),
  }),
});

const rusticSummarySchema = t.Object({
  workers: rusticWorkerStatsListSchema.properties.summary,
  repositories: repositoryStatsSchema,
});

const rusticEndpointsSchema = t.Object({
  endpoints: t.Object({
    workersStats: t.String(),
    workerStats: t.String(),
    summaryStats: t.String(),
    storageUsageStats: t.String(),
    repositoriesStats: t.String(),
    listRepositories: t.String(),
    createRepository: t.String(),
    getRepository: t.String(),
    updateRepository: t.String(),
    deleteRepository: t.String(),
    initRepository: t.String(),
    listRepositorySnapshots: t.String(),
    listRepositorySnapshotWorkers: t.String(),
    streamRepositorySnapshotUpdates: t.String(),
    streamRepositorySnapshotUpdatesWs: t.String(),
    listSnapshotFiles: t.String(),
    checkRepository: t.String(),
    repairRepositoryIndex: t.String(),
    triggerRepositoryBackup: t.String(),
    listBackupPlans: t.String(),
    createBackupPlan: t.String(),
    updateBackupPlan: t.String(),
    deleteBackupPlan: t.String(),
    listBackupPlanRuns: t.String(),
    listBackupEvents: t.String(),
    runBackupPlanNow: t.String(),
    openapiJson: t.String(),
    scalarDocs: t.String(),
  }),
});

const s3ConfigSchema = t.Object({
  endpoint: t.Optional(t.String({ minLength: 1, maxLength: 1024 })),
  bucket: t.String({ minLength: 1, maxLength: 255 }),
  prefix: t.Optional(t.String({ maxLength: 1024 })),
  region: t.Optional(t.String({ maxLength: 255 })),
  accessKeyId: t.Optional(t.String({ maxLength: 512 })),
  secretAccessKey: t.Optional(t.String({ maxLength: 2048 })),
  sessionToken: t.Optional(t.String({ maxLength: 4096 })),
  profile: t.Optional(t.String({ maxLength: 255 })),
  storageClass: t.Optional(t.String({ maxLength: 255 })),
  acl: t.Optional(t.String({ maxLength: 255 })),
  pathStyle: t.Optional(t.Boolean()),
  disableTls: t.Optional(t.Boolean()),
  noVerifySsl: t.Optional(t.Boolean()),
});

const createRepositoryBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  backend: t.Union(BACKEND_VALUES.map((value) => t.Literal(value))),
  repository: t.Optional(t.String({ minLength: 1, maxLength: 1024 })),
  primaryWorkerId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()])),
  backupWorkerIds: t.Optional(t.Array(t.String({ format: "uuid" }), { maxItems: 128 })),
  workerId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()])),
  password: t.Optional(t.String({ minLength: 1, maxLength: 1024 })),
  options: t.Optional(t.Record(t.String(), t.String())),
  s3: t.Optional(s3ConfigSchema),
});

const updateRepositoryBodySchema = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  backend: t.Optional(t.Union(BACKEND_VALUES.map((value) => t.Literal(value)))),
  repository: t.Optional(t.String({ minLength: 1, maxLength: 1024 })),
  primaryWorkerId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()])),
  backupWorkerIds: t.Optional(t.Array(t.String({ format: "uuid" }), { maxItems: 128 })),
  workerId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()])),
  password: t.Optional(t.Union([t.String({ minLength: 1, maxLength: 1024 }), t.Null()])),
  options: t.Optional(t.Record(t.String(), t.String())),
  s3: t.Optional(s3ConfigSchema),
});

const backupPlanSchema = t.Object({
  id: t.String({ format: "uuid" }),
  name: t.String(),
  cron: t.String(),
  workerIds: t.Array(t.String({ format: "uuid" })),
  paths: t.Array(t.String()),
  workerPathRules: t.Record(t.String({ format: "uuid" }), t.Array(t.String())),
  tags: t.Array(t.String()),
  dryRun: t.Boolean(),
  enabled: t.Boolean(),
  lastRunAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
  nextRunAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
  lastStatus: t.Union([t.String(), t.Null()]),
  lastError: t.Union([t.String(), t.Null()]),
  lastDurationMs: t.Union([t.Number(), t.Null()]),
  pruneEnabled: t.Boolean(),
  keepLast: t.Union([t.Number(), t.Null()]),
  keepDaily: t.Union([t.Number(), t.Null()]),
  keepWeekly: t.Union([t.Number(), t.Null()]),
  keepMonthly: t.Union([t.Number(), t.Null()]),
  keepYearly: t.Union([t.Number(), t.Null()]),
  keepWithin: t.Union([t.String(), t.Null()]),
  repository: t.Object({
    id: t.String({ format: "uuid" }),
    name: t.String(),
    backend: t.String(),
    worker: t.Union([
      t.Object({
        id: t.String({ format: "uuid" }),
        name: t.String(),
        isOnline: t.Boolean(),
        status: t.String(),
        lastSeenAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
      }),
      t.Null(),
    ]),
    primaryWorker: t.Union([
      t.Object({
        id: t.String({ format: "uuid" }),
        name: t.String(),
        isOnline: t.Boolean(),
        status: t.String(),
        lastSeenAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
      }),
      t.Null(),
    ]),
  }),
  workers: t.Array(
    t.Object({
      id: t.String({ format: "uuid" }),
      name: t.String(),
      isOnline: t.Boolean(),
      status: t.String(),
      lastSeenAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
    }),
  ),
  createdAt: t.String({ format: "date-time" }),
  updatedAt: t.String({ format: "date-time" }),
});

const backupPlanRunSchema = t.Object({
  id: t.String({ format: "uuid" }),
  planId: t.String({ format: "uuid" }),
  type: t.String(),
  status: t.String(),
  error: t.Union([t.String(), t.Null()]),
  durationMs: t.Union([t.Number(), t.Null()]),
  snapshotId: t.Union([t.String(), t.Null()]),
  snapshotTime: t.Union([t.String({ format: "date-time" }), t.Null()]),
  startedAt: t.String({ format: "date-time" }),
  finishedAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
  createdAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
});

const backupEventSchema = t.Object({
  id: t.String({ format: "uuid" }),
  userId: t.String(),
  repositoryId: t.String({ format: "uuid" }),
  planId: t.Union([t.String({ format: "uuid" }), t.Null()]),
  runId: t.Union([t.String({ format: "uuid" }), t.Null()]),
  workerId: t.Union([t.String({ format: "uuid" }), t.Null()]),
  type: t.String(),
  status: t.String(),
  severity: t.String(),
  message: t.String(),
  details: t.Optional(t.Record(t.String(), t.Any())),
  createdAt: t.String({ format: "date-time" }),
  resolvedAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
});

const createBackupPlanBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  repositoryId: t.String({ format: "uuid" }),
  workerIds: t.Array(t.String({ format: "uuid" }), { minItems: 1, maxItems: 128 }),
  cron: t.String({ minLength: 1, maxLength: 120 }),
  paths: t.Array(t.String({ minLength: 1, maxLength: 2048 }), { maxItems: 64 }),
  workerPathRules: t.Optional(
    t.Record(
      t.String({ format: "uuid" }),
      t.Array(t.String({ minLength: 1, maxLength: 2048 }), { minItems: 1, maxItems: 64 }),
    ),
  ),
  tags: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 120 }), { maxItems: 32 })),
  dryRun: t.Optional(t.Boolean()),
  enabled: t.Optional(t.Boolean()),
  pruneEnabled: t.Optional(t.Boolean()),
  keepLast: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  keepDaily: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  keepWeekly: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  keepMonthly: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  keepYearly: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  keepWithin: t.Optional(t.Union([t.String({ maxLength: 64 }), t.Null()])),
});

const updateBackupPlanBodySchema = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  repositoryId: t.Optional(t.String({ format: "uuid" })),
  workerIds: t.Optional(t.Array(t.String({ format: "uuid" }), { minItems: 1, maxItems: 128 })),
  cron: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  paths: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 2048 }), { maxItems: 64 })),
  workerPathRules: t.Optional(
    t.Record(
      t.String({ format: "uuid" }),
      t.Array(t.String({ minLength: 1, maxLength: 2048 }), { minItems: 1, maxItems: 64 }),
    ),
  ),
  tags: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 120 }), { maxItems: 32 })),
  dryRun: t.Optional(t.Boolean()),
  enabled: t.Optional(t.Boolean()),
  pruneEnabled: t.Optional(t.Union([t.Boolean(), t.Null()])),
  keepLast: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  keepDaily: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  keepWeekly: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  keepMonthly: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  keepYearly: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  keepWithin: t.Optional(t.Union([t.String({ maxLength: 64 }), t.Null()])),
});

const repositorySnapshotFilesBodySchema = t.Object({
  snapshot: t.String({ minLength: 1, maxLength: 512 }),
  path: t.Optional(t.String({ maxLength: 2048 })),
  workerId: t.Optional(t.String({ format: "uuid" })),
});

const repositoryMaintenanceBodySchema = t.Object({
  workerId: t.Optional(t.String({ format: "uuid" })),
});

const repositoryBackupBodySchema = t.Object({
  workerId: t.String({ format: "uuid" }),
  paths: t.Array(t.String({ minLength: 1, maxLength: 2048 }), { minItems: 1, maxItems: 64 }),
  tags: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 120 }), { maxItems: 32 })),
  dryRun: t.Optional(t.Boolean()),
});

const snapshotWorkerPreviewSchema = t.Object({
  id: t.String({ format: "uuid" }),
  name: t.String(),
  status: t.String(),
  isOnline: t.Boolean(),
  lastSeenAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
});

const repositorySnapshotWorkerAttributionSchema = t.Object({
  snapshotId: t.String(),
  sourceSnapshotIds: t.Array(t.String()),
  snapshotShortId: t.String(),
  snapshotTime: t.Union([t.String({ format: "date-time" }), t.Null()]),
  runGroupIds: t.Array(t.String()),
  workerIds: t.Array(t.String({ format: "uuid" })),
  workers: t.Array(snapshotWorkerPreviewSchema),
  runCount: t.Number(),
  successCount: t.Number(),
  failureCount: t.Number(),
  lastRunAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
});

const repositorySnapshotActivitySchema = t.Object({
  id: t.String(),
  kind: t.Union([t.Literal("running"), t.Literal("pending")]),
  status: t.Union([t.Literal("running"), t.Literal("pending")]),
  planId: t.Union([t.String({ format: "uuid" }), t.Null()]),
  planName: t.Union([t.String(), t.Null()]),
  workerId: t.Union([t.String({ format: "uuid" }), t.Null()]),
  workerName: t.Union([t.String(), t.Null()]),
  startedAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
  nextRunAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
  elapsedMs: t.Union([t.Number(), t.Null()]),
  estimatedTotalMs: t.Union([t.Number(), t.Null()]),
  progressPercent: t.Union([t.Number(), t.Null()]),
  phase: t.Union([t.String(), t.Null()]),
  currentPath: t.Union([t.String(), t.Null()]),
  filesDone: t.Union([t.Number(), t.Null()]),
  filesTotal: t.Union([t.Number(), t.Null()]),
  bytesDone: t.Union([t.Number(), t.Null()]),
  bytesTotal: t.Union([t.Number(), t.Null()]),
  lastEventAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
  message: t.String(),
});

type WorkerStatsRecord = {
  id: string;
  name: string;
  status: string;
  lastSeenAt: Date | null;
  uptimeMs: number;
  requestsTotal: number;
  errorTotal: number;
  syncTokenHash: string | null;
};

type RepositoryRecord = {
  id: string;
  primaryWorkerId: string | null;
  name: string;
  backend: string;
  repository: string;
  initializedAt: Date | null;
  password: string | null;
  optionsJson: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type BackupPlanRecord = {
  id: string;
  userId: string;
  repositoryId: string;
  workerId: string;
  name: string;
  cron: string;
  pathsJson: string;
  tagsJson: string | null;
  dryRun: boolean;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  pruneEnabled: boolean;
  keepLast: number | null;
  keepDaily: number | null;
  keepWeekly: number | null;
  keepMonthly: number | null;
  keepYearly: number | null;
  keepWithin: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type BackupPlanRunRecord = {
  id: string;
  planId: string;
  userId: string;
  repositoryId: string;
  workerId: string | null;
  runGroupId: string | null;
  type: string;
  status: string;
  error: string | null;
  durationMs: number | null;
  snapshotId: string | null;
  snapshotTime: Date | null;
  outputJson: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

type PlanWorkerRecord = {
  id: string;
  name: string;
  status: string;
  lastSeenAt: Date | null;
};

type WorkerPreviewRecord = {
  id: string;
  name: string;
  status: string;
  lastSeenAt: Date | null;
};

type BackupEventRecord = {
  id: string;
  userId: string;
  repositoryId: string;
  planId: string | null;
  runId: string | null;
  workerId: string | null;
  type: string;
  status: string;
  severity: string;
  message: string;
  detailsJson: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

type RusticWorkerStats = typeof rusticWorkerStatsSchema.static;
type RusticRepository = typeof rusticRepositorySchema.static;
type RusticBackupPlan = typeof backupPlanSchema.static;
type RusticBackupPlanRun = typeof backupPlanRunSchema.static;
type S3Config = typeof s3ConfigSchema.static;

type PlanPathsConfig = {
  defaultPaths: string[];
  workerPaths: Record<string, string[]>;
};

function truthyString(value: string | undefined) {
  return value?.trim() || undefined;
}

function boolToString(value: boolean | undefined) {
  if (value === undefined) {
    return undefined;
  }
  return value ? "true" : "false";
}

function buildS3RepositoryPath(config: S3Config) {
  const endpoint = (truthyString(config.endpoint) || "https://s3.amazonaws.com").replace(
    /\/+$/,
    "",
  );
  const bucket = config.bucket.trim().replace(/^\/+|\/+$/g, "");
  const prefix = (config.prefix || "").trim().replace(/^\/+|\/+$/g, "");

  return `s3:${endpoint}/${bucket}${prefix ? `/${prefix}` : ""}`;
}

function normalizeRcloneRepository(
  repositoryPath: string,
  repositoryId: string,
  options: Record<string, string>,
) {
  const trimmedPath = repositoryPath.trim();
  const remoteFromOption = options["rclone.remote"]?.trim() || null;

  if (trimmedPath.startsWith("rclone:")) {
    const rest = trimmedPath.slice("rclone:".length);
    const separatorIndex = rest.indexOf(":");
    const remoteFromPath = separatorIndex >= 0 ? rest.slice(0, separatorIndex).trim() : "";
    const remote = remoteFromOption || remoteFromPath || `glare-${repositoryId.slice(0, 8)}`;
    options["rclone.remote"] = remote;
    return trimmedPath;
  }

  const remote = remoteFromOption || `glare-${repositoryId.slice(0, 8)}`;
  const normalizedPath = trimmedPath.replace(/^\/+/, "");
  options["rclone.remote"] = remote;
  return `rclone:${remote}:${normalizedPath}`;
}

function hasRcloneOptions(options: Record<string, string>) {
  return Object.keys(options).some(
    (key) => key === "rclone.type" || key.startsWith("rclone.config."),
  );
}

function hasLegacyS3Options(options: Record<string, string>) {
  return Object.keys(options).some((key) => key.startsWith("s3."));
}

function enrichRcloneOptionsFromS3(options: Record<string, string>) {
  const next = { ...options };
  if (!next["rclone.type"]) {
    next["rclone.type"] = "s3";
  }

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

  for (const [source, target] of mappings) {
    if (!next[source]) continue;
    const rcloneKey = `rclone.config.${target}`;
    if (!next[rcloneKey]) {
      next[rcloneKey] = next[source];
    }
  }

  if (next["s3.path-style"] === "true" && !next["rclone.config.force_path_style"]) {
    next["rclone.config.force_path_style"] = "true";
  }
  if (next["s3.disable-tls"] === "true" && !next["rclone.config.disable_http2"]) {
    next["rclone.config.disable_http2"] = "true";
  }
  if (next["s3.no-verify-ssl"] === "true" && !next["rclone.config.no_check_certificate"]) {
    next["rclone.config.no_check_certificate"] = "true";
  }

  if (!next["rclone.config.provider"]) {
    const endpoint = next["s3.endpoint"]?.toLowerCase() || "";
    if (endpoint.includes("r2.cloudflarestorage.com")) {
      next["rclone.config.provider"] = "Cloudflare";
    } else {
      next["rclone.config.provider"] = "AWS";
    }
  }

  return next;
}

function deriveRcloneRepositoryForInit(
  repositoryPath: string,
  repositoryId: string,
  options: Record<string, string>,
) {
  if (repositoryPath.startsWith("rclone:")) {
    return normalizeRcloneRepository(repositoryPath, repositoryId, options);
  }

  const remote = options["rclone.remote"]?.trim() || `glare-${repositoryId.slice(0, 8)}`;
  options["rclone.remote"] = remote;

  if (repositoryPath.startsWith("s3:")) {
    const bucketFromOptions = options["s3.bucket"]?.trim().replace(/^\/+|\/+$/g, "") || "";
    const prefixFromOptions = options["s3.prefix"]?.trim().replace(/^\/+|\/+$/g, "") || "";
    if (bucketFromOptions) {
      return `rclone:${remote}:${bucketFromOptions}${prefixFromOptions ? `/${prefixFromOptions}` : ""}`;
    }

    const raw = repositoryPath.slice("s3:".length).trim();
    let pathPart = raw;
    try {
      if (raw.includes("://")) {
        pathPart = new URL(raw).pathname;
      } else if (raw.includes("/")) {
        pathPart = raw.slice(raw.indexOf("/"));
      }
    } catch {
      pathPart = raw;
    }
    pathPart = pathPart.replace(/^\/+|\/+$/g, "");
    return `rclone:${remote}:${pathPart}`;
  }

  return normalizeRcloneRepository(repositoryPath, repositoryId, options);
}

function mergeS3Options(base: Record<string, string> | undefined, config: S3Config | undefined) {
  const nextOptions: Record<string, string> = { ...(base ?? {}) };
  if (!config) {
    return nextOptions;
  }

  const s3OptionPairs: Array<[string, string | undefined]> = [
    ["s3.endpoint", truthyString(config.endpoint)],
    ["s3.bucket", truthyString(config.bucket)],
    ["s3.prefix", truthyString(config.prefix)],
    ["s3.region", truthyString(config.region)],
    ["s3.access-key-id", truthyString(config.accessKeyId)],
    ["s3.secret-access-key", truthyString(config.secretAccessKey)],
    ["s3.session-token", truthyString(config.sessionToken)],
    ["s3.profile", truthyString(config.profile)],
    ["s3.storage-class", truthyString(config.storageClass)],
    ["s3.acl", truthyString(config.acl)],
    ["s3.path-style", boolToString(config.pathStyle ?? true)],
    ["s3.disable-tls", boolToString(config.disableTls)],
    ["s3.no-verify-ssl", boolToString(config.noVerifySsl)],
  ];

  for (const [key, value] of s3OptionPairs) {
    if (value !== undefined) {
      nextOptions[key] = value;
    }
  }

  return nextOptions;
}

function toPercent(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }

  return Number(((numerator / denominator) * 100).toFixed(2));
}

function isWorkerOnline(lastSeenAt: Date | null) {
  return (
    lastSeenAt !== null && Date.now() - new Date(lastSeenAt).getTime() <= WORKER_ONLINE_THRESHOLD_MS
  );
}

function mapRusticWorkerStats(record: WorkerStatsRecord): RusticWorkerStats {
  return {
    id: record.id,
    name: record.name,
    workerStatus: record.status,
    isOnline: isWorkerOnline(record.lastSeenAt),
    lastSeenAt: record.lastSeenAt ? record.lastSeenAt.toISOString() : null,
    uptimeMs: record.uptimeMs,
    requestsTotal: record.requestsTotal,
    errorTotal: record.errorTotal,
    errorRatePercent: toPercent(record.errorTotal, record.requestsTotal),
    syncEnabled: Boolean(record.syncTokenHash),
  };
}

function parseOptionsJson(optionsJson: string | null): Record<string, string> {
  if (!optionsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(optionsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const nextOptions: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        nextOptions[key] = value;
      }
    }
    return nextOptions;
  } catch {
    return {};
  }
}

function parseStringArrayJson(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function normalizePaths(paths: string[]) {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
}

function parsePlanPathsConfig(value: string | null): PlanPathsConfig {
  if (!value) {
    return { defaultPaths: [], workerPaths: {} };
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    // Legacy format: simple array of paths shared by all workers.
    if (Array.isArray(parsed)) {
      return {
        defaultPaths: normalizePaths(
          parsed.filter((item): item is string => typeof item === "string"),
        ),
        workerPaths: {},
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return { defaultPaths: [], workerPaths: {} };
    }

    const record = parsed as Record<string, unknown>;
    const defaultPaths = Array.isArray(record.defaultPaths)
      ? normalizePaths(
          record.defaultPaths.filter((item): item is string => typeof item === "string"),
        )
      : [];
    const workerPaths: Record<string, string[]> = {};
    const rawWorkerPaths = record.workerPaths;
    if (rawWorkerPaths && typeof rawWorkerPaths === "object" && !Array.isArray(rawWorkerPaths)) {
      for (const [workerId, workerValue] of Object.entries(
        rawWorkerPaths as Record<string, unknown>,
      )) {
        if (!Array.isArray(workerValue)) continue;
        const nextPaths = normalizePaths(
          workerValue.filter((item): item is string => typeof item === "string"),
        );
        if (nextPaths.length > 0) {
          workerPaths[workerId] = nextPaths;
        }
      }
    }

    return { defaultPaths, workerPaths };
  } catch {
    return { defaultPaths: [], workerPaths: {} };
  }
}

function serializePlanPathsConfig(config: PlanPathsConfig) {
  return JSON.stringify({
    defaultPaths: normalizePaths(config.defaultPaths),
    workerPaths: Object.fromEntries(
      Object.entries(config.workerPaths)
        .map(([workerId, paths]) => [workerId, normalizePaths(paths)] as const)
        .filter(([, paths]) => paths.length > 0),
    ),
  });
}

function sanitizeWorkerPathRules(
  rules: Record<string, string[]> | undefined,
  allowedWorkerIds: string[],
) {
  const allowedSet = new Set(allowedWorkerIds);
  const nextRules: Record<string, string[]> = {};

  if (!rules) {
    return { ok: true as const, rules: nextRules };
  }

  for (const [workerId, rawPaths] of Object.entries(rules)) {
    if (!allowedSet.has(workerId)) {
      return {
        ok: false as const,
        error: `Worker path rule contains unknown worker id: ${workerId}`,
      };
    }
    const paths = normalizePaths(rawPaths);
    if (paths.length === 0) {
      continue;
    }
    nextRules[workerId] = paths;
  }

  return { ok: true as const, rules: nextRules };
}

function hasAnyPlanPaths(config: PlanPathsConfig) {
  if (config.defaultPaths.length > 0) return true;
  return Object.values(config.workerPaths).some((paths) => paths.length > 0);
}

function resolvePathsForWorker(config: PlanPathsConfig, workerId: string) {
  const workerSpecific = config.workerPaths[workerId];
  if (workerSpecific && workerSpecific.length > 0) {
    return workerSpecific;
  }
  return config.defaultPaths;
}

function normalizeSnapshotId(snapshotId: string) {
  return snapshotId.trim().toLowerCase();
}

function snapshotShortId(snapshotId: string) {
  const normalized = normalizeSnapshotId(snapshotId);
  return normalized.slice(0, 8);
}

function parseSnapshotDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Treat large numbers as ms epoch, smaller as seconds epoch.
    const epochMs = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(epochMs);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function collectSnapshotRefs(
  value: unknown,
  refs: Array<{ snapshotId: string; snapshotTime: Date | null }>,
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSnapshotRefs(item, refs);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const candidateId =
    (typeof record.snapshot_id === "string" && record.snapshot_id) ||
    (typeof record.short_id === "string" && record.short_id) ||
    (typeof record.id === "string" && record.id) ||
    null;
  const candidateTime =
    parseSnapshotDate(record.time) ??
    parseSnapshotDate(record.timestamp) ??
    parseSnapshotDate(record.datetime);
  const hasSnapshotHints =
    "snapshot_id" in record ||
    "short_id" in record ||
    "time" in record ||
    "timestamp" in record ||
    "datetime" in record ||
    "paths" in record ||
    "summary" in record ||
    "tree" in record ||
    "parent" in record;

  if (candidateId && hasSnapshotHints) {
    refs.push({
      snapshotId: candidateId,
      snapshotTime: candidateTime,
    });
  }

  for (const nested of Object.values(record)) {
    if (Array.isArray(nested) || (nested && typeof nested === "object")) {
      collectSnapshotRefs(nested, refs);
    }
  }
}

function extractSnapshotRefsFromRun(
  outputJson: string | null,
  fallbackSnapshotId: string | null,
  fallbackSnapshotTime: Date | null,
) {
  const refs: Array<{ snapshotId: string; snapshotTime: Date | null }> = [];

  if (outputJson) {
    try {
      const parsed = JSON.parse(outputJson) as unknown;
      collectSnapshotRefs(parsed, refs);
    } catch {
      // Keep fallback-only behavior for malformed persisted output.
    }
  }

  if (refs.length === 0) {
    if (!fallbackSnapshotId) {
      return [];
    }
    return [
      {
        snapshotId: fallbackSnapshotId,
        snapshotTime: fallbackSnapshotTime,
      },
    ];
  }

  refs.sort((a, b) => {
    const aMs = a.snapshotTime?.getTime() ?? -1;
    const bMs = b.snapshotTime?.getTime() ?? -1;
    return bMs - aMs;
  });

  // A single run should attribute to one primary snapshot; returning all
  // discovered refs can inflate historical counts when worker output includes
  // snapshot listings.
  return [refs[0]!];
}

function extractPrimarySnapshotRefFromProxyData(proxyData: unknown) {
  const refs: Array<{ snapshotId: string; snapshotTime: Date | null }> = [];
  collectSnapshotRefs(proxyData, refs);
  if (refs.length === 0) return null;

  refs.sort((a, b) => {
    const aMs = a.snapshotTime?.getTime() ?? 0;
    const bMs = b.snapshotTime?.getTime() ?? 0;
    return bMs - aMs;
  });
  return refs[0]!;
}

function extractLatestSnapshotRefFromProxyData(proxyData: unknown) {
  const refs: Array<{ snapshotId: string; snapshotTime: Date | null }> = [];
  collectSnapshotRefs(proxyData, refs);
  if (refs.length === 0) return null;

  refs.sort((a, b) => {
    const aMs = a.snapshotTime?.getTime() ?? 0;
    const bMs = b.snapshotTime?.getTime() ?? 0;
    return bMs - aMs;
  });
  return refs[0]!;
}

type SnapshotFileEntry = {
  path: string;
  kind: "file" | "dir";
};

function extractSnapshotFileEntries(raw: unknown): SnapshotFileEntry[] {
  const entries: SnapshotFileEntry[] = [];
  const seen = new Set<string>();
  const stack: unknown[] = [raw];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (typeof current !== "object") continue;

    const record = current as Record<string, unknown>;
    const path =
      (typeof record.path === "string" && record.path) ||
      (typeof record.file === "string" && record.file) ||
      (typeof record.name === "string" && record.name) ||
      null;
    if (path) {
      const normalized = path.trim().replace(/^\/+/, "");
      if (normalized.length > 0 && !seen.has(normalized)) {
        const typeValue = `${record.type ?? record.kind ?? record.node_type ?? ""}`.toLowerCase();
        const kind: "file" | "dir" =
          typeValue.includes("dir") || typeValue.includes("tree") || typeValue === "d"
            ? "dir"
            : "file";
        seen.add(normalized);
        entries.push({ path: normalized, kind });
      }
    }

    for (const value of Object.values(record)) {
      if (value && (Array.isArray(value) || typeof value === "object")) {
        stack.push(value);
      }
    }
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function extractSnapshotRefFromDetailsJson(detailsJson: string | null) {
  if (!detailsJson) return null;
  try {
    const parsed = JSON.parse(detailsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const snapshotId = typeof record.snapshotId === "string" ? record.snapshotId : null;
    if (!snapshotId) return null;
    const snapshotTime = parseSnapshotDate(record.snapshotTime);
    return { snapshotId, snapshotTime };
  } catch {
    return null;
  }
}

function parseCronField(raw: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  const chunks = raw.split(",");

  for (const chunkRaw of chunks) {
    const chunk = chunkRaw.trim();
    if (!chunk) return null;

    const [baseMaybe, stepRaw] = chunk.split("/");
    const baseRaw = baseMaybe ?? "*";
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step <= 0) return null;

    let rangeMin = min;
    let rangeMax = max;
    if (baseRaw !== "*") {
      if (baseRaw.includes("-")) {
        const [startRaw, endRaw] = baseRaw.split("-");
        const start = Number(startRaw);
        const end = Number(endRaw);
        if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
        rangeMin = start;
        rangeMax = end;
      } else {
        const single = Number(baseRaw);
        if (!Number.isInteger(single)) return null;
        rangeMin = single;
        rangeMax = single;
      }
    }

    if (rangeMin < min || rangeMax > max || rangeMin > rangeMax) return null;
    for (let value = rangeMin; value <= rangeMax; value += step) {
      values.add(value);
    }
  }

  return values;
}

function parseCronExpression(cron: string) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minuteField = parts[0] ?? "";
  const hourField = parts[1] ?? "";
  const dayOfMonthField = parts[2] ?? "";
  const monthField = parts[3] ?? "";
  const dayOfWeekField = parts[4] ?? "";

  const minute = parseCronField(minuteField, 0, 59);
  const hour = parseCronField(hourField, 0, 23);
  const dayOfMonth = parseCronField(dayOfMonthField, 1, 31);
  const month = parseCronField(monthField, 1, 12);
  const dayOfWeek = parseCronField(dayOfWeekField, 0, 6);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;

  const isDayOfMonthWildcard = dayOfMonthField === "*";
  const isDayOfWeekWildcard = dayOfWeekField === "*";

  return { minute, hour, dayOfMonth, month, dayOfWeek, isDayOfMonthWildcard, isDayOfWeekWildcard };
}

function cronMatchesDate(date: Date, parsed: NonNullable<ReturnType<typeof parseCronExpression>>) {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();

  if (!parsed.minute.has(minute) || !parsed.hour.has(hour) || !parsed.month.has(month))
    return false;

  const domMatch = parsed.dayOfMonth.has(dayOfMonth);
  const dowMatch = parsed.dayOfWeek.has(dayOfWeek);
  if (parsed.isDayOfMonthWildcard && parsed.isDayOfWeekWildcard) return true;
  if (parsed.isDayOfMonthWildcard) return dowMatch;
  if (parsed.isDayOfWeekWildcard) return domMatch;
  return domMatch || dowMatch;
}

function computeNextRun(cron: string, from: Date) {
  const parsed = parseCronExpression(cron);
  if (!parsed) return null;

  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 366; i += 1) {
    if (cronMatchesDate(cursor, parsed)) {
      return new Date(cursor);
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

function isAlreadyInitializedMessage(message: string | null | undefined) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("already initialized") || normalized.includes("already exists");
}

function mapWorkerPreview(worker: WorkerPreviewRecord) {
  return {
    id: worker.id,
    name: worker.name,
    status: worker.status,
    isOnline: isWorkerOnline(worker.lastSeenAt),
    lastSeenAt: worker.lastSeenAt ? worker.lastSeenAt.toISOString() : null,
  };
}

function mapRepository(
  record: RepositoryRecord,
  workerById: Map<string, WorkerPreviewRecord>,
  backupWorkerIdsByRepositoryId: Map<string, string[]>,
): RusticRepository {
  const primaryWorker = record.primaryWorkerId
    ? (workerById.get(record.primaryWorkerId) ?? null)
    : null;
  const initializedAt = record.initializedAt ? record.initializedAt.toISOString() : null;
  const backupWorkers = (backupWorkerIdsByRepositoryId.get(record.id) ?? [])
    .map((id) => workerById.get(id))
    .filter((worker): worker is WorkerPreviewRecord => Boolean(worker))
    .map(mapWorkerPreview);

  return {
    id: record.id,
    name: record.name,
    backend: record.backend,
    repository: record.repository,
    isInitialized: Boolean(initializedAt),
    initializedAt,
    hasPassword: Boolean(record.password),
    options: parseOptionsJson(record.optionsJson),
    primaryWorker: primaryWorker ? mapWorkerPreview(primaryWorker) : null,
    worker: primaryWorker ? mapWorkerPreview(primaryWorker) : null,
    backupWorkers,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapBackupPlan(
  record: BackupPlanRecord,
  repositoryById: Map<string, RusticRepository>,
  workerById: Map<string, PlanWorkerRecord>,
  workerIdsByPlanId: Map<string, string[]>,
): RusticBackupPlan | null {
  const repository = repositoryById.get(record.repositoryId);
  if (!repository) return null;
  const mappedWorkerIds = workerIdsByPlanId.get(record.id) ?? [record.workerId];
  const workers = mappedWorkerIds
    .map((workerId) => workerById.get(workerId))
    .filter((worker): worker is PlanWorkerRecord => Boolean(worker));
  if (workers.length === 0) return null;
  const pathsConfig = parsePlanPathsConfig(record.pathsJson);

  return {
    id: record.id,
    name: record.name,
    cron: record.cron,
    workerIds: workers.map((worker) => worker.id),
    paths: pathsConfig.defaultPaths,
    workerPathRules: pathsConfig.workerPaths,
    tags: parseStringArrayJson(record.tagsJson),
    dryRun: record.dryRun,
    enabled: record.enabled,
    lastRunAt: record.lastRunAt ? record.lastRunAt.toISOString() : null,
    nextRunAt: record.nextRunAt ? record.nextRunAt.toISOString() : null,
    lastStatus: record.lastStatus,
    lastError: record.lastError,
    lastDurationMs: record.lastDurationMs,
    pruneEnabled: record.pruneEnabled,
    keepLast: record.keepLast,
    keepDaily: record.keepDaily,
    keepWeekly: record.keepWeekly,
    keepMonthly: record.keepMonthly,
    keepYearly: record.keepYearly,
    keepWithin: record.keepWithin,
    repository: {
      id: repository.id,
      name: repository.name,
      backend: repository.backend,
      worker: repository.primaryWorker,
      primaryWorker: repository.primaryWorker,
    },
    workers: workers.map(mapWorkerPreview),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapBackupPlanRun(record: BackupPlanRunRecord): RusticBackupPlanRun {
  return {
    id: record.id,
    planId: record.planId,
    type: record.type,
    status: record.status,
    error: record.error,
    durationMs: record.durationMs,
    snapshotId: record.snapshotId,
    snapshotTime: record.snapshotTime ? record.snapshotTime.toISOString() : null,
    startedAt: record.startedAt.toISOString(),
    finishedAt: record.finishedAt ? record.finishedAt.toISOString() : null,
    createdAt: record.startedAt.toISOString(),
  };
}

function mapBackupEvent(record: BackupEventRecord): typeof backupEventSchema.static {
  let details: Record<string, unknown> | undefined;
  if (record.detailsJson) {
    try {
      const parsed = JSON.parse(record.detailsJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        details = parsed as Record<string, unknown>;
      }
    } catch {
      details = undefined;
    }
  }

  return {
    id: record.id,
    userId: record.userId,
    repositoryId: record.repositoryId,
    planId: record.planId,
    runId: record.runId,
    workerId: record.workerId,
    type: record.type,
    status: record.status,
    severity: record.severity,
    message: record.message,
    details,
    createdAt: record.createdAt.toISOString(),
    resolvedAt: record.resolvedAt ? record.resolvedAt.toISOString() : null,
  };
}

function buildWorkerSummary(workers: RusticWorkerStats[]) {
  const totalRequests = workers.reduce(
    (accumulator, current) => accumulator + current.requestsTotal,
    0,
  );
  const totalErrors = workers.reduce((accumulator, current) => accumulator + current.errorTotal, 0);
  const onlineWorkers = workers.filter((current) => current.isOnline).length;
  const degradedWorkers = workers.filter((current) => current.workerStatus === "degraded").length;

  return {
    totalWorkers: workers.length,
    onlineWorkers,
    degradedWorkers,
    offlineWorkers: workers.length - onlineWorkers,
    totalRequests,
    totalErrors,
    averageErrorRatePercent: toPercent(totalErrors, totalRequests),
  };
}

function buildRepositorySummary(repositories: RusticRepository[]) {
  const byBackend = {
    local: 0,
    s3: 0,
    b2: 0,
    rest: 0,
    webdav: 0,
    sftp: 0,
    rclone: 0,
    other: 0,
  };

  for (const repository of repositories) {
    if (repository.backend in byBackend) {
      byBackend[repository.backend as keyof typeof byBackend] += 1;
    } else {
      byBackend.other += 1;
    }
  }

  const linkedWorkers = repositories.reduce(
    (accumulator, repository) => accumulator + repository.backupWorkers.length,
    0,
  );

  return {
    totalRepositories: repositories.length,
    linkedWorkers,
    unlinkedRepositories: repositories.filter((repository) => repository.backupWorkers.length === 0)
      .length,
    byBackend,
  };
}

async function getWorkerStatsForUser(userId: string) {
  const workerRecords = await db.query.worker.findMany({
    where: (table, { eq }) => eq(table.userId, userId),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    columns: {
      id: true,
      name: true,
      status: true,
      lastSeenAt: true,
      uptimeMs: true,
      requestsTotal: true,
      errorTotal: true,
      syncTokenHash: true,
    },
  });

  const workers = workerRecords.map(mapRusticWorkerStats);
  return { workers, summary: buildWorkerSummary(workers) };
}

async function getBackupWorkerIdsByRepositoryIds(repositoryIds: string[]) {
  if (repositoryIds.length === 0) {
    return new Map<string, string[]>();
  }

  const rows = await db
    .select({
      repositoryId: rusticRepositoryBackupWorker.repositoryId,
      workerId: rusticRepositoryBackupWorker.workerId,
    })
    .from(rusticRepositoryBackupWorker)
    .where(inArray(rusticRepositoryBackupWorker.repositoryId, repositoryIds));

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const next = map.get(row.repositoryId) ?? [];
    next.push(row.workerId);
    map.set(row.repositoryId, next);
  }
  return map;
}

async function getPlanWorkerIdsByPlanIds(planIds: string[]) {
  if (planIds.length === 0) {
    return new Map<string, string[]>();
  }

  const rows = await db
    .select({
      planId: backupPlanWorker.planId,
      workerId: backupPlanWorker.workerId,
    })
    .from(backupPlanWorker)
    .where(inArray(backupPlanWorker.planId, planIds));

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const next = map.get(row.planId) ?? [];
    next.push(row.workerId);
    map.set(row.planId, next);
  }
  return map;
}

async function getWorkerPreviewByIdsForUser(userId: string, workerIds: string[]) {
  const uniqueWorkerIds = Array.from(new Set(workerIds));
  if (uniqueWorkerIds.length === 0) {
    return new Map<string, WorkerPreviewRecord>();
  }

  const workers = await db
    .select({
      id: workerTable.id,
      name: workerTable.name,
      status: workerTable.status,
      lastSeenAt: workerTable.lastSeenAt,
    })
    .from(workerTable)
    .where(and(eq(workerTable.userId, userId), inArray(workerTable.id, uniqueWorkerIds)));

  return new Map(workers.map((worker) => [worker.id, worker] as const));
}

async function getRepositoriesForUser(userId: string) {
  const repositoryRecords = await db.query.rusticRepository.findMany({
    where: (table, { eq }) => eq(table.userId, userId),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    columns: {
      id: true,
      workerId: true,
      name: true,
      backend: true,
      repository: true,
      initializedAt: true,
      password: true,
      optionsJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const repositoryIds = repositoryRecords.map((repositoryRecord) => repositoryRecord.id);
  const backupWorkerIdsByRepositoryId = await getBackupWorkerIdsByRepositoryIds(repositoryIds);
  const workerIds = repositoryRecords
    .map((repositoryRecord) => repositoryRecord.workerId)
    .filter((workerId): workerId is string => Boolean(workerId));
  for (const ids of backupWorkerIdsByRepositoryId.values()) {
    workerIds.push(...ids);
  }

  const workerById = await getWorkerPreviewByIdsForUser(userId, workerIds);
  return repositoryRecords.map((repositoryRecord) =>
    mapRepository(
      { ...repositoryRecord, primaryWorkerId: repositoryRecord.workerId },
      workerById,
      backupWorkerIdsByRepositoryId,
    ),
  );
}

async function getRepositoryByIdForUser(userId: string, repositoryId: string) {
  const repositoryRecord = await db.query.rusticRepository.findFirst({
    where: (table, { and, eq }) => and(eq(table.id, repositoryId), eq(table.userId, userId)),
    columns: {
      id: true,
      workerId: true,
      name: true,
      backend: true,
      repository: true,
      initializedAt: true,
      password: true,
      optionsJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!repositoryRecord) {
    return null;
  }

  const backupWorkerIdsByRepositoryId = await getBackupWorkerIdsByRepositoryIds([
    repositoryRecord.id,
  ]);
  const workerIds = repositoryRecord.workerId ? [repositoryRecord.workerId] : [];
  workerIds.push(...(backupWorkerIdsByRepositoryId.get(repositoryRecord.id) ?? []));
  const workerById = await getWorkerPreviewByIdsForUser(userId, workerIds);
  return mapRepository(
    { ...repositoryRecord, primaryWorkerId: repositoryRecord.workerId },
    workerById,
    backupWorkerIdsByRepositoryId,
  );
}

async function resolveOwnedWorkerIds(userId: string, workerIds: string[]) {
  const uniqueWorkerIds = Array.from(new Set(workerIds));
  if (uniqueWorkerIds.length === 0) {
    return [];
  }

  for (const workerId of uniqueWorkerIds) {
    const parsedWorkerId = workerIdSchema.safeParse(workerId);
    if (!parsedWorkerId.success) {
      throw new Error("Invalid worker id");
    }
  }

  const ownedWorkers = await db
    .select({ id: workerTable.id })
    .from(workerTable)
    .where(and(eq(workerTable.userId, userId), inArray(workerTable.id, uniqueWorkerIds)));

  if (ownedWorkers.length !== uniqueWorkerIds.length) {
    throw new Error("Worker not found");
  }

  return uniqueWorkerIds;
}

async function replaceBackupWorkers(repositoryId: string, workerIds: string[]) {
  await db
    .delete(rusticRepositoryBackupWorker)
    .where(eq(rusticRepositoryBackupWorker.repositoryId, repositoryId));
  if (workerIds.length === 0) {
    return;
  }
  await db.insert(rusticRepositoryBackupWorker).values(
    workerIds.map((workerId) => ({
      repositoryId,
      workerId,
    })),
  );
}

async function replacePlanWorkers(planId: string, workerIds: string[]) {
  await db.delete(backupPlanWorker).where(eq(backupPlanWorker.planId, planId));
  if (workerIds.length === 0) {
    return;
  }
  await db.insert(backupPlanWorker).values(
    workerIds.map((workerId) => ({
      planId,
      workerId,
    })),
  );
}

async function getBackupPlansForUser(userId: string) {
  const [planRecords, repositories] = await Promise.all([
    db.query.backupPlan.findMany({
      where: (table, { eq }) => eq(table.userId, userId),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      columns: {
        id: true,
        userId: true,
        repositoryId: true,
        workerId: true,
        name: true,
        cron: true,
        pathsJson: true,
        tagsJson: true,
        dryRun: true,
        enabled: true,
        lastRunAt: true,
        nextRunAt: true,
        lastStatus: true,
        lastError: true,
        lastDurationMs: true,
        pruneEnabled: true,
        keepLast: true,
        keepDaily: true,
        keepWeekly: true,
        keepMonthly: true,
        keepYearly: true,
        keepWithin: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    getRepositoriesForUser(userId),
  ]);

  const repositoryById = new Map(
    repositories.map((repository) => [repository.id, repository] as const),
  );
  const workerIdsByPlanId = await getPlanWorkerIdsByPlanIds(
    planRecords.map((planRecord) => planRecord.id),
  );
  for (const planRecord of planRecords) {
    const existing = workerIdsByPlanId.get(planRecord.id);
    if (!existing || existing.length === 0) {
      workerIdsByPlanId.set(planRecord.id, [planRecord.workerId]);
    }
  }

  const allPlanWorkerIds = Array.from(workerIdsByPlanId.values()).flat();
  const workerById = await getWorkerPreviewByIdsForUser(userId, allPlanWorkerIds);
  return planRecords
    .map((record) => mapBackupPlan(record, repositoryById, workerById, workerIdsByPlanId))
    .filter((record): record is RusticBackupPlan => record !== null);
}

async function getBackupPlanRunsForUserPlan(userId: string, planId: string, limit = 50) {
  const runRecords = await db.query.backupPlanRun.findMany({
    where: (table, { and: dbAnd, eq: dbEq }) =>
      dbAnd(dbEq(table.userId, userId), dbEq(table.planId, planId)),
    orderBy: (table, { desc }) => [desc(table.startedAt)],
    limit,
    columns: {
      id: true,
      planId: true,
      userId: true,
      repositoryId: true,
      workerId: true,
      runGroupId: true,
      type: true,
      status: true,
      error: true,
      durationMs: true,
      snapshotId: true,
      snapshotTime: true,
      outputJson: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  return runRecords.map(mapBackupPlanRun);
}

async function getBackupEventsForUser(
  userId: string,
  filters: { repositoryId?: string; planId?: string; status?: string; limit?: number },
) {
  const rows = await db.query.backupEvent.findMany({
    where: (table, { and: dbAnd, eq: dbEq }) =>
      dbAnd(
        dbEq(table.userId, userId),
        filters.repositoryId ? dbEq(table.repositoryId, filters.repositoryId) : undefined,
        filters.planId ? dbEq(table.planId, filters.planId) : undefined,
        filters.status ? dbEq(table.status, filters.status) : undefined,
      ),
    orderBy: (table, { desc: dbDesc }) => [dbDesc(table.createdAt)],
    limit: filters.limit,
    columns: {
      id: true,
      userId: true,
      repositoryId: true,
      planId: true,
      runId: true,
      workerId: true,
      type: true,
      status: true,
      severity: true,
      message: true,
      detailsJson: true,
      createdAt: true,
      resolvedAt: true,
    },
  });
  return rows.map((row) => mapBackupEvent(row));
}

async function getRepositorySnapshotWorkerAttributionsForUser(
  userId: string,
  repositoryId: string,
) {
  const runs = await db.query.backupPlanRun.findMany({
    where: (table, { and: dbAnd, eq: dbEq }) =>
      dbAnd(
        dbEq(table.userId, userId),
        dbEq(table.repositoryId, repositoryId),
        dbEq(table.type, "backup"),
      ),
    orderBy: (table, { desc }) => [desc(table.startedAt)],
    limit: 1000,
    columns: {
      workerId: true,
      runGroupId: true,
      status: true,
      snapshotId: true,
      snapshotTime: true,
      outputJson: true,
      startedAt: true,
    },
  });

  const workerIds = runs
    .map((run) => run.workerId)
    .filter((workerId): workerId is string => Boolean(workerId));
  const workerById = await getWorkerPreviewByIdsForUser(userId, workerIds);

  const bySnapshot = new Map<
    string,
    {
      snapshotId: string;
      snapshotTime: Date | null;
      runGroupIds: Set<string>;
      workerIds: Set<string>;
      runCount: number;
      successCount: number;
      failureCount: number;
      lastRunAt: Date | null;
    }
  >();

  for (const run of runs) {
    if (!run.workerId) continue;
    const refs = extractSnapshotRefsFromRun(run.outputJson, run.snapshotId, run.snapshotTime);
    for (const ref of refs) {
      const key = normalizeSnapshotId(ref.snapshotId);
      const existing = bySnapshot.get(key);
      if (!existing) {
        bySnapshot.set(key, {
          snapshotId: ref.snapshotId,
          snapshotTime: ref.snapshotTime,
          runGroupIds: run.runGroupId ? new Set([run.runGroupId]) : new Set<string>(),
          workerIds: new Set([run.workerId]),
          runCount: 1,
          successCount: run.status === "success" ? 1 : 0,
          failureCount: run.status === "success" ? 0 : 1,
          lastRunAt: run.startedAt,
        });
        continue;
      }

      existing.workerIds.add(run.workerId);
      if (run.runGroupId) {
        existing.runGroupIds.add(run.runGroupId);
      }
      existing.runCount += 1;
      if (run.status === "success") {
        existing.successCount += 1;
      } else {
        existing.failureCount += 1;
      }
      const existingTimeMs = existing.snapshotTime?.getTime() ?? -1;
      const nextTimeMs = ref.snapshotTime?.getTime() ?? -1;
      if (nextTimeMs > existingTimeMs) {
        existing.snapshotTime = ref.snapshotTime;
      }
      const existingLastRunMs = existing.lastRunAt?.getTime() ?? -1;
      const nextLastRunMs = run.startedAt.getTime();
      if (nextLastRunMs > existingLastRunMs) {
        existing.lastRunAt = run.startedAt;
      }
    }
  }

  const events = await db.query.backupEvent.findMany({
    where: (table, { and: dbAnd, eq: dbEq }) =>
      dbAnd(dbEq(table.userId, userId), dbEq(table.repositoryId, repositoryId)),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    limit: 1000,
    columns: {
      workerId: true,
      type: true,
      status: true,
      detailsJson: true,
      createdAt: true,
    },
  });

  for (const event of events) {
    if (!event.workerId) continue;
    const ref = extractSnapshotRefFromDetailsJson(event.detailsJson);
    if (!ref) continue;

    const key = normalizeSnapshotId(ref.snapshotId);
    const existing = bySnapshot.get(key);
    if (existing) {
      // Snapshot already tracked from runs – skip to avoid inflating counts/workers
      continue;
    }

    // Snapshot not seen in any run – create entry from event only
    const isSuccess = event.type === "manual_backup_completed" || event.status === "resolved";
    bySnapshot.set(key, {
      snapshotId: ref.snapshotId,
      snapshotTime: ref.snapshotTime,
      runGroupIds: new Set<string>(),
      workerIds: new Set([event.workerId]),
      runCount: 1,
      successCount: isSuccess ? 1 : 0,
      failureCount: isSuccess ? 0 : 1,
      lastRunAt: event.createdAt,
    });
  }

  const groupedByExecution = new Map<
    string,
    {
      snapshotId: string;
      sourceSnapshotIds: Set<string>;
      snapshotTime: Date | null;
      runGroupIds: Set<string>;
      workerIds: Set<string>;
      runCount: number;
      successCount: number;
      failureCount: number;
      lastRunAt: Date | null;
    }
  >();

  for (const entry of bySnapshot.values()) {
    const runGroupKey =
      entry.runGroupIds.size > 0
        ? `rungroups:${Array.from(entry.runGroupIds).sort().join(",")}`
        : `snapshot:${normalizeSnapshotId(entry.snapshotId)}`;
    const existing = groupedByExecution.get(runGroupKey);
    if (!existing) {
      groupedByExecution.set(runGroupKey, {
        snapshotId: entry.snapshotId,
        sourceSnapshotIds: new Set([entry.snapshotId]),
        snapshotTime: entry.snapshotTime,
        runGroupIds: new Set(entry.runGroupIds),
        workerIds: new Set(entry.workerIds),
        runCount: entry.runCount,
        successCount: entry.successCount,
        failureCount: entry.failureCount,
        lastRunAt: entry.lastRunAt,
      });
      continue;
    }

    for (const runGroupId of entry.runGroupIds) {
      existing.runGroupIds.add(runGroupId);
    }
    existing.sourceSnapshotIds.add(entry.snapshotId);
    for (const workerId of entry.workerIds) {
      existing.workerIds.add(workerId);
    }
    existing.runCount += entry.runCount;
    existing.successCount += entry.successCount;
    existing.failureCount += entry.failureCount;

    const existingSnapshotMs = existing.snapshotTime?.getTime() ?? -1;
    const nextSnapshotMs = entry.snapshotTime?.getTime() ?? -1;
    if (
      nextSnapshotMs > existingSnapshotMs ||
      (nextSnapshotMs === existingSnapshotMs &&
        normalizeSnapshotId(entry.snapshotId) > normalizeSnapshotId(existing.snapshotId))
    ) {
      existing.snapshotId = entry.snapshotId;
      existing.snapshotTime = entry.snapshotTime;
    }

    const existingLastRunMs = existing.lastRunAt?.getTime() ?? -1;
    const nextLastRunMs = entry.lastRunAt?.getTime() ?? -1;
    if (nextLastRunMs > existingLastRunMs) {
      existing.lastRunAt = entry.lastRunAt;
    }
  }

  const snapshots = Array.from(groupedByExecution.values())
    .map((entry) => {
      const workerIdsForSnapshot = Array.from(entry.workerIds);
      const workers = workerIdsForSnapshot
        .map((workerId) => workerById.get(workerId))
        .filter((worker): worker is WorkerPreviewRecord => Boolean(worker))
        .map(mapWorkerPreview);
      const mergedRunCount = entry.runGroupIds.size > 0 ? entry.runGroupIds.size : entry.runCount;
      const mergedSuccessCount =
        entry.runGroupIds.size > 0
          ? Math.min(mergedRunCount, entry.successCount)
          : entry.successCount;
      const mergedFailureCount =
        entry.runGroupIds.size > 0
          ? Math.min(mergedRunCount, entry.failureCount)
          : entry.failureCount;
      return {
        snapshotId: entry.snapshotId,
        sourceSnapshotIds: Array.from(entry.sourceSnapshotIds),
        snapshotShortId: snapshotShortId(entry.snapshotId),
        snapshotTime: entry.snapshotTime ? entry.snapshotTime.toISOString() : null,
        runGroupIds: Array.from(entry.runGroupIds),
        workerIds: workerIdsForSnapshot,
        workers,
        runCount: mergedRunCount,
        successCount: mergedSuccessCount,
        failureCount: mergedFailureCount,
        lastRunAt: entry.lastRunAt ? entry.lastRunAt.toISOString() : null,
      };
    })
    .sort((a, b) => {
      const aMs = a.snapshotTime ? new Date(a.snapshotTime).getTime() : 0;
      const bMs = b.snapshotTime ? new Date(b.snapshotTime).getTime() : 0;
      return bMs - aMs;
    });

  return { snapshots };
}

async function getRepositorySnapshotActivityForUser(userId: string, repositoryId: string) {
  const now = Date.now();

  const activeRuns = await db.query.backupPlanRun.findMany({
    where: (table, { and: dbAnd, eq: dbEq, inArray: dbInArray }) =>
      dbAnd(
        dbEq(table.userId, userId),
        dbEq(table.repositoryId, repositoryId),
        dbInArray(table.status, ["running", "pending"]),
      ),
    orderBy: (table, { desc: dbDesc }) => [dbDesc(table.startedAt)],
    limit: 100,
    columns: {
      id: true,
      planId: true,
      workerId: true,
      status: true,
      startedAt: true,
    },
  });

  const runningRuns = activeRuns.filter((run) => run.status === "running");

  const activePlanIds = Array.from(new Set(activeRuns.map((run) => run.planId)));
  const activeWorkerIds = Array.from(
    new Set(
      activeRuns
        .map((run) => run.workerId)
        .filter((workerId): workerId is string => Boolean(workerId)),
    ),
  );

  const [activePlans, workerById] = await Promise.all([
    activePlanIds.length > 0
      ? db
          .select({
            id: backupPlan.id,
            name: backupPlan.name,
            lastDurationMs: backupPlan.lastDurationMs,
            nextRunAt: backupPlan.nextRunAt,
          })
          .from(backupPlan)
          .where(and(eq(backupPlan.userId, userId), inArray(backupPlan.id, activePlanIds)))
      : Promise.resolve([]),
    getWorkerPreviewByIdsForUser(userId, activeWorkerIds),
  ]);
  const activePlanById = new Map(activePlans.map((plan) => [plan.id, plan] as const));

  const activeRunIds = activeRuns.map((run) => run.id);
  const latestEventByRunId = new Map<
    string,
    { message: string; createdAt: Date; details: Record<string, unknown> | null }
  >();
  if (activeRunIds.length > 0) {
    const runningEvents = await db.query.backupEvent.findMany({
      where: (table, { and: dbAnd, eq: dbEq, inArray: dbInArray }) =>
        dbAnd(
          dbEq(table.userId, userId),
          dbEq(table.repositoryId, repositoryId),
          dbInArray(table.runId, activeRunIds),
        ),
      orderBy: (table, { desc: dbDesc }) => [dbDesc(table.createdAt)],
      limit: 500,
      columns: {
        runId: true,
        message: true,
        detailsJson: true,
        createdAt: true,
      },
    });

    for (const event of runningEvents) {
      if (!event.runId || latestEventByRunId.has(event.runId)) continue;
      let details: Record<string, unknown> | null = null;
      if (event.detailsJson) {
        try {
          const parsed = JSON.parse(event.detailsJson) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            details = parsed as Record<string, unknown>;
          }
        } catch {
          details = null;
        }
      }
      latestEventByRunId.set(event.runId, {
        message: event.message,
        createdAt: event.createdAt,
        details,
      });
    }
  }

  const toNumber = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const runningActivities = runningRuns.map((run) => {
    const plan = activePlanById.get(run.planId) ?? null;
    const worker = run.workerId ? (workerById.get(run.workerId) ?? null) : null;
    const latestEvent = latestEventByRunId.get(run.id) ?? null;
    const details = latestEvent?.details ?? null;
    const elapsedMs = Math.max(0, now - run.startedAt.getTime());
    const estimatedTotalMs =
      plan?.lastDurationMs && plan.lastDurationMs > 0 ? plan.lastDurationMs : null;
    const derivedProgressPercent = estimatedTotalMs
      ? Math.max(1, Math.min(95, Math.round((elapsedMs / estimatedTotalMs) * 100)))
      : null;
    const rawProgressPercent =
      toNumber(details?.progressPercent) ??
      toNumber(details?.progress) ??
      toNumber(details?.percent);
    const progressPercent =
      rawProgressPercent !== null
        ? Math.max(0, Math.min(100, rawProgressPercent))
        : derivedProgressPercent;
    const phase =
      typeof details?.phase === "string"
        ? details.phase
        : typeof details?.stage === "string"
          ? details.stage
          : typeof details?.step === "string"
            ? details.step
            : null;
    const currentPath =
      typeof details?.currentPath === "string"
        ? details.currentPath
        : typeof details?.currentFile === "string"
          ? details.currentFile
          : typeof details?.path === "string"
            ? details.path
            : typeof details?.file === "string"
              ? details.file
              : null;
    const filesDone =
      toNumber(details?.filesDone) ??
      toNumber(details?.filesProcessed) ??
      toNumber(details?.processedFiles);
    const filesTotal = toNumber(details?.filesTotal) ?? toNumber(details?.totalFiles);
    const bytesDone =
      toNumber(details?.bytesDone) ??
      toNumber(details?.bytesProcessed) ??
      toNumber(details?.processedBytes);
    const bytesTotal = toNumber(details?.bytesTotal) ?? toNumber(details?.totalBytes);
    const message =
      typeof details?.message === "string"
        ? details.message
        : latestEvent?.message || `Running backup${worker?.name ? ` on ${worker.name}` : ""}`;

    return {
      id: `running:${run.id}`,
      kind: "running" as const,
      status: "running" as const,
      planId: run.planId,
      planName: plan?.name ?? null,
      workerId: run.workerId ?? null,
      workerName: worker?.name ?? null,
      startedAt: run.startedAt.toISOString(),
      nextRunAt: plan?.nextRunAt ? plan.nextRunAt.toISOString() : null,
      elapsedMs,
      estimatedTotalMs,
      progressPercent,
      phase,
      currentPath,
      filesDone,
      filesTotal,
      bytesDone,
      bytesTotal,
      lastEventAt: latestEvent ? latestEvent.createdAt.toISOString() : null,
      message,
    };
  });

  const scheduledPlans = await db.query.backupPlan.findMany({
    where: (table, { and: dbAnd, eq: dbEq }) =>
      dbAnd(
        dbEq(table.userId, userId),
        dbEq(table.repositoryId, repositoryId),
        dbEq(table.enabled, true),
      ),
    orderBy: (table, { asc: dbAsc }) => [dbAsc(table.nextRunAt)],
    limit: 100,
    columns: {
      id: true,
      name: true,
      nextRunAt: true,
    },
  });

  const pendingActivities = scheduledPlans
    .filter((plan) => plan.nextRunAt && plan.nextRunAt.getTime() > now)
    .filter((plan) => !activePlanIds.includes(plan.id))
    .slice(0, 20)
    .map((plan) => ({
      id: `pending:${plan.id}:${plan.nextRunAt!.toISOString()}`,
      kind: "pending" as const,
      status: "pending" as const,
      planId: plan.id,
      planName: plan.name,
      workerId: null,
      workerName: null,
      startedAt: null,
      nextRunAt: plan.nextRunAt!.toISOString(),
      elapsedMs: null,
      estimatedTotalMs: null,
      progressPercent: 0,
      phase: null,
      currentPath: null,
      filesDone: null,
      filesTotal: null,
      bytesDone: null,
      bytesTotal: null,
      lastEventAt: null,
      message: "Scheduled backup pending",
    }));

  return { activities: [...runningActivities, ...pendingActivities] };
}

type ProxyError = { error: string; status: number };
type ProxySuccess = { worker: { id: string; endpoint: string; syncToken: string } };

async function getWorkerForProxy(
  userId: string,
  workerId: string,
): Promise<ProxyError | ProxySuccess> {
  const parsedWorkerId = workerIdSchema.safeParse(workerId);
  if (!parsedWorkerId.success) {
    logWarn("proxy worker validation failed: invalid worker id", { userId, workerId });
    return { error: "Invalid worker id", status: 400 };
  }

  const workerRecord = await db.query.worker.findFirst({
    where: (table, { and: dbAnd, eq: dbEq }) =>
      dbAnd(dbEq(table.id, parsedWorkerId.data), dbEq(table.userId, userId)),
    columns: {
      id: true,
      endpoint: true,
      syncToken: true,
      lastSeenAt: true,
    },
  });

  if (!workerRecord) {
    logWarn("proxy worker lookup failed: worker not found", {
      userId,
      workerId: parsedWorkerId.data,
    });
    return { error: "Worker not found", status: 404 };
  }

  if (!workerRecord.endpoint) {
    logWarn("proxy worker unavailable: missing endpoint", {
      userId,
      workerId: workerRecord.id,
      endpoint: workerRecord.endpoint,
      hasSyncToken: Boolean(workerRecord.syncToken),
      lastSeenAt: workerRecord.lastSeenAt ? workerRecord.lastSeenAt.toISOString() : null,
    });
    return { error: "Worker has no registered endpoint", status: 502 };
  }

  if (!workerRecord.syncToken) {
    logWarn("proxy worker unavailable: missing sync token", { userId, workerId: workerRecord.id });
    return { error: "Worker has no sync token for proxy auth", status: 502 };
  }

  if (!isWorkerOnline(workerRecord.lastSeenAt)) {
    logWarn("proxy worker unavailable: offline", {
      userId,
      workerId: workerRecord.id,
      endpoint: workerRecord.endpoint,
      lastSeenAt: workerRecord.lastSeenAt ? workerRecord.lastSeenAt.toISOString() : null,
    });
    return { error: "Worker is offline", status: 502 };
  }

  return {
    worker: {
      id: workerRecord.id,
      endpoint: workerRecord.endpoint,
      syncToken: workerRecord.syncToken,
    },
  };
}

async function getAnyHealthyWorkerForProxy(userId: string): Promise<ProxyError | ProxySuccess> {
  const onlineThreshold = new Date(Date.now() - WORKER_ONLINE_THRESHOLD_MS);

  const workerRecord = await db.query.worker.findFirst({
    where: (table, { and: dbAnd, eq: dbEq }) =>
      dbAnd(
        dbEq(table.userId, userId),
        isNotNull(table.endpoint),
        isNotNull(table.syncToken),
        gte(table.lastSeenAt, onlineThreshold),
      ),
    columns: {
      id: true,
      endpoint: true,
      syncToken: true,
    },
  });

  if (!workerRecord) {
    logWarn("no healthy worker available for proxy", { userId });
    return { error: "No healthy worker available", status: 502 };
  }

  return {
    worker: {
      id: workerRecord.id,
      endpoint: workerRecord.endpoint!,
      syncToken: workerRecord.syncToken!,
    },
  };
}

async function proxyToWorker(
  endpoint: string,
  syncToken: string,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
) {
  const url = `${endpoint.replace(/\/+$/, "")}${path}`;

  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${syncToken}`,
      "Content-Type": "application/json",
    },
  };

  if (body !== undefined && method === "POST") {
    init.body = JSON.stringify(body);
  }

  logInfo("proxy request", { method, url, hasBody: body !== undefined });
  const response = await fetch(url, init);
  const responseText = await response.text();
  let data: unknown = null;
  if (responseText.length > 0) {
    try {
      data = JSON.parse(responseText) as unknown;
    } catch {
      logWarn("proxy response was not valid JSON", { method, url, status: response.status });
      data = { raw: responseText };
    }
  }
  logInfo("proxy response", { method, url, status: response.status });

  return { status: response.status, data };
}

let backupPlanSchedulerStarted = false;
let backupPlanSchedulerRunning = false;
const planRunLeaseOwner = `server-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const PLAN_RUN_LEASE_MS = 2 * 60 * 1000;

async function acquireBackupPlanLease(planId: string, leaseMs = PLAN_RUN_LEASE_MS) {
  const leaseUntil = new Date(Date.now() + leaseMs);
  const result = await db.execute(sql`
    update backup_plan
    set run_lease_until = ${leaseUntil}, run_lease_owner = ${planRunLeaseOwner}
    where id = ${planId}
      and (
        run_lease_until is null
        or run_lease_until < now()
        or run_lease_owner = ${planRunLeaseOwner}
      )
    returning id
  `);
  return Boolean((result as { rows?: unknown[] }).rows?.length);
}

async function releaseBackupPlanLease(planId: string) {
  await db.execute(sql`
    update backup_plan
    set run_lease_until = null, run_lease_owner = null
    where id = ${planId} and run_lease_owner = ${planRunLeaseOwner}
  `);
}

async function createBackupEvent(input: {
  userId: string;
  repositoryId: string;
  planId?: string | null;
  runId?: string | null;
  workerId?: string | null;
  type: string;
  status?: string;
  severity?: string;
  message: string;
  details?: Record<string, unknown>;
}) {
  await db.insert(backupEvent).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    repositoryId: input.repositoryId,
    planId: input.planId ?? null,
    runId: input.runId ?? null,
    workerId: input.workerId ?? null,
    type: input.type,
    status: input.status ?? "open",
    severity: input.severity ?? "error",
    message: input.message,
    detailsJson: input.details ? JSON.stringify(input.details) : null,
  });

  if ((input.severity ?? "error") === "error" || input.type.includes("failed")) {
    await sendDiscordNotification({
      userId: input.userId,
      category: "backup_failures",
      title: "Backup event reported",
      message: input.message,
      severity: "error",
      fields: [
        { name: "Type", value: input.type },
        { name: "Repository ID", value: input.repositoryId },
        ...(input.planId ? [{ name: "Plan ID", value: input.planId }] : []),
        ...(input.workerId ? [{ name: "Worker ID", value: input.workerId }] : []),
      ],
    });
  }
}

async function getBackupWorkerIdsForRepository(repositoryId: string) {
  const rows = await db
    .select({ workerId: rusticRepositoryBackupWorker.workerId })
    .from(rusticRepositoryBackupWorker)
    .where(eq(rusticRepositoryBackupWorker.repositoryId, repositoryId));
  return Array.from(new Set(rows.map((row) => row.workerId)));
}

function planHasRetentionPolicy(plan: BackupPlanRecord) {
  return (
    plan.pruneEnabled &&
    (plan.keepLast != null ||
      plan.keepDaily != null ||
      plan.keepWeekly != null ||
      plan.keepMonthly != null ||
      plan.keepYearly != null ||
      (plan.keepWithin != null && plan.keepWithin.trim().length > 0))
  );
}

async function enqueueBackupPlanRuns(plan: BackupPlanRecord) {
  const startedAtMs = Date.now();
  const startedAtDate = new Date();
  const runGroupId = crypto.randomUUID();
  const planPathsConfig = parsePlanPathsConfig(plan.pathsJson);
  const tags = parseStringArrayJson(plan.tagsJson);
  const nextRunAt = plan.enabled ? computeNextRun(plan.cron, startedAtDate) : null;

  if (!hasAnyPlanPaths(planPathsConfig)) {
    const durationMs = Date.now() - startedAtMs;
    await db
      .update(backupPlan)
      .set({
        lastRunAt: startedAtDate,
        nextRunAt,
        lastStatus: "failed",
        lastError: "No backup paths configured",
        lastDurationMs: durationMs,
      })
      .where(eq(backupPlan.id, plan.id));
    await createBackupEvent({
      userId: plan.userId,
      repositoryId: plan.repositoryId,
      planId: plan.id,
      runId: null,
      workerId: null,
      type: "backup_failed",
      message: "No backup paths configured",
      details: { reason: "empty_paths" },
    });
    return;
  }

  const repository = await db.query.rusticRepository.findFirst({
    where: (table, { and: dbAnd, eq: dbEq }) =>
      dbAnd(dbEq(table.id, plan.repositoryId), dbEq(table.userId, plan.userId)),
    columns: {
      id: true,
      name: true,
      backend: true,
      repository: true,
      password: true,
      optionsJson: true,
    },
  });

  if (!repository) {
    const durationMs = Date.now() - startedAtMs;
    await db
      .update(backupPlan)
      .set({
        lastRunAt: startedAtDate,
        nextRunAt,
        lastStatus: "failed",
        lastError: "Repository not found",
        lastDurationMs: durationMs,
      })
      .where(eq(backupPlan.id, plan.id));
    await createBackupEvent({
      userId: plan.userId,
      repositoryId: plan.repositoryId,
      planId: plan.id,
      runId: null,
      workerId: null,
      type: "backup_failed",
      message: "Repository not found",
      details: { reason: "repository_not_found" },
    });
    return;
  }

  const planWorkerRows = await db
    .select({ workerId: backupPlanWorker.workerId })
    .from(backupPlanWorker)
    .where(eq(backupPlanWorker.planId, plan.id));
  const planWorkerIds =
    planWorkerRows.length > 0
      ? Array.from(new Set(planWorkerRows.map((row) => row.workerId)))
      : [plan.workerId];

  const backupWorkerIds = await getBackupWorkerIdsForRepository(repository.id);
  const validWorkerIds = planWorkerIds.filter((workerId) => backupWorkerIds.includes(workerId));
  const invalidWorkerIds = planWorkerIds.filter((workerId) => !backupWorkerIds.includes(workerId));

  for (const invalidWorkerId of invalidWorkerIds) {
    await createBackupEvent({
      userId: plan.userId,
      repositoryId: repository.id,
      planId: plan.id,
      runId: null,
      workerId: invalidWorkerId,
      type: "backup_failed",
      message: "Plan worker is not attached to repository backup workers",
      details: { reason: "worker_not_attached_to_repository", workerId: invalidWorkerId },
    });
  }

  if (validWorkerIds.length === 0) {
    const durationMs = Date.now() - startedAtMs;
    await db
      .update(backupPlan)
      .set({
        lastRunAt: startedAtDate,
        nextRunAt,
        lastStatus: "failed",
        lastError: "No plan workers are attached to repository backup workers",
        lastDurationMs: durationMs,
      })
      .where(eq(backupPlan.id, plan.id));
    return;
  }

  const rawOptions = parseOptionsJson(repository.optionsJson);
  const backupOptions = hasRcloneOptions(rawOptions)
    ? rawOptions
    : repository.backend === "s3" && hasLegacyS3Options(rawOptions)
      ? enrichRcloneOptionsFromS3(rawOptions)
      : rawOptions;
  const shouldForceRcloneBackup =
    repository.backend === "rclone" ||
    (repository.backend === "s3" &&
      (hasRcloneOptions(backupOptions) || hasLegacyS3Options(backupOptions)));
  const backupBackend = shouldForceRcloneBackup ? "rclone" : repository.backend;
  const backupRepository = shouldForceRcloneBackup
    ? deriveRcloneRepositoryForInit(repository.repository, repository.id, backupOptions)
    : repository.repository;

  let enqueuedCount = 0;
  let firstQueueError: string | null = null;

  for (const workerId of validWorkerIds) {
    const workerPaths = resolvePathsForWorker(planPathsConfig, workerId);
    const runId = crypto.randomUUID();

    if (workerPaths.length === 0) {
      const errorMessage = "No backup paths configured for worker";
      if (!firstQueueError) firstQueueError = errorMessage;
      await db.insert(backupPlanRun).values({
        id: runId,
        planId: plan.id,
        userId: plan.userId,
        repositoryId: plan.repositoryId,
        workerId,
        runGroupId,
        status: "failed",
        error: errorMessage,
        startedAt: new Date(),
        finishedAt: new Date(),
      });
      await createBackupEvent({
        userId: plan.userId,
        repositoryId: repository.id,
        planId: plan.id,
        runId,
        workerId,
        type: "backup_failed",
        message: errorMessage,
        details: { workerId, reason: "worker_paths_missing" },
      });
      continue;
    }

    const requestPayload = {
      backend: backupBackend,
      options: backupOptions,
      repository: backupRepository,
      password: repository.password ?? undefined,
      paths: workerPaths,
      tags: tags.length > 0 ? tags : undefined,
      dryRun: plan.dryRun,
    };

    await db.insert(backupPlanRun).values({
      id: runId,
      planId: plan.id,
      userId: plan.userId,
      repositoryId: plan.repositoryId,
      workerId,
      runGroupId,
      status: "pending",
      startedAt: new Date(),
      outputJson: JSON.stringify({ request: requestPayload }),
    });
    await createBackupEvent({
      userId: plan.userId,
      repositoryId: repository.id,
      planId: plan.id,
      runId,
      workerId,
      type: "backup_pending",
      status: "open",
      severity: "info",
      message: "Backup queued on worker",
      details: {
        phase: "queued",
        progressPercent: 0,
        workerId,
      },
    });
    enqueuedCount += 1;
  }

  const durationMs = Date.now() - startedAtMs;
  await db
    .update(backupPlan)
    .set({
      lastRunAt: startedAtDate,
      nextRunAt,
      lastStatus: enqueuedCount > 0 ? "running" : "failed",
      lastError: enqueuedCount > 0 ? null : firstQueueError || "Failed to enqueue worker runs",
      lastDurationMs: enqueuedCount > 0 ? null : durationMs,
    })
    .where(eq(backupPlan.id, plan.id));
}

async function executePruneForPlan(
  plan: BackupPlanRecord,
  repository: {
    id: string;
    name: string;
    backend: string;
    repository: string;
    password: string | null;
    optionsJson: string | null;
  },
) {
  if (!planHasRetentionPolicy(plan)) return;

  const pruneStartMs = Date.now();
  const pruneRunId = crypto.randomUUID();

  const rawOptions = parseOptionsJson(repository.optionsJson);
  const pruneOptions = hasRcloneOptions(rawOptions)
    ? rawOptions
    : repository.backend === "s3" && hasLegacyS3Options(rawOptions)
      ? enrichRcloneOptionsFromS3(rawOptions)
      : rawOptions;
  const shouldForceRclone =
    repository.backend === "rclone" ||
    (repository.backend === "s3" &&
      (hasRcloneOptions(pruneOptions) || hasLegacyS3Options(pruneOptions)));
  const pruneBackend = shouldForceRclone ? "rclone" : repository.backend;
  const pruneRepository = shouldForceRclone
    ? deriveRcloneRepositoryForInit(repository.repository, repository.id, pruneOptions)
    : repository.repository;

  // Pick the primary worker for this repository (or first plan worker)
  const backupWorkerIds = await getBackupWorkerIdsForRepository(repository.id);
  const planWorkerRows = await db
    .select({ workerId: backupPlanWorker.workerId })
    .from(backupPlanWorker)
    .where(eq(backupPlanWorker.planId, plan.id));
  const planWorkerIds =
    planWorkerRows.length > 0 ? planWorkerRows.map((row) => row.workerId) : [plan.workerId];
  const pruneWorkerId =
    planWorkerIds.find((id) => backupWorkerIds.includes(id)) ?? planWorkerIds[0]!;

  await db.insert(backupPlanRun).values({
    id: pruneRunId,
    planId: plan.id,
    userId: plan.userId,
    repositoryId: plan.repositoryId,
    workerId: pruneWorkerId,
    runGroupId: null,
    type: "prune",
    status: "running",
    startedAt: new Date(),
  });

  try {
    const proxyWorker = await getWorkerForProxy(plan.userId, pruneWorkerId);
    if ("error" in proxyWorker) {
      const durationMs = Date.now() - pruneStartMs;
      await db
        .update(backupPlanRun)
        .set({ status: "failed", error: proxyWorker.error, durationMs, finishedAt: new Date() })
        .where(eq(backupPlanRun.id, pruneRunId));
      await createBackupEvent({
        userId: plan.userId,
        repositoryId: repository.id,
        planId: plan.id,
        runId: pruneRunId,
        workerId: pruneWorkerId,
        type: "prune_failed",
        message: proxyWorker.error,
        details: { reason: "worker_unreachable" },
      });
      return;
    }

    const forgetBody: Record<string, unknown> = {
      backend: pruneBackend,
      options: pruneOptions,
      repository: pruneRepository,
      password: repository.password ?? undefined,
      prune: true,
    };
    if (plan.keepLast != null) forgetBody.keepLast = plan.keepLast;
    if (plan.keepDaily != null) forgetBody.keepDaily = plan.keepDaily;
    if (plan.keepWeekly != null) forgetBody.keepWeekly = plan.keepWeekly;
    if (plan.keepMonthly != null) forgetBody.keepMonthly = plan.keepMonthly;
    if (plan.keepYearly != null) forgetBody.keepYearly = plan.keepYearly;
    if (plan.keepWithin != null && plan.keepWithin.trim().length > 0)
      forgetBody.keepWithin = plan.keepWithin.trim();

    const proxy = await proxyToWorker(
      proxyWorker.worker.endpoint,
      proxyWorker.worker.syncToken,
      "/rustic/forget",
      "POST",
      forgetBody,
    );

    const rusticSuccess =
      proxy.data &&
      typeof proxy.data === "object" &&
      "rustic" in proxy.data &&
      typeof (proxy.data as { rustic?: { success?: boolean } }).rustic?.success === "boolean"
        ? Boolean((proxy.data as { rustic: { success: boolean } }).rustic.success)
        : proxy.status >= 200 && proxy.status < 300;

    const durationMs = Date.now() - pruneStartMs;
    const outputJson = proxy.data ? JSON.stringify(proxy.data) : null;

    if (rusticSuccess) {
      await db
        .update(backupPlanRun)
        .set({ status: "success", durationMs, outputJson, finishedAt: new Date() })
        .where(eq(backupPlanRun.id, pruneRunId));
    } else {
      const errorMessage =
        proxy.data && typeof proxy.data === "object" && "error" in proxy.data
          ? String((proxy.data as { error?: string }).error || "")
          : "Prune command failed";
      await db
        .update(backupPlanRun)
        .set({
          status: "failed",
          error: errorMessage,
          durationMs,
          outputJson,
          finishedAt: new Date(),
        })
        .where(eq(backupPlanRun.id, pruneRunId));
      await createBackupEvent({
        userId: plan.userId,
        repositoryId: repository.id,
        planId: plan.id,
        runId: pruneRunId,
        workerId: pruneWorkerId,
        type: "prune_failed",
        message: errorMessage,
        details: { status: proxy.status },
      });
    }
  } catch (error) {
    const durationMs = Date.now() - pruneStartMs;
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db
      .update(backupPlanRun)
      .set({ status: "failed", error: errorMessage, durationMs, finishedAt: new Date() })
      .where(eq(backupPlanRun.id, pruneRunId));
    await createBackupEvent({
      userId: plan.userId,
      repositoryId: repository.id,
      planId: plan.id,
      runId: pruneRunId,
      workerId: pruneWorkerId,
      type: "prune_failed",
      message: errorMessage,
    });
  }
}

async function executeBackupPlan(plan: BackupPlanRecord) {
  const startedAtMs = Date.now();
  const startedAtDate = new Date();
  const runGroupId = crypto.randomUUID();
  const planPathsConfig = parsePlanPathsConfig(plan.pathsJson);
  const tags = parseStringArrayJson(plan.tagsJson);
  const nextRunAt = plan.enabled ? computeNextRun(plan.cron, startedAtDate) : null;

  if (!hasAnyPlanPaths(planPathsConfig)) {
    const durationMs = Date.now() - startedAtMs;
    await db
      .update(backupPlan)
      .set({
        lastRunAt: startedAtDate,
        nextRunAt,
        lastStatus: "failed",
        lastError: "No backup paths configured",
        lastDurationMs: durationMs,
      })
      .where(eq(backupPlan.id, plan.id));
    await createBackupEvent({
      userId: plan.userId,
      repositoryId: plan.repositoryId,
      planId: plan.id,
      runId: null,
      workerId: null,
      type: "backup_failed",
      message: "No backup paths configured",
      details: { reason: "empty_paths" },
    });
    return;
  }

  const repository = await db.query.rusticRepository.findFirst({
    where: (table, { and: dbAnd, eq: dbEq }) =>
      dbAnd(dbEq(table.id, plan.repositoryId), dbEq(table.userId, plan.userId)),
    columns: {
      id: true,
      name: true,
      backend: true,
      repository: true,
      password: true,
      optionsJson: true,
    },
  });

  if (!repository) {
    const durationMs = Date.now() - startedAtMs;
    await db
      .update(backupPlan)
      .set({
        lastRunAt: startedAtDate,
        nextRunAt,
        lastStatus: "failed",
        lastError: "Repository not found",
        lastDurationMs: durationMs,
      })
      .where(eq(backupPlan.id, plan.id));
    await createBackupEvent({
      userId: plan.userId,
      repositoryId: plan.repositoryId,
      planId: plan.id,
      runId: null,
      workerId: null,
      type: "backup_failed",
      message: "Repository not found",
      details: { reason: "repository_not_found" },
    });
    return;
  }

  const planWorkerIds = await (async () => {
    const rows = await db
      .select({ workerId: backupPlanWorker.workerId })
      .from(backupPlanWorker)
      .where(eq(backupPlanWorker.planId, plan.id));
    const ids = Array.from(new Set(rows.map((row) => row.workerId)));
    return ids.length > 0 ? ids : [plan.workerId];
  })();

  const backupWorkerIds = await getBackupWorkerIdsForRepository(repository.id);
  const validWorkerIds = planWorkerIds.filter((workerId) => backupWorkerIds.includes(workerId));
  const invalidWorkerIds = planWorkerIds.filter((workerId) => !backupWorkerIds.includes(workerId));

  for (const invalidWorkerId of invalidWorkerIds) {
    await createBackupEvent({
      userId: plan.userId,
      repositoryId: repository.id,
      planId: plan.id,
      runId: null,
      workerId: invalidWorkerId,
      type: "backup_failed",
      message: "Plan worker is not attached to repository backup workers",
      details: { reason: "worker_not_attached_to_repository", workerId: invalidWorkerId },
    });
  }

  if (validWorkerIds.length === 0) {
    const durationMs = Date.now() - startedAtMs;
    await db
      .update(backupPlan)
      .set({
        lastRunAt: startedAtDate,
        nextRunAt,
        lastStatus: "failed",
        lastError: "No plan workers are attached to repository backup workers",
        lastDurationMs: durationMs,
      })
      .where(eq(backupPlan.id, plan.id));
    return;
  }

  const rawOptions = parseOptionsJson(repository.optionsJson);
  const backupOptions = hasRcloneOptions(rawOptions)
    ? rawOptions
    : repository.backend === "s3" && hasLegacyS3Options(rawOptions)
      ? enrichRcloneOptionsFromS3(rawOptions)
      : rawOptions;
  const shouldForceRcloneBackup =
    repository.backend === "rclone" ||
    (repository.backend === "s3" &&
      (hasRcloneOptions(backupOptions) || hasLegacyS3Options(backupOptions)));
  const backupBackend = shouldForceRcloneBackup ? "rclone" : repository.backend;
  const backupRepository = shouldForceRcloneBackup
    ? deriveRcloneRepositoryForInit(repository.repository, repository.id, backupOptions)
    : repository.repository;

  const runResults = await Promise.allSettled(
    validWorkerIds.map(async (workerId) => {
      const workerPaths = resolvePathsForWorker(planPathsConfig, workerId);
      const runId = crypto.randomUUID();
      const workerStartedAt = new Date();
      const workerStartedMs = Date.now();
      await db.insert(backupPlanRun).values({
        id: runId,
        planId: plan.id,
        userId: plan.userId,
        repositoryId: plan.repositoryId,
        workerId,
        runGroupId,
        status: "running",
        startedAt: workerStartedAt,
      });
      await createBackupEvent({
        userId: plan.userId,
        repositoryId: repository.id,
        planId: plan.id,
        runId,
        workerId,
        type: "backup_running",
        status: "open",
        severity: "info",
        message: "Backup started",
        details: {
          phase: "starting",
          progressPercent: 1,
          workerId,
        },
      });

      const proxyWorker = await getWorkerForProxy(plan.userId, workerId);
      if ("error" in proxyWorker) {
        const durationMs = Date.now() - workerStartedMs;
        await db
          .update(backupPlanRun)
          .set({
            status: "failed",
            error: proxyWorker.error,
            durationMs,
            finishedAt: new Date(),
          })
          .where(eq(backupPlanRun.id, runId));
        await createBackupEvent({
          userId: plan.userId,
          repositoryId: repository.id,
          planId: plan.id,
          runId,
          workerId,
          type: "worker_unreachable",
          message: proxyWorker.error,
          details: { workerId },
        });
        return { status: "failed" as const, error: proxyWorker.error };
      }

      let finalStatus: "success" | "failed" = "failed";
      let finalError: string | null = "Backup command failed";
      let outputJson: string | null = null;
      let runSnapshotId: string | null = null;
      let runSnapshotTime: Date | null = null;
      try {
        if (workerPaths.length === 0) {
          finalStatus = "failed";
          finalError = "No backup paths configured for worker";
          await createBackupEvent({
            userId: plan.userId,
            repositoryId: repository.id,
            planId: plan.id,
            runId,
            workerId,
            type: "backup_failed",
            message: finalError,
            details: { workerId, reason: "worker_paths_missing" },
          });
          const durationMs = Date.now() - workerStartedMs;
          await db
            .update(backupPlanRun)
            .set({
              status: finalStatus,
              error: finalError,
              durationMs,
              snapshotId: null,
              snapshotTime: null,
              outputJson: null,
              finishedAt: new Date(),
            })
            .where(eq(backupPlanRun.id, runId));
          return { status: finalStatus, error: finalError };
        }

        const proxy = await proxyToWorker(
          proxyWorker.worker.endpoint,
          proxyWorker.worker.syncToken,
          "/rustic/backup",
          "POST",
          {
            backend: backupBackend,
            options: backupOptions,
            repository: backupRepository,
            password: repository.password ?? undefined,
            paths: workerPaths,
            tags: tags.length > 0 ? tags : undefined,
            dryRun: plan.dryRun,
          },
        );

        const rusticSuccess =
          proxy.data &&
          typeof proxy.data === "object" &&
          "rustic" in proxy.data &&
          typeof (proxy.data as { rustic?: { success?: boolean } }).rustic?.success === "boolean"
            ? Boolean((proxy.data as { rustic: { success: boolean } }).rustic.success)
            : proxy.status >= 200 && proxy.status < 300;
        finalStatus = rusticSuccess ? "success" : "failed";
        const errorMessage =
          proxy.data && typeof proxy.data === "object" && "error" in proxy.data
            ? String((proxy.data as { error?: string }).error || "")
            : null;
        finalError = rusticSuccess ? null : errorMessage || "Backup command failed";
        outputJson = proxy.data ? JSON.stringify(proxy.data) : null;
        if (rusticSuccess) {
          const snapshotRef = extractPrimarySnapshotRefFromProxyData(proxy.data);
          runSnapshotId = snapshotRef?.snapshotId ?? null;
          runSnapshotTime = snapshotRef?.snapshotTime ?? null;
          await recordStorageUsageSample({
            userId: plan.userId,
            repositoryId: repository.id,
            runId,
            output: proxy.data,
          });
          const metric = await recordBackupMetric({
            runId,
            userId: plan.userId,
            repositoryId: repository.id,
            planId: plan.id,
            workerId,
            snapshotId: runSnapshotId,
            snapshotTime: runSnapshotTime,
            output: proxy.data,
          });
          if (metric) {
            const anomaly = await detectBackupSizeAnomaly({
              metricId: metric.id,
              userId: plan.userId,
              planId: plan.id,
              repositoryId: repository.id,
              actualBytes: metric.bytesAdded,
            });
            if (anomaly) {
              await createBackupEvent({
                userId: plan.userId,
                repositoryId: repository.id,
                planId: plan.id,
                runId,
                workerId,
                type: "backup_size_anomaly",
                status: "open",
                severity: anomaly.severity,
                message: `Backup size anomaly detected (${anomaly.reason})`,
                details: {
                  expectedBytes: anomaly.expectedBytes,
                  actualBytes: metric.bytesAdded,
                  score: anomaly.score,
                },
              });
            }
          }
        }

        if (!rusticSuccess) {
          await createBackupEvent({
            userId: plan.userId,
            repositoryId: repository.id,
            planId: plan.id,
            runId,
            workerId,
            type: "backup_failed",
            message: finalError || "Backup command failed",
            details: { workerId, status: proxy.status },
          });
        }
      } catch (error) {
        finalStatus = "failed";
        finalError = error instanceof Error ? error.message : String(error);
        await createBackupEvent({
          userId: plan.userId,
          repositoryId: repository.id,
          planId: plan.id,
          runId,
          workerId,
          type: "worker_unreachable",
          message: finalError,
          details: { workerId },
        });
      }

      const durationMs = Date.now() - workerStartedMs;
      await db
        .update(backupPlanRun)
        .set({
          status: finalStatus,
          error: finalError,
          durationMs,
          snapshotId: runSnapshotId,
          snapshotTime: runSnapshotTime,
          outputJson,
          finishedAt: new Date(),
        })
        .where(eq(backupPlanRun.id, runId));

      if (finalStatus === "success") {
        await createBackupEvent({
          userId: plan.userId,
          repositoryId: repository.id,
          planId: plan.id,
          runId,
          workerId,
          type: "backup_completed",
          status: "resolved",
          severity: "info",
          message: "Backup completed",
          details: {
            phase: "completed",
            progressPercent: 100,
            snapshotId: runSnapshotId,
            snapshotTime: runSnapshotTime?.toISOString() ?? null,
            workerId,
          },
        });
      }
      return { status: finalStatus, error: finalError };
    }),
  );
  const runSummaries = runResults.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    const workerId = validWorkerIds[index] ?? null;
    logError("backup plan worker execution crashed", {
      planId: plan.id,
      workerId,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    return {
      status: "failed" as const,
      error: "Worker execution crashed before completion",
    };
  });

  const durationMs = Date.now() - startedAtMs;
  const successCount = runSummaries.filter((summary) => summary.status === "success").length;
  const failureCount = runSummaries.length - successCount;
  const finalStatus: "success" | "failed" = failureCount === 0 ? "success" : "failed";
  const finalError =
    failureCount === 0
      ? null
      : successCount === 0
        ? runSummaries.find((summary) => summary.error)?.error || "Backup command failed"
        : `${failureCount}/${runSummaries.length} workers failed`;

  try {
    await db
      .update(backupPlan)
      .set({
        lastRunAt: startedAtDate,
        nextRunAt,
        lastStatus: finalStatus,
        lastError: finalError,
        lastDurationMs: durationMs,
      })
      .where(eq(backupPlan.id, plan.id));
  } catch {
    // Run rows are already finalized. Keep scheduler resilient.
  }

  // Run prune if retention policy is configured and at least one backup succeeded
  if (planHasRetentionPolicy(plan) && successCount > 0) {
    try {
      await executePruneForPlan(plan, repository);
    } catch (error) {
      logError("prune after backup failed", {
        planId: plan.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
void executeBackupPlan;

async function runDueBackupPlans() {
  if (backupPlanSchedulerRunning) return;
  backupPlanSchedulerRunning = true;

  try {
    const now = new Date();
    const duePlans = await db.query.backupPlan.findMany({
      where: (table, { and: dbAnd, eq: dbEq }) =>
        dbAnd(dbEq(table.enabled, true), lte(table.nextRunAt, now)),
      orderBy: (table, { asc }) => [asc(table.nextRunAt)],
      columns: {
        id: true,
        userId: true,
        repositoryId: true,
        workerId: true,
        name: true,
        cron: true,
        pathsJson: true,
        tagsJson: true,
        dryRun: true,
        enabled: true,
        lastRunAt: true,
        nextRunAt: true,
        lastStatus: true,
        lastError: true,
        lastDurationMs: true,
        pruneEnabled: true,
        keepLast: true,
        keepDaily: true,
        keepWeekly: true,
        keepMonthly: true,
        keepYearly: true,
        keepWithin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    for (const plan of duePlans) {
      const locked = await acquireBackupPlanLease(plan.id);
      if (!locked) {
        logInfo("backup plan run skipped because lease is already held", {
          planId: plan.id,
          repositoryId: plan.repositoryId,
        });
        continue;
      }
      logInfo("backup plan run started", {
        planId: plan.id,
        userId: plan.userId,
        repositoryId: plan.repositoryId,
      });
      try {
        await enqueueBackupPlanRuns(plan);
      } finally {
        await releaseBackupPlanLease(plan.id);
      }
    }
  } finally {
    backupPlanSchedulerRunning = false;
  }
}

function startBackupPlanScheduler() {
  if (backupPlanSchedulerStarted) return;
  const schedulerEnabled = process.env.GLARE_ENABLE_SERVER_PLAN_SCHEDULER === "true";
  if (!schedulerEnabled) {
    logInfo("backup plan scheduler disabled (worker-owned scheduling enabled)");
    return;
  }
  backupPlanSchedulerStarted = true;

  setInterval(() => {
    void runDueBackupPlans();
  }, 30_000);
}

startBackupPlanScheduler();

export const rusticRoutes = new Elysia({ prefix: "/api" })
  .get(
    "/rustic/endpoints",
    async ({ request, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      return {
        endpoints: {
          workersStats: "/api/workers/rustic/stats",
          workerStats: "/api/workers/:id/rustic/stats",
          summaryStats: "/api/rustic/stats/summary",
          storageUsageStats: "/api/rustic/stats/storage-usage",
          repositoriesStats: "/api/rustic/stats/repositories",
          listRepositories: "/api/rustic/repositories",
          createRepository: "/api/rustic/repositories",
          getRepository: "/api/rustic/repositories/:id",
          updateRepository: "/api/rustic/repositories/:id",
          deleteRepository: "/api/rustic/repositories/:id",
          initRepository: "/api/rustic/repositories/:id/init",
          listRepositorySnapshots: "/api/rustic/repositories/:id/snapshots",
          listRepositorySnapshotWorkers: "/api/rustic/repositories/:id/snapshot-workers",
          streamRepositorySnapshotUpdates: "/api/rustic/repositories/:id/snapshot-stream",
          streamRepositorySnapshotUpdatesWs: "/api/rustic/repositories/:id/snapshot-ws",
          listSnapshotFiles: "/api/rustic/repositories/:id/snapshot/files",
          checkRepository: "/api/rustic/repositories/:id/check",
          repairRepositoryIndex: "/api/rustic/repositories/:id/repair-index",
          triggerRepositoryBackup: "/api/rustic/repositories/:id/backup",
          listBackupPlans: "/api/rustic/plans",
          createBackupPlan: "/api/rustic/plans",
          updateBackupPlan: "/api/rustic/plans/:id",
          deleteBackupPlan: "/api/rustic/plans/:id",
          listBackupPlanRuns: "/api/rustic/plans/:id/runs",
          listBackupEvents: "/api/rustic/events",
          runBackupPlanNow: "/api/rustic/plans/:id/run",
          openapiJson: "/openapi/json",
          scalarDocs: "/openapi",
        },
      };
    },
    {
      response: {
        200: rusticEndpointsSchema,
        401: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "List Rustic API endpoints",
      },
    },
  )
  .get(
    "/workers/rustic/stats",
    async ({ request, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      return getWorkerStatsForUser(user.id);
    },
    {
      response: {
        200: rusticWorkerStatsListSchema,
        401: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Get Rustic stats for all workers",
      },
    },
  )
  .get(
    "/workers/:id/rustic/stats",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedWorkerId = workerIdSchema.safeParse(params.id);
      if (!parsedWorkerId.success) {
        return status(400, { error: "Invalid worker id" });
      }

      const workerRecord = await db.query.worker.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.id, parsedWorkerId.data), eq(table.userId, user.id)),
        columns: {
          id: true,
          name: true,
          status: true,
          lastSeenAt: true,
          uptimeMs: true,
          requestsTotal: true,
          errorTotal: true,
          syncTokenHash: true,
        },
      });

      if (!workerRecord) {
        return status(404, { error: "Worker not found" });
      }

      return { worker: mapRusticWorkerStats(workerRecord) };
    },
    {
      params: t.Object({
        id: t.String({ format: "uuid" }),
      }),
      response: {
        200: t.Object({ worker: rusticWorkerStatsSchema }),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Get Rustic stats for one worker",
      },
    },
  )
  .get(
    "/rustic/stats/summary",
    async ({ request, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const workersStats = await getWorkerStatsForUser(user.id);
      const repositories = await getRepositoriesForUser(user.id);

      return {
        workers: workersStats.summary,
        repositories: buildRepositorySummary(repositories),
      };
    },
    {
      response: {
        200: rusticSummarySchema,
        401: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Get Rustic summary stats",
      },
    },
  )
  .get(
    "/rustic/stats/storage-usage",
    async ({ request, query, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const hoursParam = Number(query?.hours) || 24;
      const hours = Math.max(1, Math.min(24 * 30, hoursParam));
      const intervalMinutesParam = Number(query?.intervalMinutes);
      const intervalMinutes = Number.isFinite(intervalMinutesParam)
        ? Math.max(1, Math.min(60, Math.floor(intervalMinutesParam)))
        : null;
      const bucketsParam = Number(query?.buckets);
      const defaultBuckets = Math.max(4, hours * 12);
      const buckets = Number.isFinite(bucketsParam)
        ? Math.max(4, Math.min(2_880, Math.floor(bucketsParam)))
        : defaultBuckets;
      const bucketMs = intervalMinutes
        ? intervalMinutes * 60_000
        : Math.max(60_000, Math.floor((hours * 60 * 60 * 1000) / buckets));
      const rows = await db.$client.query(
        `
        WITH event_points AS (
          SELECT
            s."repository_id" AS repository_id,
            s."created_at" AS sample_time,
            s."bytes_added"::bigint AS raw_bytes,
            LAG(s."bytes_added"::bigint) OVER (
              PARTITION BY s."repository_id"
              ORDER BY s."created_at" ASC
            ) AS prev_raw_bytes
          FROM "storage_usage_event" s
          WHERE s."user_id" = $1
            AND s."created_at" >= NOW() - INTERVAL '1 hour' * $2
        ),
        event_deltas AS (
          SELECT
            sample_time,
            CASE
              WHEN prev_raw_bytes IS NULL THEN 0::bigint
              ELSE (raw_bytes - prev_raw_bytes)::bigint
            END AS bytes_added
          FROM event_points
        ),
        metric_fallback_samples AS (
          SELECT
            m."created_at" AS sample_time,
            m."bytes_added"::bigint AS bytes_added
          FROM "backup_run_metric" m
          WHERE m."user_id" = $1
            AND m."created_at" >= NOW() - INTERVAL '1 hour' * $2
            AND NOT EXISTS (
              SELECT 1
              FROM "storage_usage_event" s
              WHERE s."run_id" = m."run_id"
                AND s."user_id" = m."user_id"
            )
        )
        SELECT
          sample_time,
          bytes_added
        FROM event_deltas
        UNION ALL
        SELECT
          sample_time,
          bytes_added
        FROM metric_fallback_samples
        ORDER BY sample_time ASC
        `,
        [user.id, hours],
      );

      const allSamples: Array<{ snapshotTimeMs: number; bytesAdded: number }> = [];
      for (const row of rows.rows as Array<{
        sample_time: string | Date;
        bytes_added: string | number;
      }>) {
        const snapshotTimeMs = new Date(row.sample_time).getTime();
        const bytesAdded = Number(row.bytes_added);
        if (!Number.isFinite(snapshotTimeMs) || !Number.isFinite(bytesAdded)) {
          continue;
        }
        const normalizedBytesAdded = Math.trunc(bytesAdded);
        if (normalizedBytesAdded === 0) {
          continue;
        }
        allSamples.push({
          snapshotTimeMs,
          bytesAdded: normalizedBytesAdded,
        });
      }

      const bucketMap = new Map<number, number>();
      for (const sample of allSamples) {
        const bucketKey = Math.floor(sample.snapshotTimeMs / bucketMs) * bucketMs;
        bucketMap.set(bucketKey, (bucketMap.get(bucketKey) ?? 0) + sample.bytesAdded);
      }

      const sortedBuckets = Array.from(bucketMap.entries()).sort((a, b) => a[0] - b[0]);
      let runningTotal = 0;
      const result = sortedBuckets.map(([bucketMsEpoch, bytesAdded]) => {
        runningTotal += bytesAdded;
        return {
          bucket: new Date(bucketMsEpoch).toISOString(),
          bytesAdded: String(bytesAdded),
          totalBytes: String(runningTotal),
        };
      });

      return {
        source: "backup_run_metric+storage_usage_event",
        buckets: result,
      };
    },
    {
      query: t.Object({
        hours: t.Optional(t.Numeric()),
        buckets: t.Optional(t.Numeric()),
        intervalMinutes: t.Optional(t.Numeric()),
      }),
      response: {
        200: t.Object({
          source: t.String(),
          buckets: t.Array(
            t.Object({
              bucket: t.String(),
              bytesAdded: t.String(),
              totalBytes: t.String(),
            }),
          ),
        }),
        401: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Get worker-sourced storage usage buckets",
      },
    },
  )
  .get(
    "/rustic/stats/repositories",
    async ({ request, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const repositories = await getRepositoriesForUser(user.id);

      return {
        repositories,
        summary: buildRepositorySummary(repositories),
      };
    },
    {
      response: {
        200: t.Object({
          repositories: t.Array(rusticRepositorySchema),
          summary: repositoryStatsSchema,
        }),
        401: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Get repository stats and breakdown",
      },
    },
  )
  .get(
    "/rustic/repositories",
    async ({ request, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      return { repositories: await getRepositoriesForUser(user.id) };
    },
    {
      response: {
        200: t.Object({
          repositories: t.Array(rusticRepositorySchema),
        }),
        401: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "List Rustic repositories",
      },
    },
  )
  .post(
    "/rustic/repositories",
    async ({ request, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      let primaryWorkerId: string | null = null;
      let backupWorkerIds: string[] = [];
      try {
        const requestedPrimaryWorkerId =
          body.primaryWorkerId === undefined ? body.workerId : body.primaryWorkerId;
        const requestedBackupWorkerIds =
          body.backupWorkerIds === undefined && body.workerId
            ? [body.workerId]
            : (body.backupWorkerIds ?? []);

        if (requestedPrimaryWorkerId) {
          const [resolvedPrimaryWorkerId] = await resolveOwnedWorkerIds(user.id, [
            requestedPrimaryWorkerId,
          ]);
          primaryWorkerId = resolvedPrimaryWorkerId ?? null;
        }
        backupWorkerIds = await resolveOwnedWorkerIds(user.id, requestedBackupWorkerIds);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Worker validation failed";
        return status(message === "Invalid worker id" ? 400 : 404, { error: message });
      }

      const repositoryId = crypto.randomUUID();
      const options = mergeS3Options(body.options, body.s3);
      const repositoryPath =
        body.backend === "s3"
          ? body.s3
            ? buildS3RepositoryPath(body.s3)
            : null
          : body.backend === "rclone"
            ? body.repository?.trim()
              ? normalizeRcloneRepository(body.repository, repositoryId, options)
              : null
            : body.repository?.trim() || null;

      if (!repositoryPath) {
        return status(400, {
          error:
            body.backend === "s3"
              ? "S3 configuration with bucket is required"
              : "Repository path is required",
        });
      }

      await db.insert(rusticRepository).values({
        id: repositoryId,
        userId: user.id,
        workerId: primaryWorkerId,
        name: body.name.trim(),
        backend: body.backend,
        repository: repositoryPath,
        initializedAt: null,
        password: body.password?.trim() || null,
        optionsJson: Object.keys(options).length > 0 ? JSON.stringify(options) : null,
      });
      await replaceBackupWorkers(repositoryId, backupWorkerIds);

      const createdRepository = await getRepositoryByIdForUser(user.id, repositoryId);

      if (!createdRepository) {
        return status(500, { error: "Failed to create repository" });
      }

      return status(201, { repository: createdRepository });
    },
    {
      body: createRepositoryBodySchema,
      response: {
        201: t.Object({ repository: rusticRepositorySchema }),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Create Rustic repository",
      },
    },
  )
  .get(
    "/rustic/repositories/:id",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repository = await getRepositoryByIdForUser(user.id, parsedRepositoryId.data);

      if (!repository) {
        return status(404, { error: "Repository not found" });
      }

      return { repository };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ repository: rusticRepositorySchema }),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Get repository",
      },
    },
  )
  .patch(
    "/rustic/repositories/:id",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const existing = await db.query.rusticRepository.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.id, parsedRepositoryId.data), eq(table.userId, user.id)),
        columns: {
          id: true,
          workerId: true,
          password: true,
          backend: true,
          repository: true,
          optionsJson: true,
          initializedAt: true,
        },
      });

      if (!existing) {
        return status(404, { error: "Repository not found" });
      }

      let primaryWorkerIdToPersist: string | null | undefined;
      const requestedPrimaryWorkerId =
        body.primaryWorkerId !== undefined ? body.primaryWorkerId : body.workerId;
      if (requestedPrimaryWorkerId !== undefined) {
        if (requestedPrimaryWorkerId === null) {
          primaryWorkerIdToPersist = null;
        } else {
          try {
            const [resolvedPrimaryWorkerId] = await resolveOwnedWorkerIds(user.id, [
              requestedPrimaryWorkerId,
            ]);
            primaryWorkerIdToPersist = resolvedPrimaryWorkerId ?? null;
          } catch (error) {
            const message = error instanceof Error ? error.message : "Worker validation failed";
            return status(message === "Invalid worker id" ? 400 : 404, { error: message });
          }
        }
      }

      const currentOptions = parseOptionsJson(existing.optionsJson);
      const mergedOptions = mergeS3Options(body.options ?? currentOptions, body.s3);

      const repositoryPath =
        body.backend === "s3" || (body.backend === undefined && existing.backend === "s3")
          ? body.s3
            ? buildS3RepositoryPath(body.s3)
            : body.repository?.trim() || existing.repository
          : body.backend === "rclone" ||
              (body.backend === undefined && existing.backend === "rclone")
            ? body.repository?.trim()
              ? normalizeRcloneRepository(body.repository, existing.id, mergedOptions)
              : existing.repository
            : body.repository?.trim();

      const nextBackend = body.backend ?? existing.backend;
      const nextRepository = repositoryPath ?? existing.repository;
      const nextPassword =
        body.password === undefined
          ? existing.password
          : body.password === null
            ? null
            : body.password.trim();
      const nextOptionsJson =
        Object.keys(mergedOptions).length > 0 ? JSON.stringify(mergedOptions) : null;
      const nextWorkerId =
        primaryWorkerIdToPersist === undefined ? existing.workerId : primaryWorkerIdToPersist;
      const shouldResetInitialization =
        nextBackend !== existing.backend ||
        nextRepository !== existing.repository ||
        nextWorkerId !== existing.workerId ||
        nextPassword !== existing.password ||
        nextOptionsJson !== existing.optionsJson;

      await db
        .update(rusticRepository)
        .set({
          name: body.name?.trim(),
          backend: nextBackend,
          repository: nextRepository,
          workerId: primaryWorkerIdToPersist,
          password:
            body.password === undefined ? undefined : body.password === null ? null : nextPassword,
          optionsJson: nextOptionsJson,
          initializedAt: shouldResetInitialization ? null : existing.initializedAt,
        })
        .where(eq(rusticRepository.id, existing.id));
      const requestedBackupWorkerIds =
        body.backupWorkerIds !== undefined
          ? body.backupWorkerIds
          : body.workerId !== undefined
            ? body.workerId === null
              ? []
              : [body.workerId]
            : undefined;
      if (requestedBackupWorkerIds !== undefined) {
        try {
          const resolvedBackupWorkerIds = await resolveOwnedWorkerIds(
            user.id,
            requestedBackupWorkerIds,
          );
          await replaceBackupWorkers(existing.id, resolvedBackupWorkerIds);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Worker validation failed";
          return status(message === "Invalid worker id" ? 400 : 404, { error: message });
        }
      }

      const updated = await getRepositoryByIdForUser(user.id, existing.id);

      if (!updated) {
        return status(500, { error: "Failed to update repository" });
      }

      return { repository: updated };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: updateRepositoryBodySchema,
      response: {
        200: t.Object({ repository: rusticRepositorySchema }),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Update repository",
      },
    },
  )
  .delete(
    "/rustic/repositories/:id",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const existing = await db.query.rusticRepository.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.id, parsedRepositoryId.data), eq(table.userId, user.id)),
        columns: { id: true },
      });

      if (!existing) {
        return status(404, { error: "Repository not found" });
      }

      await db.delete(rusticRepository).where(eq(rusticRepository.id, existing.id));

      return status(204, null);
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        204: t.Null(),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Delete repository",
      },
    },
  )
  .post(
    "/rustic/repositories/:id/init",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repositoryRecord = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: {
          id: true,
          workerId: true,
          backend: true,
          repository: true,
          initializedAt: true,
          password: true,
          optionsJson: true,
        },
      });

      if (!repositoryRecord) {
        return status(404, { error: "Repository not found" });
      }

      if (!repositoryRecord.workerId) {
        logWarn("repository init rejected: no attached worker", {
          userId: user.id,
          repositoryId: parsedRepositoryId.data,
        });
        return status(400, { error: "Repository is not attached to a worker" });
      }

      if (repositoryRecord.initializedAt) {
        logWarn("repository init rejected: already initialized", {
          userId: user.id,
          repositoryId: parsedRepositoryId.data,
          workerId: repositoryRecord.workerId,
          initializedAt: repositoryRecord.initializedAt.toISOString(),
        });
        return status(409, { error: "Repository is already initialized" });
      }

      const rawOptions = parseOptionsJson(repositoryRecord.optionsJson);
      const initOptions = hasRcloneOptions(rawOptions)
        ? rawOptions
        : repositoryRecord.backend === "s3" && hasLegacyS3Options(rawOptions)
          ? enrichRcloneOptionsFromS3(rawOptions)
          : rawOptions;
      const shouldForceRcloneInit =
        repositoryRecord.backend === "rclone" ||
        (repositoryRecord.backend === "s3" &&
          (hasRcloneOptions(initOptions) || hasLegacyS3Options(initOptions)));
      const initBackend = shouldForceRcloneInit ? "rclone" : repositoryRecord.backend;
      const initRepository = shouldForceRcloneInit
        ? deriveRcloneRepositoryForInit(
            repositoryRecord.repository,
            repositoryRecord.id,
            initOptions,
          )
        : repositoryRecord.repository;

      if (shouldForceRcloneInit && repositoryRecord.backend !== "rclone") {
        logInfo("repository init using rclone compatibility mode", {
          userId: user.id,
          repositoryId: repositoryRecord.id,
          previousBackend: repositoryRecord.backend,
          derivedRepository: initRepository,
        });
      }

      const result = await getWorkerForProxy(user.id, repositoryRecord.workerId);
      if ("error" in result) {
        logWarn("repository init blocked by proxy worker check", {
          userId: user.id,
          repositoryId: parsedRepositoryId.data,
          workerId: repositoryRecord.workerId,
          reason: result.error,
          status: result.status,
        });
        return status(result.status, { error: result.error });
      }

      try {
        logInfo("repository init started", {
          userId: user.id,
          repositoryId: parsedRepositoryId.data,
          workerId: result.worker.id,
        });
        const proxy = await proxyToWorker(
          result.worker.endpoint,
          result.worker.syncToken,
          "/rustic/init",
          "POST",
          {
            backend: initBackend,
            repository: initRepository,
            password: repositoryRecord.password ?? undefined,
            options: initOptions,
          },
        );

        if (proxy.status >= 200 && proxy.status < 300) {
          await db
            .update(rusticRepository)
            .set({ initializedAt: new Date() })
            .where(eq(rusticRepository.id, repositoryRecord.id));

          logInfo("repository init succeeded", {
            userId: user.id,
            repositoryId: parsedRepositoryId.data,
            workerId: result.worker.id,
            workerStatus: proxy.status,
          });
          return status(proxy.status as 200, proxy.data);
        }

        logWarn("repository init failed at worker", {
          userId: user.id,
          repositoryId: parsedRepositoryId.data,
          workerId: result.worker.id,
          workerStatus: proxy.status,
        });
        if (proxy.data && typeof proxy.data === "object") {
          const proxyError = proxy.data as { error?: string };
          if (isAlreadyInitializedMessage(proxyError.error)) {
            await db
              .update(rusticRepository)
              .set({ initializedAt: new Date() })
              .where(eq(rusticRepository.id, repositoryRecord.id));
            return status(409, { error: "Repository is already initialized" });
          }
          return status(proxy.status as 400, proxy.data as { error: string });
        }
        return status(proxy.status as 400, { error: "Failed to initialize repository" });
      } catch (error) {
        logError("repository init proxy request failed", {
          userId: user.id,
          repositoryId: parsedRepositoryId.data,
          workerId: result.worker.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Rustic"],
        summary: "Initialize repository on its attached worker",
      },
    },
  )
  .post(
    "/rustic/repositories/:id/snapshots",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repositoryRecord = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: {
          id: true,
          workerId: true,
          backend: true,
          repository: true,
          password: true,
          optionsJson: true,
        },
      });
      if (!repositoryRecord) {
        return status(404, { error: "Repository not found" });
      }
      if (!repositoryRecord.workerId) {
        return status(400, { error: "Repository is not attached to a worker" });
      }

      const result = await getWorkerForProxy(user.id, repositoryRecord.workerId);
      if ("error" in result) {
        return status(result.status, { error: result.error });
      }

      try {
        const rawOptions = parseOptionsJson(repositoryRecord.optionsJson);
        const snapshotOptions = hasRcloneOptions(rawOptions)
          ? rawOptions
          : repositoryRecord.backend === "s3" && hasLegacyS3Options(rawOptions)
            ? enrichRcloneOptionsFromS3(rawOptions)
            : rawOptions;
        const shouldForceRcloneSnapshots =
          repositoryRecord.backend === "rclone" ||
          (repositoryRecord.backend === "s3" &&
            (hasRcloneOptions(snapshotOptions) || hasLegacyS3Options(snapshotOptions)));
        if (!shouldForceRcloneSnapshots && repositoryRecord.repository.startsWith("s3:")) {
          return status(400, {
            error:
              "Repository snapshots require rclone-backed options for s3 repositories. Update repository options or backend.",
          });
        }
        const snapshotsRepository = shouldForceRcloneSnapshots
          ? deriveRcloneRepositoryForInit(
              repositoryRecord.repository,
              repositoryRecord.id,
              snapshotOptions,
            )
          : repositoryRecord.repository;

        const proxy = await proxyToWorker(
          result.worker.endpoint,
          result.worker.syncToken,
          "/rustic/repository-snapshots",
          "POST",
          {
            repository: snapshotsRepository,
            password: repositoryRecord.password ?? undefined,
            backend: shouldForceRcloneSnapshots ? "rclone" : repositoryRecord.backend,
            options: shouldForceRcloneSnapshots ? snapshotOptions : undefined,
          },
        );
        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Rustic"],
        summary: "List snapshots for repository",
      },
    },
  )
  .get(
    "/rustic/repositories/:id/snapshot-workers",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repository = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: { id: true },
      });
      if (!repository) {
        return status(404, { error: "Repository not found" });
      }

      return getRepositorySnapshotWorkerAttributionsForUser(user.id, repository.id);
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({
          snapshots: t.Array(repositorySnapshotWorkerAttributionSchema),
        }),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "List worker attribution for repository snapshots",
      },
    },
  )
  .get(
    "/rustic/repositories/:id/snapshot-stream",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repository = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: { id: true },
      });
      if (!repository) {
        return status(404, { error: "Repository not found" });
      }

      const encoder = new TextEncoder();
      let tickInterval: ReturnType<typeof setInterval> | null = null;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const pushEvent = (event: string, payload: Record<string, unknown>) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
            );
          };
          const pushHeartbeat = () => {
            controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
          };

          pushEvent("ready", { ts: Date.now() });
          tickInterval = setInterval(() => {
            pushEvent("tick", { ts: Date.now() });
          }, 6_000);
          heartbeatInterval = setInterval(pushHeartbeat, 15_000);
        },
        cancel() {
          if (tickInterval) clearInterval(tickInterval);
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          tickInterval = null;
          heartbeatInterval = null;
        },
      });

      return new Response(stream, {
        headers: {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
        },
      });
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Stream snapshot update ticks via SSE",
      },
    },
  )
  .ws("/rustic/repositories/:id/snapshot-ws", {
    params: t.Object({ id: t.String({ format: "uuid" }) }),
    open: async (ws) => {
      const user = await getAuthenticatedUser(ws.data.request);
      if (!user) {
        ws.close(1008, "Unauthorized");
        return;
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(ws.data.params.id);
      if (!parsedRepositoryId.success) {
        ws.close(1008, "Invalid repository id");
        return;
      }

      const repository = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: { id: true },
      });
      if (!repository) {
        ws.close(1008, "Repository not found");
        return;
      }

      const pushActivity = async (event: "ready" | "tick") => {
        try {
          const activity = await getRepositorySnapshotActivityForUser(user.id, repository.id);
          ws.send(
            JSON.stringify({
              event,
              ts: Date.now(),
              repositoryId: repository.id,
              activities: activity.activities,
            }),
          );
        } catch (error) {
          logWarn("snapshot websocket push failed", {
            repositoryId: repository.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      await pushActivity("ready");
      const intervalId = setInterval(() => {
        void pushActivity("tick");
      }, 1_000);
      snapshotWsTickIntervals.set(ws.id, intervalId);
    },
    close: (ws) => {
      const intervalId = snapshotWsTickIntervals.get(ws.id);
      if (intervalId) {
        clearInterval(intervalId);
      }
      snapshotWsTickIntervals.delete(ws.id);
    },
  })
  .get(
    "/rustic/repositories/:id/snapshot-activity",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repository = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: { id: true },
      });
      if (!repository) {
        return status(404, { error: "Repository not found" });
      }

      return getRepositorySnapshotActivityForUser(user.id, repository.id);
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({
          activities: t.Array(repositorySnapshotActivitySchema),
        }),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "List pending and in-progress snapshot activity",
      },
    },
  )
  .post(
    "/rustic/repositories/:id/snapshot/files",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repositoryRecord = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: {
          id: true,
          workerId: true,
          repository: true,
          password: true,
          backend: true,
          optionsJson: true,
        },
      });
      if (!repositoryRecord) {
        return status(404, { error: "Repository not found" });
      }
      if (!repositoryRecord.workerId) {
        return status(400, { error: "Repository is not attached to a worker" });
      }

      const backupWorkerIds = await getBackupWorkerIdsForRepository(repositoryRecord.id);
      const selectedWorkerId = body.workerId ?? repositoryRecord.workerId;
      const validWorkerIds = Array.from(new Set([repositoryRecord.workerId, ...backupWorkerIds]));
      if (!validWorkerIds.includes(selectedWorkerId)) {
        return status(400, {
          error: "Selected worker is not attached to this repository",
        });
      }

      const result = await getWorkerForProxy(user.id, selectedWorkerId);
      if ("error" in result) {
        return status(502, { error: result.error });
      }

      try {
        const rawOptions = parseOptionsJson(repositoryRecord.optionsJson);
        const snapshotOptions = hasRcloneOptions(rawOptions)
          ? rawOptions
          : repositoryRecord.backend === "s3" && hasLegacyS3Options(rawOptions)
            ? enrichRcloneOptionsFromS3(rawOptions)
            : rawOptions;
        const shouldForceRcloneSnapshots =
          repositoryRecord.backend === "rclone" ||
          (repositoryRecord.backend === "s3" &&
            (hasRcloneOptions(snapshotOptions) || hasLegacyS3Options(snapshotOptions)));
        if (!shouldForceRcloneSnapshots && repositoryRecord.repository.startsWith("s3:")) {
          return status(400, {
            error:
              "Snapshot file listing requires rclone-backed options for s3 repositories. Update repository options or backend.",
          });
        }
        const snapshotRepository = shouldForceRcloneSnapshots
          ? deriveRcloneRepositoryForInit(
              repositoryRecord.repository,
              repositoryRecord.id,
              snapshotOptions,
            )
          : repositoryRecord.repository;

        const proxy = await proxyToWorker(
          result.worker.endpoint,
          result.worker.syncToken,
          "/rustic/snapshot/files",
          "POST",
          {
            repository: snapshotRepository,
            password: repositoryRecord.password ?? undefined,
            snapshot: body.snapshot,
            path: body.path,
            backend: shouldForceRcloneSnapshots ? "rclone" : repositoryRecord.backend,
            options: shouldForceRcloneSnapshots ? snapshotOptions : undefined,
          },
        );
        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: repositorySnapshotFilesBodySchema,
      detail: {
        tags: ["Rustic"],
        summary: "List files for repository snapshot",
      },
    },
  )
  .post(
    "/rustic/repositories/:id/snapshot/diff",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repositoryRecord = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: {
          id: true,
          workerId: true,
          repository: true,
          password: true,
          backend: true,
          optionsJson: true,
        },
      });
      if (!repositoryRecord) {
        return status(404, { error: "Repository not found" });
      }
      if (!repositoryRecord.workerId) {
        return status(400, { error: "Repository is not attached to a worker" });
      }

      const backupWorkerIds = await getBackupWorkerIdsForRepository(repositoryRecord.id);
      const selectedWorkerId = body.workerId ?? repositoryRecord.workerId;
      const validWorkerIds = Array.from(new Set([repositoryRecord.workerId, ...backupWorkerIds]));
      if (!validWorkerIds.includes(selectedWorkerId)) {
        return status(400, { error: "Selected worker is not attached to this repository" });
      }

      const result = await getWorkerForProxy(user.id, selectedWorkerId);
      if ("error" in result) {
        return status(502, { error: result.error });
      }

      try {
        const rawOptions = parseOptionsJson(repositoryRecord.optionsJson);
        const snapshotOptions = hasRcloneOptions(rawOptions)
          ? rawOptions
          : repositoryRecord.backend === "s3" && hasLegacyS3Options(rawOptions)
            ? enrichRcloneOptionsFromS3(rawOptions)
            : rawOptions;
        const shouldForceRcloneSnapshots =
          repositoryRecord.backend === "rclone" ||
          (repositoryRecord.backend === "s3" &&
            (hasRcloneOptions(snapshotOptions) || hasLegacyS3Options(snapshotOptions)));
        const snapshotRepository = shouldForceRcloneSnapshots
          ? deriveRcloneRepositoryForInit(
              repositoryRecord.repository,
              repositoryRecord.id,
              snapshotOptions,
            )
          : repositoryRecord.repository;

        const [left, right] = await Promise.all([
          proxyToWorker(
            result.worker.endpoint,
            result.worker.syncToken,
            "/rustic/snapshot/files",
            "POST",
            {
              repository: snapshotRepository,
              password: repositoryRecord.password ?? undefined,
              snapshot: body.fromSnapshot,
              path: body.path,
              backend: shouldForceRcloneSnapshots ? "rclone" : repositoryRecord.backend,
              options: shouldForceRcloneSnapshots ? snapshotOptions : undefined,
            },
          ),
          proxyToWorker(
            result.worker.endpoint,
            result.worker.syncToken,
            "/rustic/snapshot/files",
            "POST",
            {
              repository: snapshotRepository,
              password: repositoryRecord.password ?? undefined,
              snapshot: body.toSnapshot,
              path: body.path,
              backend: shouldForceRcloneSnapshots ? "rclone" : repositoryRecord.backend,
              options: shouldForceRcloneSnapshots ? snapshotOptions : undefined,
            },
          ),
        ]);

        if (left.status < 200 || left.status >= 300) {
          return status(left.status as 400, left.data as { error?: string });
        }
        if (right.status < 200 || right.status >= 300) {
          return status(right.status as 400, right.data as { error?: string });
        }

        const leftEntries = extractSnapshotFileEntries(left.data);
        const rightEntries = extractSnapshotFileEntries(right.data);
        const leftMap = new Map(leftEntries.map((entry) => [entry.path, entry.kind]));
        const rightMap = new Map(rightEntries.map((entry) => [entry.path, entry.kind]));

        const added: string[] = [];
        const removed: string[] = [];
        const changed: string[] = [];

        for (const [path, kind] of rightMap) {
          if (!leftMap.has(path)) {
            added.push(path);
            continue;
          }
          const leftKind = leftMap.get(path);
          if (leftKind !== kind) {
            changed.push(path);
          }
        }
        for (const [path] of leftMap) {
          if (!rightMap.has(path)) {
            removed.push(path);
          }
        }

        return {
          fromSnapshot: body.fromSnapshot,
          toSnapshot: body.toSnapshot,
          path: body.path ?? null,
          summary: {
            added: added.length,
            removed: removed.length,
            changed: changed.length,
          },
          added,
          removed,
          changed,
        };
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        fromSnapshot: t.String({ minLength: 1, maxLength: 512 }),
        toSnapshot: t.String({ minLength: 1, maxLength: 512 }),
        path: t.Optional(t.String({ maxLength: 1024 })),
        workerId: t.Optional(t.String({ format: "uuid" })),
      }),
      detail: {
        tags: ["Rustic"],
        summary: "Diff files between two snapshots",
      },
    },
  )
  .post(
    "/rustic/repositories/:id/check",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repositoryRecord = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: {
          id: true,
          workerId: true,
          repository: true,
          password: true,
          backend: true,
          optionsJson: true,
        },
      });
      if (!repositoryRecord) {
        return status(404, { error: "Repository not found" });
      }
      if (!repositoryRecord.workerId) {
        return status(400, { error: "Repository is not attached to a worker" });
      }

      const backupWorkerIds = await getBackupWorkerIdsForRepository(repositoryRecord.id);
      const selectedWorkerId = body.workerId ?? repositoryRecord.workerId;
      const validWorkerIds = Array.from(new Set([repositoryRecord.workerId, ...backupWorkerIds]));
      if (!validWorkerIds.includes(selectedWorkerId)) {
        return status(400, {
          error: "Selected worker is not attached to this repository",
        });
      }

      const result = await getWorkerForProxy(user.id, selectedWorkerId);
      if ("error" in result) {
        return status(502, { error: result.error });
      }

      try {
        const rawOptions = parseOptionsJson(repositoryRecord.optionsJson);
        const maintenanceOptions = hasRcloneOptions(rawOptions)
          ? rawOptions
          : repositoryRecord.backend === "s3" && hasLegacyS3Options(rawOptions)
            ? enrichRcloneOptionsFromS3(rawOptions)
            : rawOptions;
        const shouldForceRcloneMaintenance =
          repositoryRecord.backend === "rclone" ||
          (repositoryRecord.backend === "s3" &&
            (hasRcloneOptions(maintenanceOptions) || hasLegacyS3Options(maintenanceOptions)));
        if (!shouldForceRcloneMaintenance && repositoryRecord.repository.startsWith("s3:")) {
          return status(400, {
            error:
              "Repository check requires rclone-backed options for s3 repositories. Update repository options or backend.",
          });
        }
        const maintenanceRepository = shouldForceRcloneMaintenance
          ? deriveRcloneRepositoryForInit(
              repositoryRecord.repository,
              repositoryRecord.id,
              maintenanceOptions,
            )
          : repositoryRecord.repository;

        const proxy = await proxyToWorker(
          result.worker.endpoint,
          result.worker.syncToken,
          "/rustic/check",
          "POST",
          {
            repository: maintenanceRepository,
            password: repositoryRecord.password ?? undefined,
            backend: shouldForceRcloneMaintenance ? "rclone" : repositoryRecord.backend,
            options: shouldForceRcloneMaintenance ? maintenanceOptions : undefined,
          },
        );
        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: repositoryMaintenanceBodySchema,
      response: {
        200: t.Any(),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
        502: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Run repository check on worker",
      },
    },
  )
  .post(
    "/rustic/repositories/:id/repair-index",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repositoryRecord = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: {
          id: true,
          workerId: true,
          repository: true,
          password: true,
          backend: true,
          optionsJson: true,
        },
      });
      if (!repositoryRecord) {
        return status(404, { error: "Repository not found" });
      }
      if (!repositoryRecord.workerId) {
        return status(400, { error: "Repository is not attached to a worker" });
      }

      const backupWorkerIds = await getBackupWorkerIdsForRepository(repositoryRecord.id);
      const selectedWorkerId = body.workerId ?? repositoryRecord.workerId;
      const validWorkerIds = Array.from(new Set([repositoryRecord.workerId, ...backupWorkerIds]));
      if (!validWorkerIds.includes(selectedWorkerId)) {
        return status(400, {
          error: "Selected worker is not attached to this repository",
        });
      }

      const result = await getWorkerForProxy(user.id, selectedWorkerId);
      if ("error" in result) {
        return status(502, { error: result.error });
      }

      try {
        const rawOptions = parseOptionsJson(repositoryRecord.optionsJson);
        const maintenanceOptions = hasRcloneOptions(rawOptions)
          ? rawOptions
          : repositoryRecord.backend === "s3" && hasLegacyS3Options(rawOptions)
            ? enrichRcloneOptionsFromS3(rawOptions)
            : rawOptions;
        const shouldForceRcloneMaintenance =
          repositoryRecord.backend === "rclone" ||
          (repositoryRecord.backend === "s3" &&
            (hasRcloneOptions(maintenanceOptions) || hasLegacyS3Options(maintenanceOptions)));
        if (!shouldForceRcloneMaintenance && repositoryRecord.repository.startsWith("s3:")) {
          return status(400, {
            error:
              "Repository repair requires rclone-backed options for s3 repositories. Update repository options or backend.",
          });
        }
        const maintenanceRepository = shouldForceRcloneMaintenance
          ? deriveRcloneRepositoryForInit(
              repositoryRecord.repository,
              repositoryRecord.id,
              maintenanceOptions,
            )
          : repositoryRecord.repository;

        const proxy = await proxyToWorker(
          result.worker.endpoint,
          result.worker.syncToken,
          "/rustic/repair-index",
          "POST",
          {
            repository: maintenanceRepository,
            password: repositoryRecord.password ?? undefined,
            backend: shouldForceRcloneMaintenance ? "rclone" : repositoryRecord.backend,
            options: shouldForceRcloneMaintenance ? maintenanceOptions : undefined,
          },
        );
        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: repositoryMaintenanceBodySchema,
      response: {
        200: t.Any(),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
        502: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Run repository index repair on worker",
      },
    },
  )
  .post(
    "/rustic/repositories/:id/backup",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repositoryRecord = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: {
          id: true,
          repository: true,
          password: true,
          backend: true,
          optionsJson: true,
        },
      });
      if (!repositoryRecord) {
        return status(404, { error: "Repository not found" });
      }

      const backupWorkerIds = await getBackupWorkerIdsForRepository(repositoryRecord.id);
      if (backupWorkerIds.length === 0) {
        return status(400, { error: "Repository has no backup workers attached" });
      }
      if (!backupWorkerIds.includes(body.workerId)) {
        return status(400, {
          error: "Selected worker is not attached to repository backup workers",
        });
      }

      const result = await getWorkerForProxy(user.id, body.workerId);
      if ("error" in result) {
        return status(result.status, { error: result.error });
      }

      try {
        const rawOptions = parseOptionsJson(repositoryRecord.optionsJson);
        const backupOptions = hasRcloneOptions(rawOptions)
          ? rawOptions
          : repositoryRecord.backend === "s3" && hasLegacyS3Options(rawOptions)
            ? enrichRcloneOptionsFromS3(rawOptions)
            : rawOptions;
        const shouldForceRcloneBackup =
          repositoryRecord.backend === "rclone" ||
          (repositoryRecord.backend === "s3" &&
            (hasRcloneOptions(backupOptions) || hasLegacyS3Options(backupOptions)));
        const backupBackend = shouldForceRcloneBackup ? "rclone" : repositoryRecord.backend;
        const backupRepository = shouldForceRcloneBackup
          ? deriveRcloneRepositoryForInit(
              repositoryRecord.repository,
              repositoryRecord.id,
              backupOptions,
            )
          : repositoryRecord.repository;

        const proxy = await proxyToWorker(
          result.worker.endpoint,
          result.worker.syncToken,
          "/rustic/backup",
          "POST",
          {
            backend: backupBackend,
            options: backupOptions,
            repository: backupRepository,
            password: repositoryRecord.password ?? undefined,
            paths: body.paths.map((path) => path.trim()).filter(Boolean),
            tags: body.tags?.map((tag) => tag.trim()).filter(Boolean),
            dryRun: body.dryRun ?? false,
          },
        );

        const rusticSuccess =
          proxy.data &&
          typeof proxy.data === "object" &&
          "rustic" in proxy.data &&
          typeof (proxy.data as { rustic?: { success?: boolean } }).rustic?.success === "boolean"
            ? Boolean((proxy.data as { rustic: { success: boolean } }).rustic.success)
            : proxy.status >= 200 && proxy.status < 300;
        const proxyErrorMessage =
          proxy.data && typeof proxy.data === "object" && "error" in proxy.data
            ? String((proxy.data as { error?: string }).error || "")
            : null;

        try {
          if (rusticSuccess) {
            let snapshotRef = extractPrimarySnapshotRefFromProxyData(proxy.data);
            if (!snapshotRef) {
              const snapshotsProxy = await proxyToWorker(
                result.worker.endpoint,
                result.worker.syncToken,
                "/rustic/repository-snapshots",
                "POST",
                {
                  repository: backupRepository,
                  password: repositoryRecord.password ?? undefined,
                },
              );
              if (snapshotsProxy.status >= 200 && snapshotsProxy.status < 300) {
                snapshotRef = extractLatestSnapshotRefFromProxyData(snapshotsProxy.data);
              }
            }

            await createBackupEvent({
              userId: user.id,
              repositoryId: repositoryRecord.id,
              workerId: result.worker.id,
              type: "manual_backup_completed",
              status: "resolved",
              severity: "info",
              message: "Manual backup completed",
              details: {
                snapshotId: snapshotRef?.snapshotId ?? null,
                snapshotTime: snapshotRef?.snapshotTime?.toISOString() ?? null,
                source: "manual",
              },
            });
            await recordStorageUsageSample({
              userId: user.id,
              repositoryId: repositoryRecord.id,
              output: proxy.data,
            });
            await recordBackupMetric({
              runId: crypto.randomUUID(),
              userId: user.id,
              repositoryId: repositoryRecord.id,
              planId: null,
              workerId: result.worker.id,
              snapshotId: snapshotRef?.snapshotId ?? null,
              snapshotTime: snapshotRef?.snapshotTime ?? null,
              output: proxy.data,
            });
          } else {
            await createBackupEvent({
              userId: user.id,
              repositoryId: repositoryRecord.id,
              workerId: result.worker.id,
              type: "backup_failed",
              message: proxyErrorMessage || "Manual backup failed",
              details: {
                status: proxy.status,
                source: "manual",
              },
            });
          }
        } catch {
          // Attribution event writing should not fail backup response.
        }

        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: repositoryBackupBodySchema,
      detail: {
        tags: ["Rustic"],
        summary: "Trigger repository backup now",
      },
    },
  )
  .post(
    "/rustic/repositories/:id/restore",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }
      if (!hasRoleAtLeast(user, "operator")) {
        return status(401, { error: "Requires operator role or higher" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repositoryRecord = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: {
          id: true,
          workerId: true,
          backend: true,
          repository: true,
          password: true,
          optionsJson: true,
        },
      });
      if (!repositoryRecord) {
        return status(404, { error: "Repository not found" });
      }
      if (!repositoryRecord.workerId) {
        return status(400, { error: "Repository is not attached to a worker" });
      }

      const backupWorkerIds = await getBackupWorkerIdsForRepository(repositoryRecord.id);
      const targetWorkerId = body.workerId ?? repositoryRecord.workerId ?? backupWorkerIds[0];
      if (!targetWorkerId) {
        return status(400, { error: "No worker available for this repository" });
      }

      const result = await getWorkerForProxy(user.id, targetWorkerId);
      if ("error" in result) {
        return status(result.status, { error: result.error });
      }

      try {
        const rawOptions = parseOptionsJson(repositoryRecord.optionsJson);
        const restoreOptions = hasRcloneOptions(rawOptions)
          ? rawOptions
          : repositoryRecord.backend === "s3" && hasLegacyS3Options(rawOptions)
            ? enrichRcloneOptionsFromS3(rawOptions)
            : rawOptions;
        const shouldForceRclone =
          repositoryRecord.backend === "rclone" ||
          (repositoryRecord.backend === "s3" &&
            (hasRcloneOptions(restoreOptions) || hasLegacyS3Options(restoreOptions)));
        const restoreBackend = shouldForceRclone ? "rclone" : repositoryRecord.backend;
        const restoreRepository = shouldForceRclone
          ? deriveRcloneRepositoryForInit(
              repositoryRecord.repository,
              repositoryRecord.id,
              restoreOptions,
            )
          : repositoryRecord.repository;

        const proxy = await proxyToWorker(
          result.worker.endpoint,
          result.worker.syncToken,
          "/rustic/restore",
          "POST",
          {
            repository: restoreRepository,
            password: repositoryRecord.password ?? undefined,
            snapshot: body.snapshot,
            target: body.target,
            path: body.path,
            dryRun: body.dryRun ?? false,
            backend: restoreBackend,
            options: shouldForceRclone ? restoreOptions : undefined,
          },
        );

        await writeAuditLog({
          actorUserId: user.id,
          action: "snapshot.restore",
          resourceType: "rustic_repository",
          resourceId: repositoryRecord.id,
          metadata: {
            snapshot: body.snapshot,
            target: body.target,
            workerId: targetWorkerId,
            dryRun: body.dryRun ?? false,
            status: proxy.status,
          },
          request,
        });

        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        snapshot: t.String({ minLength: 1, maxLength: 512 }),
        target: t.String({ minLength: 1, maxLength: 1024 }),
        path: t.Optional(t.String({ maxLength: 1024 })),
        dryRun: t.Optional(t.Boolean()),
        workerId: t.Optional(t.String({ format: "uuid" })),
      }),
      detail: {
        tags: ["Rustic"],
        summary: "Restore snapshot to original or alternate location",
      },
    },
  )
  .post(
    "/rustic/repositories/:id/ls-dirs",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepositoryId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepositoryId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repositoryRecord = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepositoryId.data), dbEq(table.userId, user.id)),
        columns: { id: true, workerId: true },
      });
      if (!repositoryRecord) {
        return status(404, { error: "Repository not found" });
      }

      const backupWorkerIds = await getBackupWorkerIdsForRepository(repositoryRecord.id);
      const targetWorkerId = body.workerId ?? repositoryRecord.workerId ?? backupWorkerIds[0];
      if (!targetWorkerId) {
        return status(400, { error: "No worker available for this repository" });
      }

      const result = await getWorkerForProxy(user.id, targetWorkerId);
      if ("error" in result) {
        return status(result.status, { error: result.error });
      }

      try {
        const proxy = await proxyToWorker(
          result.worker.endpoint,
          result.worker.syncToken,
          "/rustic/ls-dirs",
          "POST",
          { path: body.path },
        );
        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        path: t.Optional(t.String({ maxLength: 4096 })),
        workerId: t.Optional(t.String({ format: "uuid" })),
      }),
      detail: {
        tags: ["Rustic"],
        summary: "List directories on the worker filesystem at a given path",
      },
    },
  )
  .get(
    "/rustic/events",
    async ({ request, query, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const requestedLimit = Number(query.limit ?? 50);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(200, Math.floor(requestedLimit)))
        : 50;

      return {
        events: await getBackupEventsForUser(user.id, {
          repositoryId: query.repositoryId,
          planId: query.planId,
          status: query.status,
          limit,
        }),
      };
    },
    {
      query: t.Object({
        repositoryId: t.Optional(t.String({ format: "uuid" })),
        planId: t.Optional(t.String({ format: "uuid" })),
        status: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
      }),
      response: {
        200: t.Object({ events: t.Array(backupEventSchema) }),
        401: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "List backup events",
      },
    },
  )
  .get(
    "/rustic/plans",
    async ({ request, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      return { plans: await getBackupPlansForUser(user.id) };
    },
    {
      response: {
        200: t.Object({ plans: t.Array(backupPlanSchema) }),
        401: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "List backup plans",
      },
    },
  )
  .post(
    "/rustic/plans",
    async ({ request, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }
      if (!hasRoleAtLeast(user, "admin")) {
        return status(401, { error: "Requires admin role or higher" });
      }

      const parsedCron = parseCronExpression(body.cron);
      if (!parsedCron) {
        return status(400, { error: "Invalid cron expression (expected 5-part cron)" });
      }

      const repository = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, body.repositoryId), dbEq(table.userId, user.id)),
        columns: { id: true },
      });
      if (!repository) {
        return status(404, { error: "Repository not found" });
      }
      const workerIds = await resolveOwnedWorkerIds(user.id, body.workerIds);
      if (workerIds.length === 0) {
        return status(400, { error: "At least one worker is required" });
      }
      const backupWorkerIds = await getBackupWorkerIdsForRepository(repository.id);
      if (workerIds.some((workerId) => !backupWorkerIds.includes(workerId))) {
        return status(400, {
          error: "One or more workers are not attached to repository backup workers",
        });
      }

      const now = new Date();
      const nextRunAt = body.enabled === false ? null : computeNextRun(body.cron, now);
      const planId = crypto.randomUUID();
      const workerPathRulesResult = sanitizeWorkerPathRules(body.workerPathRules, workerIds);
      if (!workerPathRulesResult.ok) {
        return status(400, { error: workerPathRulesResult.error });
      }
      const pathsConfig: PlanPathsConfig = {
        defaultPaths: normalizePaths(body.paths),
        workerPaths: workerPathRulesResult.rules,
      };
      if (!hasAnyPlanPaths(pathsConfig)) {
        return status(400, { error: "At least one backup path is required" });
      }

      await db.insert(backupPlan).values({
        id: planId,
        userId: user.id,
        repositoryId: repository.id,
        workerId: workerIds[0]!,
        name: body.name.trim(),
        cron: body.cron.trim(),
        pathsJson: serializePlanPathsConfig(pathsConfig),
        tagsJson:
          body.tags && body.tags.length > 0
            ? JSON.stringify(body.tags.map((tag) => tag.trim()).filter(Boolean))
            : null,
        dryRun: body.dryRun ?? false,
        enabled: body.enabled ?? true,
        nextRunAt,
        pruneEnabled: body.pruneEnabled ?? false,
        keepLast: body.keepLast ?? null,
        keepDaily: body.keepDaily ?? null,
        keepWeekly: body.keepWeekly ?? null,
        keepMonthly: body.keepMonthly ?? null,
        keepYearly: body.keepYearly ?? null,
        keepWithin: body.keepWithin?.trim() || null,
      });
      await replacePlanWorkers(planId, workerIds);

      const plans = await getBackupPlansForUser(user.id);
      const created = plans.find((plan) => plan.id === planId);
      if (!created) {
        return status(500, { error: "Failed to create backup plan" });
      }

      await writeAuditLog({
        actorUserId: user.id,
        action: "plan.create",
        resourceType: "backup_plan",
        resourceId: created.id,
        metadata: { repositoryId: repository.id, workerIds },
        request,
      });

      return status(201, { plan: created });
    },
    {
      body: createBackupPlanBodySchema,
      response: {
        201: t.Object({ plan: backupPlanSchema }),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Create backup plan",
      },
    },
  )
  .patch(
    "/rustic/plans/:id",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }
      if (!hasRoleAtLeast(user, "admin")) {
        return status(401, { error: "Requires admin role or higher" });
      }

      const parsedPlanId = repositoryIdSchema.safeParse(params.id);
      if (!parsedPlanId.success) {
        return status(400, { error: "Invalid plan id" });
      }

      const existing = await db.query.backupPlan.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedPlanId.data), dbEq(table.userId, user.id)),
        columns: {
          id: true,
          userId: true,
          repositoryId: true,
          workerId: true,
          name: true,
          cron: true,
          pathsJson: true,
          tagsJson: true,
          dryRun: true,
          enabled: true,
          nextRunAt: true,
          pruneEnabled: true,
          keepLast: true,
          keepDaily: true,
          keepWeekly: true,
          keepMonthly: true,
          keepYearly: true,
          keepWithin: true,
        },
      });
      if (!existing) {
        return status(404, { error: "Backup plan not found" });
      }

      const nextCron = body.cron?.trim() ?? existing.cron;
      if (!parseCronExpression(nextCron)) {
        return status(400, { error: "Invalid cron expression (expected 5-part cron)" });
      }

      let nextRepositoryId = body.repositoryId ?? existing.repositoryId;
      const requestedRepositoryId = body.repositoryId;
      if (requestedRepositoryId) {
        const repository = await db.query.rusticRepository.findFirst({
          where: (table, { and: dbAnd, eq: dbEq }) =>
            dbAnd(dbEq(table.id, requestedRepositoryId), dbEq(table.userId, user.id)),
          columns: { id: true },
        });
        if (!repository) {
          return status(404, { error: "Repository not found" });
        }
        nextRepositoryId = repository.id;
      }
      const existingPlanWorkerRows = await db
        .select({ workerId: backupPlanWorker.workerId })
        .from(backupPlanWorker)
        .where(eq(backupPlanWorker.planId, existing.id));
      const currentWorkerIds = Array.from(
        new Set(
          existingPlanWorkerRows.length > 0
            ? existingPlanWorkerRows.map((row) => row.workerId)
            : [existing.workerId],
        ),
      );
      const nextWorkerIds = body.workerIds
        ? await resolveOwnedWorkerIds(user.id, body.workerIds)
        : currentWorkerIds;
      if (nextWorkerIds.length === 0) {
        return status(400, { error: "At least one worker is required" });
      }
      const backupWorkerIds = await getBackupWorkerIdsForRepository(nextRepositoryId);
      if (nextWorkerIds.some((workerId) => !backupWorkerIds.includes(workerId))) {
        return status(400, {
          error: "One or more workers are not attached to repository backup workers",
        });
      }

      const nextEnabled = body.enabled ?? existing.enabled;
      const nextRunAt = nextEnabled ? computeNextRun(nextCron, new Date()) : null;
      const workerPathRulesResult = sanitizeWorkerPathRules(body.workerPathRules, nextWorkerIds);
      if (!workerPathRulesResult.ok) {
        return status(400, { error: workerPathRulesResult.error });
      }
      const existingPathsConfig = parsePlanPathsConfig(existing.pathsJson);
      const nextDefaultPaths = body.paths
        ? normalizePaths(body.paths)
        : existingPathsConfig.defaultPaths;
      const nextWorkerPathRules =
        body.workerPathRules === undefined
          ? existingPathsConfig.workerPaths
          : workerPathRulesResult.rules;
      const nextPathsConfig: PlanPathsConfig = {
        defaultPaths: nextDefaultPaths,
        workerPaths: nextWorkerPathRules,
      };
      if (!hasAnyPlanPaths(nextPathsConfig)) {
        return status(400, { error: "At least one backup path is required" });
      }

      await db
        .update(backupPlan)
        .set({
          repositoryId: nextRepositoryId,
          workerId: nextWorkerIds[0]!,
          name: body.name?.trim() ?? existing.name,
          cron: nextCron,
          pathsJson: serializePlanPathsConfig(nextPathsConfig),
          tagsJson:
            body.tags === undefined
              ? existing.tagsJson
              : body.tags.length > 0
                ? JSON.stringify(body.tags.map((tag) => tag.trim()).filter(Boolean))
                : null,
          dryRun: body.dryRun ?? existing.dryRun,
          enabled: nextEnabled,
          nextRunAt,
          pruneEnabled:
            body.pruneEnabled === null ? false : (body.pruneEnabled ?? existing.pruneEnabled),
          keepLast: body.keepLast === null ? null : (body.keepLast ?? existing.keepLast),
          keepDaily: body.keepDaily === null ? null : (body.keepDaily ?? existing.keepDaily),
          keepWeekly: body.keepWeekly === null ? null : (body.keepWeekly ?? existing.keepWeekly),
          keepMonthly:
            body.keepMonthly === null ? null : (body.keepMonthly ?? existing.keepMonthly),
          keepYearly: body.keepYearly === null ? null : (body.keepYearly ?? existing.keepYearly),
          keepWithin:
            body.keepWithin === null ? null : body.keepWithin?.trim() || existing.keepWithin,
        })
        .where(eq(backupPlan.id, existing.id));
      await replacePlanWorkers(existing.id, nextWorkerIds);

      const plans = await getBackupPlansForUser(user.id);
      const updated = plans.find((plan) => plan.id === existing.id);
      if (!updated) {
        return status(500, { error: "Failed to update backup plan" });
      }

      await writeAuditLog({
        actorUserId: user.id,
        action: "plan.update",
        resourceType: "backup_plan",
        resourceId: updated.id,
        request,
      });

      return { plan: updated };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: updateBackupPlanBodySchema,
      response: {
        200: t.Object({ plan: backupPlanSchema }),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Update backup plan",
      },
    },
  )
  .delete(
    "/rustic/plans/:id",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }
      if (!hasRoleAtLeast(user, "admin")) {
        return status(401, { error: "Requires admin role or higher" });
      }

      const parsedPlanId = repositoryIdSchema.safeParse(params.id);
      if (!parsedPlanId.success) {
        return status(400, { error: "Invalid plan id" });
      }

      const existing = await db.query.backupPlan.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedPlanId.data), dbEq(table.userId, user.id)),
        columns: { id: true },
      });
      if (!existing) {
        return status(404, { error: "Backup plan not found" });
      }

      await db.delete(backupPlan).where(eq(backupPlan.id, existing.id));
      await writeAuditLog({
        actorUserId: user.id,
        action: "plan.delete",
        resourceType: "backup_plan",
        resourceId: existing.id,
        request,
      });
      return new Response(null, { status: 204 });
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        204: t.Void(),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Delete backup plan",
      },
    },
  )
  .get(
    "/rustic/plans/:id/runs",
    async ({ request, params, query, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedPlanId = repositoryIdSchema.safeParse(params.id);
      if (!parsedPlanId.success) {
        return status(400, { error: "Invalid plan id" });
      }

      const existing = await db.query.backupPlan.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedPlanId.data), dbEq(table.userId, user.id)),
        columns: { id: true },
      });
      if (!existing) {
        return status(404, { error: "Backup plan not found" });
      }

      const requestedLimit = Number(query.limit ?? 50);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(200, Math.floor(requestedLimit)))
        : 50;

      return { runs: await getBackupPlanRunsForUserPlan(user.id, existing.id, limit) };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      query: t.Object({ limit: t.Optional(t.Numeric()) }),
      response: {
        200: t.Object({ runs: t.Array(backupPlanRunSchema) }),
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "List backup plan runs",
      },
    },
  )
  .post(
    "/rustic/plans/:id/run",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }
      if (!hasRoleAtLeast(user, "operator")) {
        return status(401, { error: "Requires operator role or higher" });
      }

      const parsedPlanId = repositoryIdSchema.safeParse(params.id);
      if (!parsedPlanId.success) {
        return status(400, { error: "Invalid plan id" });
      }

      const existing = await db.query.backupPlan.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedPlanId.data), dbEq(table.userId, user.id)),
        columns: {
          id: true,
          userId: true,
          repositoryId: true,
          workerId: true,
          name: true,
          cron: true,
          pathsJson: true,
          tagsJson: true,
          dryRun: true,
          enabled: true,
          lastRunAt: true,
          nextRunAt: true,
          lastStatus: true,
          lastError: true,
          lastDurationMs: true,
          pruneEnabled: true,
          keepLast: true,
          keepDaily: true,
          keepWeekly: true,
          keepMonthly: true,
          keepYearly: true,
          keepWithin: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!existing) {
        return status(404, { error: "Backup plan not found" });
      }

      const locked = await acquireBackupPlanLease(existing.id);
      if (!locked) {
        return status(409, { error: "Backup plan is already running" });
      }

      void (async () => {
        try {
          await enqueueBackupPlanRuns(existing);
        } finally {
          await releaseBackupPlanLease(existing.id);
        }
      })();
      await writeAuditLog({
        actorUserId: user.id,
        action: "plan.run",
        resourceType: "backup_plan",
        resourceId: existing.id,
        request,
      });
      return status(202, { ok: true });
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        202: t.Object({ ok: t.Boolean() }),
        409: errorResponseSchema,
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
      detail: {
        tags: ["Rustic"],
        summary: "Run backup plan now",
      },
    },
  )
  .post(
    "/rustic/plans/bulk",
    async ({ request, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const requiresAdmin = body.action === "delete";
      if (!hasRoleAtLeast(user, requiresAdmin ? "admin" : "operator")) {
        return status(401, {
          error: `Requires ${requiresAdmin ? "admin" : "operator"} role or higher`,
        });
      }

      const planIds = Array.from(new Set(body.planIds)).slice(0, 200);
      if (planIds.length === 0) {
        return status(400, { error: "At least one plan id is required" });
      }

      const plans = await db.query.backupPlan.findMany({
        where: (table, { and: dbAnd, eq: dbEq, inArray }) =>
          dbAnd(dbEq(table.userId, user.id), inArray(table.id, planIds)),
        columns: {
          id: true,
          userId: true,
          repositoryId: true,
          workerId: true,
          name: true,
          cron: true,
          pathsJson: true,
          tagsJson: true,
          dryRun: true,
          enabled: true,
          lastRunAt: true,
          nextRunAt: true,
          lastStatus: true,
          lastError: true,
          lastDurationMs: true,
          pruneEnabled: true,
          keepLast: true,
          keepDaily: true,
          keepWeekly: true,
          keepMonthly: true,
          keepYearly: true,
          keepWithin: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const foundById = new Map(plans.map((plan) => [plan.id, plan]));
      const results: Array<{ planId: string; ok: boolean; message: string }> = [];

      for (const planId of planIds) {
        const plan = foundById.get(planId);
        if (!plan) {
          results.push({ planId, ok: false, message: "Plan not found" });
          continue;
        }

        try {
          if (body.action === "pause") {
            await db
              .update(backupPlan)
              .set({ enabled: false, nextRunAt: null })
              .where(eq(backupPlan.id, plan.id));
            results.push({ planId, ok: true, message: "Paused" });
            continue;
          }
          if (body.action === "resume") {
            await db
              .update(backupPlan)
              .set({ enabled: true, nextRunAt: computeNextRun(plan.cron, new Date()) })
              .where(eq(backupPlan.id, plan.id));
            results.push({ planId, ok: true, message: "Resumed" });
            continue;
          }
          if (body.action === "delete") {
            await db.delete(backupPlan).where(eq(backupPlan.id, plan.id));
            results.push({ planId, ok: true, message: "Deleted" });
            continue;
          }

          const locked = await acquireBackupPlanLease(plan.id);
          if (!locked) {
            results.push({ planId, ok: false, message: "Already running" });
            continue;
          }
          void (async () => {
            try {
              await enqueueBackupPlanRuns(plan);
            } finally {
              await releaseBackupPlanLease(plan.id);
            }
          })();
          results.push({ planId, ok: true, message: "Triggered" });
        } catch (error) {
          results.push({
            planId,
            ok: false,
            message: error instanceof Error ? error.message : "Operation failed",
          });
        }
      }

      await writeAuditLog({
        actorUserId: user.id,
        action: `plan.bulk.${body.action}`,
        resourceType: "backup_plan",
        metadata: { planIds, results },
        request,
      });

      return {
        action: body.action,
        requested: planIds.length,
        ok: results.filter((item) => item.ok).length,
        failed: results.filter((item) => !item.ok).length,
        results,
      };
    },
    {
      body: t.Object({
        action: t.Union([
          t.Literal("trigger"),
          t.Literal("pause"),
          t.Literal("resume"),
          t.Literal("delete"),
        ]),
        planIds: t.Array(t.String({ format: "uuid" }), { minItems: 1, maxItems: 200 }),
      }),
      detail: {
        tags: ["Rustic"],
        summary: "Bulk operation for backup plans",
      },
    },
  )
  .get(
    "/workers/:id/rustic/version",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const result = await getWorkerForProxy(user.id, params.id);
      if ("error" in result) {
        return status(result.status, { error: result.error });
      }

      try {
        const proxy = await proxyToWorker(
          result.worker.endpoint,
          result.worker.syncToken,
          "/rustic/version",
        );
        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Rustic Proxy"],
        summary: "Proxy: Get Rustic version from worker",
      },
    },
  )
  .get(
    "/workers/:id/rustic/snapshots",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const result = await getWorkerForProxy(user.id, params.id);
      if ("error" in result) {
        return status(result.status, { error: result.error });
      }

      try {
        const proxy = await proxyToWorker(
          result.worker.endpoint,
          result.worker.syncToken,
          "/rustic/snapshots",
        );
        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Rustic Proxy"],
        summary: "Proxy: Get Rustic snapshots from worker",
      },
    },
  )
  .get(
    "/workers/:id/rustic/repo-stats",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const result = await getWorkerForProxy(user.id, params.id);
      if ("error" in result) {
        return status(result.status, { error: result.error });
      }

      try {
        const proxy = await proxyToWorker(
          result.worker.endpoint,
          result.worker.syncToken,
          "/rustic/stats",
        );
        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Rustic Proxy"],
        summary: "Proxy: Get Rustic repo stats from worker",
      },
    },
  )
  .post(
    "/workers/:id/rustic/backup",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const result = await getWorkerForProxy(user.id, params.id);
      if ("error" in result) {
        return status(result.status, { error: result.error });
      }

      try {
        const rawOptions = { ...(body.options ?? {}) };
        const backupOptions = hasRcloneOptions(rawOptions)
          ? rawOptions
          : body.backend === "s3" && hasLegacyS3Options(rawOptions)
            ? enrichRcloneOptionsFromS3(rawOptions)
            : rawOptions;
        const shouldForceRcloneBackup =
          body.backend === "rclone" ||
          body.repository.startsWith("rclone:") ||
          (body.backend === "s3" &&
            (hasRcloneOptions(backupOptions) || hasLegacyS3Options(backupOptions)));

        if (!shouldForceRcloneBackup && body.repository.startsWith("s3:")) {
          return status(400, {
            error:
              "S3 repositories require rclone-backed options. Use a saved repository or provide rclone options.",
          });
        }

        const backupBackend = shouldForceRcloneBackup ? "rclone" : body.backend;
        const backupRepository = shouldForceRcloneBackup
          ? deriveRcloneRepositoryForInit(body.repository, params.id, backupOptions)
          : body.repository;

        const proxy = await proxyToWorker(
          result.worker.endpoint,
          result.worker.syncToken,
          "/rustic/backup",
          "POST",
          {
            backend: backupBackend,
            options: backupOptions,
            repository: backupRepository,
            password: body.password,
            paths: body.paths,
            tags: body.tags,
            dryRun: body.dryRun,
          },
        );
        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        backend: t.Optional(t.String()),
        options: t.Optional(t.Record(t.String(), t.String())),
        repository: t.String({ minLength: 1 }),
        password: t.Optional(t.String()),
        paths: t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
        tags: t.Optional(t.Array(t.String())),
        dryRun: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ["Rustic Proxy"],
        summary: "Proxy: Trigger Rustic backup on worker",
      },
    },
  )
  .post(
    "/rustic/repositories/:id/prune",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepoId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepoId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repository = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepoId.data), dbEq(table.userId, user.id)),
        columns: {
          id: true,
          name: true,
          backend: true,
          repository: true,
          password: true,
          optionsJson: true,
          workerId: true,
        },
      });
      if (!repository) {
        return status(404, { error: "Repository not found" });
      }

      const backupWorkerIds = await getBackupWorkerIdsForRepository(repository.id);
      const targetWorkerId = body.workerId ?? repository.workerId ?? backupWorkerIds[0];
      if (!targetWorkerId) {
        return status(400, { error: "No worker available for this repository" });
      }

      const proxyWorker = await getWorkerForProxy(user.id, targetWorkerId);
      if ("error" in proxyWorker) {
        return status(proxyWorker.status as 502, { error: proxyWorker.error });
      }

      const rawOptions = parseOptionsJson(repository.optionsJson);
      const pruneOptions = hasRcloneOptions(rawOptions)
        ? rawOptions
        : repository.backend === "s3" && hasLegacyS3Options(rawOptions)
          ? enrichRcloneOptionsFromS3(rawOptions)
          : rawOptions;
      const shouldForceRclone =
        repository.backend === "rclone" ||
        (repository.backend === "s3" &&
          (hasRcloneOptions(pruneOptions) || hasLegacyS3Options(pruneOptions)));
      const pruneBackend = shouldForceRclone ? "rclone" : repository.backend;
      const pruneRepository = shouldForceRclone
        ? deriveRcloneRepositoryForInit(repository.repository, repository.id, pruneOptions)
        : repository.repository;

      try {
        const forgetBody: Record<string, unknown> = {
          backend: pruneBackend,
          options: pruneOptions,
          repository: pruneRepository,
          password: repository.password ?? undefined,
          prune: true,
          dryRun: body.dryRun ?? false,
        };
        if (body.keepLast != null) forgetBody.keepLast = body.keepLast;
        if (body.keepDaily != null) forgetBody.keepDaily = body.keepDaily;
        if (body.keepWeekly != null) forgetBody.keepWeekly = body.keepWeekly;
        if (body.keepMonthly != null) forgetBody.keepMonthly = body.keepMonthly;
        if (body.keepYearly != null) forgetBody.keepYearly = body.keepYearly;
        if (body.keepWithin) forgetBody.keepWithin = body.keepWithin;

        const proxy = await proxyToWorker(
          proxyWorker.worker.endpoint,
          proxyWorker.worker.syncToken,
          "/rustic/forget",
          "POST",
          forgetBody,
        );

        await createBackupEvent({
          userId: user.id,
          repositoryId: repository.id,
          workerId: targetWorkerId,
          type: "prune_completed",
          status: proxy.status >= 200 && proxy.status < 300 ? "resolved" : "open",
          severity: proxy.status >= 200 && proxy.status < 300 ? "info" : "error",
          message:
            proxy.status >= 200 && proxy.status < 300
              ? "Manual prune completed"
              : "Manual prune failed",
        });

        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        workerId: t.Optional(t.String({ format: "uuid" })),
        keepLast: t.Optional(t.Number({ minimum: 0 })),
        keepDaily: t.Optional(t.Number({ minimum: 0 })),
        keepWeekly: t.Optional(t.Number({ minimum: 0 })),
        keepMonthly: t.Optional(t.Number({ minimum: 0 })),
        keepYearly: t.Optional(t.Number({ minimum: 0 })),
        keepWithin: t.Optional(t.String({ maxLength: 64 })),
        dryRun: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ["Rustic"],
        summary: "Prune repository snapshots",
      },
    },
  )
  .post(
    "/rustic/repositories/:id/forget-snapshot",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        return status(401, { error: "Unauthorized" });
      }

      const parsedRepoId = repositoryIdSchema.safeParse(params.id);
      if (!parsedRepoId.success) {
        return status(400, { error: "Invalid repository id" });
      }

      const repository = await db.query.rusticRepository.findFirst({
        where: (table, { and: dbAnd, eq: dbEq }) =>
          dbAnd(dbEq(table.id, parsedRepoId.data), dbEq(table.userId, user.id)),
        columns: {
          id: true,
          name: true,
          backend: true,
          repository: true,
          password: true,
          optionsJson: true,
          workerId: true,
        },
      });
      if (!repository) {
        return status(404, { error: "Repository not found" });
      }

      const backupWorkerIds = await getBackupWorkerIdsForRepository(repository.id);
      const targetWorkerId = body.workerId ?? repository.workerId ?? backupWorkerIds[0];
      if (!targetWorkerId) {
        return status(400, { error: "No worker available for this repository" });
      }

      const proxyWorker = await getWorkerForProxy(user.id, targetWorkerId);
      if ("error" in proxyWorker) {
        return status(proxyWorker.status as 502, { error: proxyWorker.error });
      }

      const rawOptions = parseOptionsJson(repository.optionsJson);
      const forgetOptions = hasRcloneOptions(rawOptions)
        ? rawOptions
        : repository.backend === "s3" && hasLegacyS3Options(rawOptions)
          ? enrichRcloneOptionsFromS3(rawOptions)
          : rawOptions;
      const shouldForceRclone =
        repository.backend === "rclone" ||
        (repository.backend === "s3" &&
          (hasRcloneOptions(forgetOptions) || hasLegacyS3Options(forgetOptions)));
      const forgetBackend = shouldForceRclone ? "rclone" : repository.backend;
      const forgetRepository = shouldForceRclone
        ? deriveRcloneRepositoryForInit(repository.repository, repository.id, forgetOptions)
        : repository.repository;

      try {
        // For single snapshot forget, we use rustic forget <snapshotId> --prune
        // We pass keepLast=0 and the snapshot ID in the request
        const forgetBody: Record<string, unknown> = {
          backend: forgetBackend,
          options: forgetOptions,
          repository: forgetRepository,
          password: repository.password ?? undefined,
          prune: true,
          keepLast: 0,
          keepDaily: 0,
          keepWeekly: 0,
          keepMonthly: 0,
          keepYearly: 0,
        };

        const proxy = await proxyToWorker(
          proxyWorker.worker.endpoint,
          proxyWorker.worker.syncToken,
          "/rustic/forget",
          "POST",
          forgetBody,
        );

        await createBackupEvent({
          userId: user.id,
          repositoryId: repository.id,
          workerId: targetWorkerId,
          type: "snapshot_forgotten",
          status: proxy.status >= 200 && proxy.status < 300 ? "resolved" : "open",
          severity: proxy.status >= 200 && proxy.status < 300 ? "info" : "error",
          message:
            proxy.status >= 200 && proxy.status < 300
              ? `Snapshot ${body.snapshotId} forgotten`
              : `Failed to forget snapshot ${body.snapshotId}`,
          details: { snapshotId: body.snapshotId },
        });

        return status(proxy.status as 200, proxy.data);
      } catch {
        return status(502, { error: "Failed to reach worker" });
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        snapshotId: t.String({ minLength: 1 }),
        workerId: t.Optional(t.String({ format: "uuid" })),
      }),
      detail: {
        tags: ["Rustic"],
        summary: "Forget a single snapshot",
      },
    },
  )
  .get("/rustic/repository-size", async ({ request, query, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const remote =
      typeof query?.remote === "string" && query.remote.trim().length > 0 && query.remote.trim();

    const result = await getAnyHealthyWorkerForProxy(user.id);
    if ("error" in result) {
      return status(result.status, { error: result.error });
    }

    try {
      const proxy = await proxyToWorker(
        result.worker.endpoint,
        result.worker.syncToken,
        "/rustic/rclone-size",
        "POST",
        { remote },
      );
      return status(proxy.status as 200, proxy.data);
    } catch (error) {
      logError("repository size proxy request failed", {
        userId: user.id,
        workerId: result.worker.id,
        remote,
        error: error instanceof Error ? error.message : String(error),
      });
      return status(503, { error: "Failed to reach worker" });
    }
  });
