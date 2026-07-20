CREATE TABLE IF NOT EXISTS ryanair_listings
(
  airline          LowCardinality(String) DEFAULT 'Ryanair',
  airline_code     LowCardinality(String) DEFAULT 'FR',
  origin_iata      LowCardinality(String),
  destination_iata LowCardinality(String),

  flight_number    LowCardinality(String) DEFAULT '',
  departure_date   Date,
  departure_datetime DateTime DEFAULT toDateTime(0),
  arrival_datetime   Nullable(DateTime),
  duration_minutes Nullable(UInt16),

  currency         LowCardinality(String),
  price            Decimal(10, 2),
  original_price   Nullable(Decimal(10, 2)),
  fare_type        LowCardinality(String) DEFAULT '',
  fare_class       LowCardinality(String) DEFAULT '',
  seats_left       Nullable(UInt16),

  observed_at      DateTime DEFAULT now(),
  source           LowCardinality(String),
  search_origin    LowCardinality(String),
  crawl_run_id     UUID,
  raw              JSON,
  received_at      DateTime DEFAULT now(),
  updated_at       DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(departure_date)
ORDER BY (departure_date, origin_iata, destination_iata, departure_datetime)
TTL departure_date + INTERVAL 2 YEAR;

CREATE MATERIALIZED VIEW IF NOT EXISTS flight_listings_ryanair_mv
TO flight_listings AS
SELECT
  airline,
  airline_code,
  origin_iata,
  destination_iata,
  flight_number,
  departure_date,
  departure_datetime,
  arrival_datetime,
  duration_minutes,
  currency,
  price,
  original_price,
  fare_type,
  fare_class,
  seats_left,
  observed_at,
  source,
  search_origin,
  crawl_run_id,
  raw
FROM ryanair_listings;