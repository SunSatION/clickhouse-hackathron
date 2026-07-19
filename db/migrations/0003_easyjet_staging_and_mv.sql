CREATE TABLE IF NOT EXISTS easyjet_listings
(
  airline          LowCardinality(String) DEFAULT 'EasyJet',
  airline_code     LowCardinality(String) DEFAULT 'U2',
  origin_iata      LowCardinality(String),
  destination_iata LowCardinality(String),

  departure_date   Date,
  departure_datetime DateTime DEFAULT toDateTime('00:00:00'),
  arrival_datetime   Nullable(DateTime),

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

CREATE MATERIALIZED VIEW IF NOT EXISTS flight_listings_easyjet_mv
TO flight_listings AS
SELECT
  airline,
  airline_code,
  origin_iata,
  destination_iata,
  '' AS flight_number,
  departure_date,
  CAST(toDateTime('00:00:00'), 'DateTime') AS departure_datetime,
  CAST(NULL, 'Nullable(DateTime)') AS arrival_datetime,
  CAST(NULL, 'Nullable(UInt16)') AS duration_minutes,
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
FROM easyjet_listings;