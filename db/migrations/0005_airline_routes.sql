CREATE TABLE IF NOT EXISTS airline_routes
(
  airline_code      LowCardinality(String),
  origin_iata       LowCardinality(String),
  destination_iata  LowCardinality(String),
  destination_name  LowCardinality(String) DEFAULT '',
  base              Bool DEFAULT false,
  fetched_at        DateTime DEFAULT now(),
  updated_at        DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY (airline_code, origin_iata, destination_iata);