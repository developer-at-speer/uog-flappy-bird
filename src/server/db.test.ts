import { afterEach, describe, expect, test } from "bun:test";

const TEST_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/postgres";

async function resetDatabase() {
  const cleanup = await import("bun");
  const sql = new cleanup.SQL(TEST_DATABASE_URL);
  await sql.unsafe("DROP TABLE IF EXISTS scores CASCADE");
  await sql.unsafe("DROP TABLE IF EXISTS runs CASCADE");
  await sql.unsafe("DROP TABLE IF EXISTS players CASCADE");
  await sql.unsafe("DROP TABLE IF EXISTS schema_migrations CASCADE");
}

describe("database migrations", () => {
  afterEach(async () => {
    await resetDatabase();
  });

  test("applies the schema and is idempotent", async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;

    const { sql, runMigrations } = await import("./db");

    await runMigrations();

    const firstPass = await sql`SELECT name FROM schema_migrations ORDER BY applied_at`;
    expect(firstPass).toHaveLength(2);
    expect(firstPass[0].name).toBe("001_init.sql");
    expect(firstPass[1].name).toBe("002_recovery_and_runs.sql");

    await runMigrations();

    const secondPass = await sql`SELECT COUNT(*)::int AS count FROM schema_migrations`;
    expect(Number(secondPass[0].count)).toBe(2);

    const playerTable = await sql`SELECT to_regclass('public.players') AS players`;
    const scoreTable = await sql`SELECT to_regclass('public.scores') AS scores`;
    const runTable = await sql`SELECT to_regclass('public.runs') AS runs`;
    expect(playerTable[0].players).toBe("players");
    expect(scoreTable[0].scores).toBe("scores");
    expect(runTable[0].runs).toBe("runs");
  });
});
