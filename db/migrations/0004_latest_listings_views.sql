CREATE OR REPLACE VIEW flight_listings_latest AS
SELECT
  departure_date,
  origin_iata,
  destination_iata,
  departure_datetime,
  argMax(airline, observed_at) AS airline,
  argMax(airline_code, observed_at) AS airline_code,
  argMax(flight_number, observed_at) AS flight_number,
  argMax(arrival_datetime, observed_at) AS arrival_datetime,
  argMax(duration_minutes, observed_at) AS duration_minutes,
  argMax(currency, observed_at) AS currency,
  argMax(price, observed_at) AS price,
  argMax(original_price, observed_at) AS original_price,
  argMax(fare_type, observed_at) AS fare_type,
  argMax(fare_class, observed_at) AS fare_class,
  argMax(seats_left, observed_at) AS seats_left,
  max(observed_at) AS latest_observed_at,
  argMax(source, observed_at) AS source,
  argMax(search_origin, observed_at) AS search_origin,
  argMax(crawl_run_id, observed_at) AS crawl_run_id
FROM flight_listings
GROUP BY departure_date, origin_iata, destination_iata, departure_datetime;

CREATE OR REPLACE VIEW ryanair_listings_latest AS
SELECT
  departure_date,
  origin_iata,
  destination_iata,
  departure_datetime,
  argMax(airline, observed_at) AS airline,
  argMax(airline_code, observed_at) AS airline_code,
  argMax(flight_number, observed_at) AS flight_number,
  argMax(arrival_datetime, observed_at) AS arrival_datetime,
  argMax(duration_minutes, observed_at) AS duration_minutes,
  argMax(currency, observed_at) AS currency,
  argMax(price, observed_at) AS price,
  argMax(original_price, observed_at) AS original_price,
  argMax(fare_type, observed_at) AS fare_type,
  argMax(fare_class, observed_at) AS fare_class,
  argMax(seats_left, observed_at) AS seats_left,
  max(observed_at) AS latest_observed_at,
  argMax(source, observed_at) AS source,
  argMax(search_origin, observed_at) AS search_origin,
  argMax(crawl_run_id, observed_at) AS crawl_run_id,
  argMax(received_at, observed_at) AS received_at
FROM ryanair_listings
GROUP BY departure_date, origin_iata, destination_iata, departure_datetime;

CREATE OR REPLACE VIEW easyjet_listings_latest AS
SELECT
  departure_date,
  origin_iata,
  destination_iata,
  departure_datetime,
  argMax(airline, observed_at) AS airline,
  argMax(airline_code, observed_at) AS airline_code,
  argMax(arrival_datetime, observed_at) AS arrival_datetime,
  argMax(currency, observed_at) AS currency,
  argMax(price, observed_at) AS price,
  argMax(original_price, observed_at) AS original_price,
  argMax(fare_type, observed_at) AS fare_type,
  argMax(fare_class, observed_at) AS fare_class,
  argMax(seats_left, observed_at) AS seats_left,
  max(observed_at) AS latest_observed_at,
  argMax(source, observed_at) AS source,
  argMax(search_origin, observed_at) AS search_origin,
  argMax(crawl_run_id, observed_at) AS crawl_run_id,
  argMax(received_at, observed_at) AS received_at
FROM easyjet_listings
GROUP BY departure_date, origin_iata, destination_iata, departure_datetime;