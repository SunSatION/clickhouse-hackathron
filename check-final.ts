import { getClickHouse } from "./src/db/clickhouse.js";

async function main() {
  const ch = getClickHouse();
  // Test if airline_routes FINAL works
  try {
    const r = await ch.query({ query: "SELECT count() AS n FROM airline_routes FINAL", format: "JSONEachRow" });
    console.log("airline_routes FINAL works:", JSON.stringify(await r.json()));
  } catch (e) {
    console.log("airline_routes FINAL error:", (e as Error).message);
  }
  try {
    const r = await ch.query({ query: "SELECT count() AS n FROM airports FINAL", format: "JSONEachRow" });
    console.log("airports FINAL works:", JSON.stringify(await r.json()));
  } catch (e) {
    console.log("airports FINAL error:", (e as Error).message);
  }
}
main().catch(console.error);