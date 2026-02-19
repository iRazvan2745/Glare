import { db } from "@glare/db";
import { storageUsageEvent } from "@glare/db/schema/storage-usage-events";

import { logWarn } from "./logger";

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function findFirstMetricFromSummary(root: unknown, keys: readonly string[]) {
  const queue: unknown[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    const summary = record.summary;
    if (summary && typeof summary === "object" && !Array.isArray(summary)) {
      const summaryRecord = summary as Record<string, unknown>;
      for (const key of keys) {
        const value = parseNumber(summaryRecord[key]);
        if (value !== null) return value;
      }
    }

    queue.push(...Object.values(record));
  }
  return null;
}

function getNumericPathValue(root: unknown, path: string[]) {
  let current: unknown = root;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current === "number" && Number.isFinite(current)) return current;
  if (typeof current === "string" && current.trim().length > 0) {
    const parsed = Number(current);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const STORAGE_BYTE_PATHS = [
  ["rustic", "parsedJson", "summary", "data_added"],
  ["rustic", "parsedJson", "summary", "dataAdded"],
  ["rustic", "parsedJson", "summary", "bytes_added"],
  ["rustic", "parsedJson", "summary", "bytesAdded"],
  ["rustic", "parsed_json", "summary", "data_added"],
  ["rustic", "parsed_json", "summary", "bytes_added"],
  ["rustic", "parsed_json", "summary", "bytesAdded"],
  ["summary", "data_added"],
  ["summary", "dataAdded"],
  ["summary", "bytes_added"],
  ["summary", "bytesAdded"],
] as const;

export function extractStorageBytesFromOutput(output: unknown) {
  const summaryMetric = findFirstMetricFromSummary(output, [
    "data_added",
    "dataAdded",
    "bytes_added",
    "bytesAdded",
  ]);
  if (summaryMetric !== null && summaryMetric !== 0) {
    return Math.trunc(summaryMetric);
  }

  for (const path of STORAGE_BYTE_PATHS) {
    const value = getNumericPathValue(output, [...path]);
    if (value !== null && value !== 0) {
      return Math.trunc(value);
    }
  }
  return null;
}

export async function recordStorageUsageSample(input: {
  userId: string;
  repositoryId: string;
  runId?: string | null;
  output: unknown;
}) {
  const bytesAdded = extractStorageBytesFromOutput(input.output);
  if (bytesAdded === null || !Number.isFinite(bytesAdded) || bytesAdded === 0) {
    return;
  }

  try {
    await db.insert(storageUsageEvent).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      repositoryId: input.repositoryId,
      runId: input.runId ?? null,
      bytesAdded,
      createdAt: new Date(),
    });
  } catch (error) {
    logWarn("storage sample write failed", {
      userId: input.userId,
      repositoryId: input.repositoryId,
      runId: input.runId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
