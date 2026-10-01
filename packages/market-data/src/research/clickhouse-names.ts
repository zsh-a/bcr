import { contentHash } from "@bcr/core";
import {
  normalizeConnection,
  type ClickHouseClient,
  type ClickHouseConnection,
  type MetadataRow,
} from "./clickhouse-http";
import { parseDisplayNames, type DisplayNames } from "./display-names";

export const NAME_COLUMNS_SQL =
  "SELECT table,name FROM system.columns WHERE database={db:String} AND table IN ('stock_daily_meta','industry_info') ORDER BY table,position";

export function nameQueries(columns: MetadataRow[]) {
  const has = (table: string, name: string) =>
    columns.some((row) => row["table"] === table && row["name"] === name);
  const clean = (name: string) => `trimBoth(ifNull(${name},''))`;
  const query = (table: string, code: string, name: string, date: string) => {
    const order = has(table, date) ? `tuple(${date},${name})` : name;
    return `SELECT ${code} AS code,argMax(${name},${order}) AS display_name FROM ${table} FINAL WHERE ${code}!='' AND ${name}!='' GROUP BY ${code} ORDER BY ${code} LIMIT 20001`;
  };
  const sectors = ["industry_name", "industry"].filter((name) => has("industry_info", name));
  const industry =
    sectors.length === 2
      ? `coalesce(nullIf(${clean(sectors[0]!)},''),${clean(sectors[1]!)})`
      : sectors.length === 1
        ? clean(sectors[0]!)
        : undefined;
  return {
    instruments:
      has("stock_daily_meta", "code") && has("stock_daily_meta", "name")
        ? query("stock_daily_meta", "code", clean("name"), "last_update_date")
        : undefined,
    industries:
      has("industry_info", "industry_code") && industry
        ? query("industry_info", "industry_code", industry, "enter_date")
        : undefined,
  };
}

export async function loadDisplayNames(
  client: Pick<ClickHouseClient, "connection" | "json">,
  signal: AbortSignal,
): Promise<DisplayNames> {
  const columns = await client.json(NAME_COLUMNS_SQL, { db: client.connection.database }, signal);
  const queries = nameQueries(columns);
  const keys = ["instruments", "industries"] as const;
  const rows = await Promise.all(
    keys.map((key) =>
      queries[key] ? client.json(queries[key]!, {}, signal) : Promise.resolve([]),
    ),
  );
  signal.throwIfAborted();
  const dictionary = (rows: MetadataRow[]) => {
    if (rows.length > 20_000) throw new Error("源库名称数量超过 20,000");
    const entries = rows.map((row) => {
      if (typeof row["code"] !== "string" || typeof row["display_name"] !== "string")
        throw new Error("ClickHouse 名称字段无效");
      return [row["code"], row["display_name"]] as const;
    });
    if (new Set(entries.map(([code]) => code)).size !== entries.length)
      throw new Error("ClickHouse 返回重复名称代码");
    return Object.fromEntries(entries);
  };
  return parseDisplayNames({
    instruments: dictionary(rows[0]!),
    industries: dictionary(rows[1]!),
    capturedAt: new Date().toISOString(),
  });
}

/** A single small, source-scoped metadata record; never includes credentials or price data. */
export function namesCacheKey(profile: Omit<ClickHouseConnection, "password">) {
  const { url, database, user } = normalizeConnection({ ...profile, password: "" });
  return `jsg-display-names-v1:${contentHash(new TextEncoder().encode(JSON.stringify({ url, database, user })))}`;
}
