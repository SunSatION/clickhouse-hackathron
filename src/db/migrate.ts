import { getClickHouse } from "./clickhouse";
import { migrations, type Migration } from "../../db/migrations";

export async function ensureMigrationsTable(): Promise<void> {
  await getClickHouse().command({
    query:
      "CREATE TABLE IF NOT EXISTS _migrations (name String, applied_at DateTime DEFAULT now()) ENGINE = MergeTree() ORDER BY name",
  });
}

export async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await getClickHouse().query({
    query: "SELECT name FROM _migrations",
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

export async function runMigrations(
  pending: Migration[] = migrations
): Promise<{ applied: string[]; skipped: string[] }> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const justApplied: string[] = [];
  const skipped: string[] = [];
  const ch = getClickHouse();

  for (const migration of pending) {
    if (applied.has(migration.name)) {
      skipped.push(migration.name);
      continue;
    }
    const statements = splitStatements(migration.sql);
    for (const stmt of statements) {
      if (!stmt.trim()) continue;
      await ch.command({ query: stmt });
    }
    await ch.insert({
      table: "_migrations",
      format: "JSONEachRow",
      values: [{ name: migration.name }],
    });
    justApplied.push(migration.name);
  }

  return { applied: justApplied, skipped };
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
