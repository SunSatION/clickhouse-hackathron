import { getClickHouse } from "./src/db/clickhouse.js";

async function main() {
  const ch = getClickHouse();
  const r = await ch.query({ query: "SHOW TABLES", format: "TabSeparated" });
  console.log("Tables:", await r.text());
  const r2 = await ch.query({ query: "SHOW CREATE TABLE airline_routes", format: "TabSeparated" });
  console.log("airline_routes:", await r2.text());
}
main().catch(console.error);