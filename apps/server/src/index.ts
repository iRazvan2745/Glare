import { startSnapshotSyncInterval, verifyStartupHealth } from "@glare/api";
import { runMigrations } from "@glare/db";

function getPostgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  if ("code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  if ("cause" in error) {
    return getPostgresErrorCode((error as { cause?: unknown }).cause);
  }
  return undefined;
}

try {
  await runMigrations();
} catch (error) {
  const postgresCode = getPostgresErrorCode(error);
  if (postgresCode === "42P07") {
    console.warn("migration skipped due to existing relation", {
      postgresCode,
      error: error instanceof Error ? error.message : String(error),
    });
  } else {
    throw error;
  }
}
await verifyStartupHealth();
startSnapshotSyncInterval();
console.info("jobs service is running");
