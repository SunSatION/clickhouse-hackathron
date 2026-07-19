import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface Migration {
  name: string;
  sql: string;
}

const migrationsDir = join(process.cwd(), "db", "migrations");

export const migrations: Migration[] = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((file) => ({
    name: file.replace(/\.sql$/, ""),
    sql: readFileSync(join(migrationsDir, file), "utf8").trim(),
  }));