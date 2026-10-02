import { MAX_PARTITION_BYTES } from "./model";

export interface ClickHouseConnection {
  url: string;
  database: string;
  user: string;
  password: string;
}
export interface ClickHouseRange {
  warmupSessions?: number;
  start: string;
  end: string;
  strictPit: boolean;
  refresh: boolean;
}
export type ClickHouseProfile = Omit<ClickHouseConnection, "password"> &
  Pick<ClickHouseRange, "start" | "end" | "strictPit" | "warmupSessions">;
export interface ClickHouseInfo {
  version: string;
  firstDate: string;
  lastDate: string;
  lastBacktestDate: string;
  strictPitReady: boolean;
}
export interface ClickHouseProgress {
  text: string;
  completed: number;
  total: number;
  rows: number;
  bytes: number;
}
export const DEFAULT_CONNECTION: ClickHouseConnection = {
  url: "http://localhost:8123/",
  database: "stock_data",
  user: "default",
  password: "",
};
export type MetadataRow = Record<string, unknown>;
export class ResponseTooLarge extends Error {
  constructor() {
    super("Arrow 响应超过 32 MiB，请缩小获取区间");
  }
}

export function normalizeConnection(value: ClickHouseConnection): ClickHouseConnection {
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new Error("请输入有效的 ClickHouse HTTP 或 HTTPS 地址");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[A-Za-z_][A-Za-z_0-9]*$/u.test(value.database) ||
    value.database.length > 256 ||
    value.user.length > 256 ||
    value.password.length > 8192
  )
    throw new Error("连接地址不应包含密码或查询参数，数据库名需有效");
  return { ...value, url: url.toString() };
}
export function publicProfile(
  connection: ClickHouseConnection,
  range: ClickHouseRange,
): ClickHouseProfile {
  const { url, database, user } = normalizeConnection(connection);
  if (
    range.warmupSessions !== undefined &&
    (!Number.isSafeInteger(range.warmupSessions) ||
      range.warmupSessions < 30 ||
      range.warmupSessions > 251)
  )
    throw new Error("预热会话数应为 30–251");
  return {
    url,
    database,
    user,
    start: range.start,
    end: range.end,
    strictPit: range.strictPit,
    ...(range.warmupSessions && range.warmupSessions !== 30
      ? { warmupSessions: range.warmupSessions }
      : {}),
  };
}
export function numericDate(text: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new Error("日期格式应为 YYYY-MM-DD");
  const d = new Date(`${text}T00:00:00Z`);
  if (
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== text ||
    text < "1900-01-01" ||
    text > "2200-12-31"
  )
    throw new Error("日期无效");
  return Number(text.replaceAll("-", ""));
}
export function prepareCalendar(all: string[], start: string, end: string, warmup = 30) {
  if (!Number.isSafeInteger(warmup) || warmup < 30 || warmup > 251)
    throw new Error("预热会话数应为 30–251");
  numericDate(start);
  numericDate(end);
  if (start > end) throw new Error("开始日期应早于结束日期");
  if (
    all.length === 0 ||
    all.length > 20_000 ||
    all.some((date, i) => {
      numericDate(date);
      return i > 0 && date <= all[i - 1]!;
    })
  )
    throw new Error("交易日历无效");
  const selected = all.filter((date) => date >= start && date <= end);
  const first = selected[0],
    last = selected.at(-1);
  if (first === undefined || last === undefined) throw new Error("所选区间没有交易日");
  const before = all.filter((date) => date < first);
  if (before.length < warmup || !all.some((date) => date > last))
    throw new Error(`交易日历需要 ${warmup} 个预热交易日及区间之后的交易日，请调整日期`);
  const week = (date: string) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    return d.toISOString().slice(0, 10);
  };
  const lastInWeek = new Map(all.map((date) => [week(date), date]));
  const lastInMonth = new Map(all.map((date) => [date.slice(0, 7), date]));
  const dates = [...before.slice(-warmup), ...selected];
  return {
    first,
    last,
    dates,
    sessions: dates.map((date) => ({
      date: numericDate(date),
      rebalance: lastInWeek.get(week(date)) === date,
      monthEnd: lastInMonth.get(date.slice(0, 7)) === date,
    })),
  };
}

/** Raw bytes stay in the Worker. Small metadata alone is decoded as JSON. */
export function clickHouseClient(connection: ClickHouseConnection, fetcher: typeof fetch = fetch) {
  const c = normalizeConnection(connection);
  const request = async (sql: string, params: Record<string, string>, signal: AbortSignal) => {
    signal.throwIfAborted();
    const url = new URL(c.url);
    const settings = {
      database: c.database,
      readonly: "1",
      add_http_cors_header: "1",
      output_format_arrow_compression_method: "none",
      output_format_arrow_low_cardinality_as_dictionary: "0",
      cancel_http_readonly_queries_on_client_close: "1",
      max_execution_time: "120",
      query_id: `bcr-${crypto.randomUUID()}`,
    };
    for (const [key, value] of Object.entries(settings)) url.searchParams.set(key, value);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(`param_${key}`, value);
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
          "X-ClickHouse-User": c.user,
          "X-ClickHouse-Key": c.password,
        },
        body: sql,
        signal: AbortSignal.any([signal, AbortSignal.timeout(150_000)]),
      });
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof DOMException && error.name === "TimeoutError")
        throw new Error("ClickHouse 请求超时，请缩小日期范围");
      throw new Error("无法连接 ClickHouse，请检查地址、跨域设置和浏览器的本地网络访问权限");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`ClickHouse HTTP ${response.status}：请检查账号权限、数据库及源表`);
    }
    return response;
  };
  const json = async (
    sql: string,
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<MetadataRow[]> => {
    const response = await request(`${sql} FORMAT JSONEachRow`, params, signal);
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("ClickHouse 没有返回元数据");
    const decoder = new TextDecoder();
    let text = "",
      bytes = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 4 * 1024 * 1024) throw new Error("ClickHouse 元数据超过 4 MiB");
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const row: unknown = JSON.parse(line);
          if (row === null || typeof row !== "object" || Array.isArray(row))
            throw new Error("ClickHouse 元数据无效");
          return row as MetadataRow;
        });
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  };
  const arrow = async (
    sql: string,
    params: Record<string, string>,
    signal: AbortSignal,
    onBytes: (bytes: number) => void,
  ) => {
    const response = await request(sql, params, signal);
    if (response.body === null) throw new Error("ClickHouse 没有返回 Arrow 数据");
    let size = 0;
    return response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          signal.throwIfAborted();
          size += chunk.byteLength;
          if (size > MAX_PARTITION_BYTES) throw new ResponseTooLarge();
          onBytes(chunk.byteLength);
          controller.enqueue(chunk);
        },
      }),
    );
  };
  return { connection: c, json, arrow };
}
export type ClickHouseClient = ReturnType<typeof clickHouseClient>;

export async function probeConnection(
  connection: ClickHouseConnection,
  signal: AbortSignal,
): Promise<void> {
  const rows = await clickHouseClient(connection).json("SELECT 1 AS connected", {}, signal);
  if (rows[0]?.["connected"] !== 1) throw new Error("ClickHouse 连接验证失败");
}
