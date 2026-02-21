import { db } from "@glare/db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

const REQUIRED_ENV_KEYS = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "NEXT_APP_URL",
  "APP_URL",
] as const;

function checkRequiredEnv() {
  const missing = REQUIRED_ENV_KEYS.filter((key) => {
    const value = process.env[key];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

async function checkDatabaseConnectivity() {
  await db.execute(sql`select 1`);
}

async function repairKnownSchemaDrift() {
  const statements = [
    sql`alter table if exists backup_plan_run add column if not exists type text default 'backup' not null`,
    sql`alter table if exists backup_plan add column if not exists prune_enabled boolean default false not null`,
    sql`alter table if exists backup_plan add column if not exists keep_last integer`,
    sql`alter table if exists backup_plan add column if not exists keep_daily integer`,
    sql`alter table if exists backup_plan add column if not exists keep_weekly integer`,
    sql`alter table if exists backup_plan add column if not exists keep_monthly integer`,
    sql`alter table if exists backup_plan add column if not exists keep_yearly integer`,
    sql`alter table if exists backup_plan add column if not exists keep_within text`,
    sql`alter table if exists backup_plan add column if not exists run_lease_until timestamp`,
    sql`alter table if exists backup_plan add column if not exists run_lease_owner text`,
  ];

  for (const statement of statements) {
    await db.execute(statement);
  }
}

export async function verifyStartupHealth() {
  checkRequiredEnv();
  await checkDatabaseConnectivity();
  await repairKnownSchemaDrift();
  logInfo("startup health check passed");
}

export async function healthSnapshot() {
  try {
    await checkDatabaseConnectivity();
    return { ok: true, db: "up" as const };
  } catch (error) {
    logError("health db check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, db: "down" as const };
  }
}
