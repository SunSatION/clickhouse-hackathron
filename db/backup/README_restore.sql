-- Backup of airline_routes table (5246 rows as of 2026-07-18)
-- To restore:
--   npx tsx scripts/run-migrations.ts  (ensure table schema exists first)
--   then run the INSERT below

-- Re-create the backup table:
CREATE TABLE IF NOT EXISTS airline_routes_backup
(
  `airline_code`      LowCardinality(String),
  `origin_iata`       LowCardinality(String),
  `destination_iata`  LowCardinality(String),
  `destination_name` LowCardinality(String) DEFAULT '',
  `base`              Bool DEFAULT false,
  `fetched_at`        DateTime DEFAULT now(),
  `updated_at`        DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY (airline_code, origin_iata, destination_iata);

-- Restore from TSV backup (run in clickhouse client):
-- clickhouse-client --query "INSERT INTO airline_routes_backup FORMAT TabSeparatedRaw" < db/backup/airline_routes_backup_data.tsv

-- Or to restore directly to airline_routes (DANGEROUS - overwrites existing data):
-- clickhouse-client --query "TRUNCATE TABLE airline_routes" && clickhouse-client --query "INSERT INTO airline_routes SELECT * FROM airline_routes_backup"
