import type {
  HistoryRange,
  MarketHistoryBar,
  MarketHistoryRequest,
  MarketHistorySeries,
} from "./model";

const BAR_COUNT: Readonly<Record<HistoryRange, number>> = {
  "1M": 22,
  "3M": 66,
  "6M": 132,
  "1Y": 252,
  "3Y": 756,
};

function hashSeed(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function random(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function tradingDates(count: number, endAt: number): ReadonlyArray<Date> {
  const cursor = new Date(endAt);
  cursor.setUTCHours(0, 0, 0, 0);
  const dates: Date[] = [];
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * 网络与缓存同时不可用时使用的确定性 OHLCV 序列。
 * 它只用于维持交互与布局能力，quality/source 会明确标记为演示数据。
 */
export function createDemoHistory(
  request: MarketHistoryRequest,
  errors: ReadonlyArray<string> = [],
  endAt = Date.now(),
): MarketHistorySeries {
  const count = BAR_COUNT[request.range];
  const next = random(hashSeed(`${request.instrument.id}:${request.range}`));
  const target = Math.max(0.01, request.referencePrice ?? 100);
  let close = target / (0.9 + next() * 0.18);
  const bars: MarketHistoryBar[] = [];
  for (const date of tradingDates(count, endAt)) {
    const drift = (next() - 0.485) * 0.028;
    const open = close * (1 + (next() - 0.5) * 0.008);
    close = Math.max(0.01, open * (1 + drift));
    const high = Math.max(open, close) * (1 + next() * 0.012);
    const low = Math.min(open, close) * (1 - next() * 0.012);
    bars.push({
      date: isoDate(date),
      timestamp: date.getTime(),
      open,
      high,
      low,
      close,
      volume: Math.round(900_000 + next() * 8_100_000),
      amount: null,
    });
  }

  // 让演示序列最后一根与当前快照对齐，同时按比例保留全部 OHLC 关系。
  const finalClose = bars.at(-1)?.close ?? target;
  const scale = target / finalClose;
  const normalized = bars.map((bar) => ({
    ...bar,
    open: bar.open * scale,
    high: bar.high * scale,
    low: bar.low * scale,
    close: bar.close * scale,
  }));
  return {
    instrument: request.instrument,
    range: request.range,
    bars: normalized,
    receivedAt: endAt,
    quality: "demo",
    source: "BCR deterministic history fixture",
    errors,
  };
}

export function historyMinimumBars(range: HistoryRange): number {
  return BAR_COUNT[range];
}
