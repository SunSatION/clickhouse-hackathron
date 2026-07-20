import {
  createClient,
  type BaseClickHouseClientConfigOptions,
  type ClickHouseClient,
} from "@clickhouse/client";

let client: ClickHouseClient | undefined;
let otelClient: ClickHouseClient | undefined;

export function getClickHouse(): ClickHouseClient {
  if (client) return client;

  const url = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
  const database = process.env.CLICKHOUSE_DATABASE ?? "default";

  client = createClient({
    url,
    database,
    request_timeout: 90_000,
    max_open_connections: 10,
    compression: { request: true, response: true },
    username: process.env.CLICKHOUSE_USERNAME,
    password: process.env.CLICKHOUSE_PASSWORD,
  });
  return client;
}

export function getClickHouseForOtel(): ClickHouseClient {
  if (otelClient) return otelClient;

  const url = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
  const database = process.env.OTEL_DATABASE ?? "otel";

  otelClient = createClient({
    url,
    database,
    request_timeout: 90_000,
    max_open_connections: 10,
    compression: { request: true, response: true },
    username: process.env.CLICKHOUSE_USERNAME,
    password: process.env.CLICKHOUSE_PASSWORD,
  });
  return otelClient;
}

export async function pingClickHouse(): Promise<boolean> {
  const result = await getClickHouse().ping();
  return Boolean(result.success);
}

export type { ClickHouseClient };
