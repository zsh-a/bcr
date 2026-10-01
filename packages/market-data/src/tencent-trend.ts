import type { MarketHistoryBar, MarketHistoryRequest, MarketHistorySeries } from "./model";

/** Tencent's short daily price series. Volume is intentionally unused by asset-card trends. */
export async function loadTencentTrendHistory(
  request: MarketHistoryRequest,
  signal?: AbortSignal,
): Promise<MarketHistorySeries> {
  signal?.throwIfAborted();
  const { instrument } = request;
  if (instrument.market === "GLOBAL" || request.range !== "1M") {
    throw new Error("Tencent short daily series does not cover this request");
  }
  const symbol =
    instrument.market === "CN"
      ? instrument.sourceSymbol.toLowerCase()
      : `${instrument.market === "HK" ? "hk" : "us"}${instrument.sourceSymbol.replace(/^(hk|us)/iu, "")}`;
  if (!/^(sh|sz|bj|hk|us)[A-Za-z0-9.]+$/u.test(symbol)) {
    throw new Error("Invalid daily history symbol");
  }
  const endpoint = instrument.market === "US" ? "usfqkline" : "fqkline";
  const url = new URL(`https://web.ifzq.gtimg.cn/appstock/app/${endpoint}/get`);
  url.searchParams.set("param", `${symbol},day,,,40,qfq`);
  const timeout = AbortSignal.timeout(8_000);
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    credentials: "omit",
  });
  if (!response.ok) throw new Error(`Tencent daily history HTTP ${response.status}`);
  const text = await response.text();
  signal?.throwIfAborted();
  if (text.length > 262_144) throw new Error("Daily history response too large");
  const payload = JSON.parse(text) as {
    code?: number;
    data?: Record<string, { qfqday?: unknown; day?: unknown }>;
  };
  if (payload.code !== 0) throw new Error("Tencent returned no daily history");
  const data = payload.data?.[symbol];
  const adjusted = Array.isArray(data?.qfqday) && data.qfqday.length > 0;
  const rows = adjusted ? data?.qfqday : data?.day;
  if (!Array.isArray(rows)) throw new Error("Tencent returned no daily history");
  const bars: MarketHistoryBar[] = rows.slice(-40).flatMap((row: unknown) => {
    if (!Array.isArray(row) || row.length < 5) return [];
    const [date, ...raw] = row;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return [];
    const [open, close, high, low] = raw
      .slice(0, 4)
      .map((value: unknown) =>
        typeof value === "string" || typeof value === "number" ? Number(value) : NaN,
      );
    if (
      ![open, close, high, low].every(
        (value) => value !== undefined && Number.isFinite(value) && value > 0,
      ) ||
      high! < Math.max(open!, close!) ||
      low! > Math.min(open!, close!)
    )
      return [];
    return [
      {
        date,
        timestamp: null,
        open: open!,
        close: close!,
        high: high!,
        low: low!,
        volume: 0,
        amount: null,
      },
    ];
  });
  if (bars.length < 3) throw new Error("Insufficient Tencent daily history");
  return {
    instrument,
    range: request.range,
    bars,
    receivedAt: Date.now(),
    quality: "delayed",
    source: adjusted ? "腾讯 · 前复权日线" : "腾讯 · 日线",
    errors: [],
  };
}
