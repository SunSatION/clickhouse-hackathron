CREATE TABLE IF NOT EXISTS crawl_progress
(
  airline          LowCardinality(String),
  origin_iata      LowCardinality(String),
  destination_iata LowCardinality(String),
  date_from        Date,
  date_to          Date,
  status           LowCardinality(String),
  crawl_run_id     String,
  rows_inserted    UInt32 DEFAULT 0,
  error_message    String DEFAULT '',
  started_at       DateTime DEFAULT now(),
  completed_at     DateTime DEFAULT now(),
  updated_at       DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(completed_at)
ORDER BY (airline, origin_iata, destination_iata, date_from, date_to)
PARTITION BY toYYYYMM(date_from);
