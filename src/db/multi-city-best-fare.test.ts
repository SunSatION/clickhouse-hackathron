import { describe, expect, it } from "vitest";
import { buildMultiCityBestFareQuery } from "./multi-city-best-fare.js";

describe("buildMultiCityBestFareQuery", () => {
  it("searches every leg across the full requested date range", () => {
    const { query, params } = buildMultiCityBestFareQuery(
      "MLA",
      [
        { iata: "PSR", minStay: 2, maxStay: 4 },
        { iata: "VLC", minStay: 2, maxStay: 4 },
        { iata: "FEZ", minStay: 2, maxStay: 4 },
      ],
      {
        homeIata: "MLA",
        stops: [],
        dateFrom: "2026-08-02",
        dateTo: "2026-08-31",
        legFlexDays: 2,
      },
      "2026-08-02",
      "2026-08-31",
    );

    expect(query.match(/departure_date BETWEEN toDate\(\{dateFrom:Date\}\) AND toDate\(\{dateTo:Date\}\)/g)).toHaveLength(4);
    expect(query).not.toContain("_target");
    expect(query).not.toContain("INTERVAL {legFlex:UInt32} DAY");
    expect(params.dateFrom).toBe("2026-08-02");
    expect(params.dateTo).toBe("2026-08-31");
  });

  it("keeps stay and explicit anchor constraints", () => {
    const { query, params } = buildMultiCityBestFareQuery(
      "MLA",
      [{ iata: "PSR", minStay: 2, maxStay: 4 }],
      {
        homeIata: "MLA",
        stops: [],
        dateFrom: "2026-08-02",
        dateTo: "2026-08-31",
        anchor: { city: "PSR", day: "2026-08-20" },
      },
      "2026-08-02",
      "2026-08-31",
    );

    expect(query).toContain("l2.departure_date   >= l1.departure_date + INTERVAL {l1_stay_min:UInt32} DAY");
    expect(query).toContain("l2.departure_date   <= l1.departure_date + INTERVAL {l1_stay_max:UInt32} DAY");
    expect(query).toContain("toDate(l1.arrival_datetime) <= toDate({anchorDay:Date})");
    expect(query).toContain("l2.departure_date > toDate({anchorDay:Date})");
    expect(params.anchorDay).toBe("2026-08-20");
  });
});
