import { getClickHouse } from "./src/db/clickhouse.js";

async function main() {
  const ch = getClickHouse();
  const r = await ch.query({ query: "SHOW CREATE TABLE airports", format: "TabSeparated" });
  console.log("schema:", await r.text());
  const cnt = await ch.query({ query: "SELECT count() AS n FROM airports", format: "JSONEachRow" });
  console.log("count:", JSON.stringify(await cnt.json()));
}
main().catch(console.error);