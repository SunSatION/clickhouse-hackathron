CREATE TABLE IF NOT EXISTS airports
(
  iata     String,
  name     String,
  city     String DEFAULT '',
  country  LowCardinality(String) DEFAULT '',
  region   String DEFAULT '',
  lat      Float64,
  lon      Float64,
  type     LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree()
ORDER BY iata;
