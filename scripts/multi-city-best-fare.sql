-- ============================================================
--  Multi-city best-fare finder  (no CTEs — inline subqueries only)
--  ClickHouse SQL · flights.flight_listings_latest
-- ============================================================
--  Trip you want to book:
--     STN  ->  BCN  ->  LIS  ->  STN        (3 legs, 4 cities)
--
--  Knobs (change these values; nothing else):
--     TRIP_START      = '2026-08-01'   earliest day you can start
--     TRIP_END        = '2026-08-15'   latest day you must be back
--     FLEX_DAYS       = 2              +/- days each leg may shift
--     MAX_TOTAL_PRICE = 350            cap on sum of all legs
--     MAX_LEG_PRICE   = 120            cap on a single leg
--     ANCHOR_CITY     = 'BCN'          city you must be in on...
--     ANCHOR_DAY      = '2026-08-05'   ...this calendar day
-- ============================================================

SELECT
    l1.flight_number        AS leg1_flight,
    l1.origin_iata          AS leg1_from,
    l1.destination_iata     AS leg1_to,
    l1.departure_date       AS leg1_departure,
    l1.arrival_datetime     AS leg1_arrival,
    l1.price                AS leg1_price,

    l2.flight_number        AS leg2_flight,
    l2.origin_iata          AS leg2_from,
    l2.destination_iata     AS leg2_to,
    l2.departure_date       AS leg2_departure,
    l2.arrival_datetime     AS leg2_arrival,
    l2.price                AS leg2_price,

    l3.flight_number        AS leg3_flight,
    l3.origin_iata          AS leg3_from,
    l3.destination_iata     AS leg3_to,
    l3.departure_date       AS leg3_departure,
    l3.arrival_datetime     AS leg3_arrival,
    l3.price                AS leg3_price,

    (l1.price + l2.price + l3.price)            AS total_price,
    l1.currency                                 AS currency

FROM
    -- ──────────────────────────────────────────────────────────
    --  Leg 1 candidates:  STN -> BCN
    --    target depart day = TRIP_START + 1
    --    allowed window    = +/- FLEX_DAYS around target
    --    must fit per-leg budget
    -- ──────────────────────────────────────────────────────────
    (SELECT *
       FROM flights.flight_listings_latest
      WHERE origin_iata      = 'STN'
        AND destination_iata = 'BCN'
        AND departure_date BETWEEN
                toDate('2026-08-01') - INTERVAL 2 DAY
            AND toDate('2026-08-01') + INTERVAL 2 DAY
        AND price <= 120
    ) AS l1

    INNER JOIN
    -- ──────────────────────────────────────────────────────────
    --  Leg 2 candidates:  BCN -> LIS
    --    target depart day = TRIP_START + 5
    -- ──────────────────────────────────────────────────────────
    (SELECT *
       FROM flights.flight_listings_latest
      WHERE origin_iata      = 'BCN'
        AND destination_iata = 'LIS'
        AND departure_date BETWEEN
                toDate('2026-08-06') - INTERVAL 2 DAY
            AND toDate('2026-08-06') + INTERVAL 2 DAY
        AND price <= 120
    ) AS l2
        ON  l2.origin_iata    = l1.destination_iata            -- chains the trip
        AND l2.departure_date >= l1.departure_date             -- can't leave before you arrive

    INNER JOIN
    -- ──────────────────────────────────────────────────────────
    --  Leg 3 candidates:  LIS -> STN
    --    target depart day = TRIP_START + 9
    --    must land by TRIP_END
    -- ──────────────────────────────────────────────────────────
    (SELECT *
       FROM flights.flight_listings_latest
      WHERE origin_iata      = 'LIS'
        AND destination_iata = 'STN'
        AND departure_date BETWEEN
                toDate('2026-08-10') - INTERVAL 2 DAY
            AND toDate('2026-08-10') + INTERVAL 2 DAY
        AND price <= 120
        AND arrival_datetime IS NOT NULL
        AND toDate(arrival_datetime) <= toDate('2026-08-15')
    ) AS l3
        ON  l3.origin_iata    = l2.destination_iata            -- chains the trip
        AND l3.departure_date >= l2.departure_date             -- can't leave before you arrive

WHERE
    -- ─── whole-trip budget ────────────────────────────────────
    (l1.price + l2.price + l3.price) <= 350

    -- ─── anchor: must be in BCN on 2026-08-05 ─────────────────
    --   "arrived in BCN on or before that day"
    --   AND "hasn't left BCN yet on that day"
    AND toDate(l1.arrival_datetime) <= toDate('2026-08-05')
    AND l2.departure_date            > toDate('2026-08-05')

ORDER BY total_price ASC

LIMIT 20;