import { env } from "@glare/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import * as schema from "./schema";

export const db = drizzle(env.DATABASE_URL, { schema });

function resolveMigrationsFolder() {
  const explicitDir = process.env.GLARE_MIGRATIONS_DIR;
  if (explicitDir && explicitDir.trim().length > 0) {
    return explicitDir;
  }

  const candidates = [
    resolve(import.meta.dir, "migrations"),
    resolve(process.cwd(), "packages/db/src/migrations"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to locate migrations folder. Checked: ${candidates.join(", ")}`);
}

export async function runMigrations() {
  await migrate(db, { migrationsFolder: resolveMigrationsFolder() });
}
