import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: "../../apps/server/.env" });

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for drift repair");
  }

  const client = new Client({ connectionString });
  await client.connect();

  const statements = [
    `ALTER TABLE backup_plan_run ADD COLUMN IF NOT EXISTS type text DEFAULT 'backup' NOT NULL`,
    `ALTER TABLE backup_plan ADD COLUMN IF NOT EXISTS prune_enabled boolean DEFAULT false NOT NULL`,
    `ALTER TABLE backup_plan ADD COLUMN IF NOT EXISTS keep_last integer`,
    `ALTER TABLE backup_plan ADD COLUMN IF NOT EXISTS keep_daily integer`,
    `ALTER TABLE backup_plan ADD COLUMN IF NOT EXISTS keep_weekly integer`,
    `ALTER TABLE backup_plan ADD COLUMN IF NOT EXISTS keep_monthly integer`,
    `ALTER TABLE backup_plan ADD COLUMN IF NOT EXISTS keep_yearly integer`,
    `ALTER TABLE backup_plan ADD COLUMN IF NOT EXISTS keep_within text`,
    `ALTER TABLE backup_plan ADD COLUMN IF NOT EXISTS run_lease_until timestamp`,
    `ALTER TABLE backup_plan ADD COLUMN IF NOT EXISTS run_lease_owner text`,
  ];

  for (const statement of statements) {
    await client.query(statement);
  }

  await client.end();
  console.log("db drift repair completed");
}

void run();
