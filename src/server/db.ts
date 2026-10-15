import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { SQL } from "bun";

export const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";

export const sql = new SQL(databaseUrl);

export async function pingDatabase() {
  const result = await sql`SELECT 1 AS ok`;
  return result[0]?.ok === 1;
}

export async function runMigrations() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const migrationsDir = join(import.meta.dir, "..", "..", "migrations");
  const migrationFiles = (await readdir(migrationsDir))
    .filter(file => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const appliedFiles: string[] = [];

  for (const migrationFile of migrationFiles) {
    const alreadyApplied = await sql`SELECT 1 FROM schema_migrations WHERE name = ${migrationFile}`;
    if (alreadyApplied.length > 0) {
      continue;
    }

    const migrationPath = join(migrationsDir, migrationFile);
    await sql.file(migrationPath);
    await sql`
      INSERT INTO schema_migrations (name)
      VALUES (${migrationFile})
    `;

    appliedFiles.push(migrationFile);
  }

  return appliedFiles;
}
