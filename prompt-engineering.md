# Prompt Engineering — Test Cases

| id | category | prompt | expected_output | pass_criteria | notes |
|---|---|---|---|---|---|
| 1 | origin_selection | Show me flights from TPS | Selects TPS as origin on the map; loads destinations and draws outbound arrows | Origin marker highlighted; destinations fetched within 2s; arrows visible | TPS = Trapani, smaller origin — verify route coverage |
| 2 | cheapest_search | Cheapest 5 flights from STN | Side panel populates with 5 lowest-price flights departing STN, each linked to its destination on the map | Exactly 5 results; sorted ascending by price; destinations highlighted on map | Test with date range vs single date |
| 3 | destination_discovery | Destination airports from DUB | Map draws arrows from DUB to each reachable destination; tooltip per arrow shows cheapest fare and flight duration | All destinations from DUB shown; arrow metadata includes both price and duration; no duplicates | Verify metadata updates when date range changes |
| 4 | price_filter | Flights under £50 from STN | Filters visible destinations to only those with fares below £50; greys out / hides others | Only sub-£50 routes shown; arrow count matches filtered result set | Currency display: £ symbol consistent |
| 5 | duration_compare | Fastest flight to BCN from any London airport | Highlights the shortest-duration route from LON-area origins (STN, LGW, LTN, LHR, LCY) to BCN; shows duration on arrow | Single arrow emphasised; duration value visible; comparison across multiple origins | |
| 6 | multi_origin_compare | Compare STN and LGW to DUB | Side panel shows two parallel listings (one per origin); map shows both arrows with side-by-side metadata | Both origins active; results distinguishable; same date range applied to both |  |
| 7 |  |  |  |  |  |
| 8 |  |  |  |  |  |