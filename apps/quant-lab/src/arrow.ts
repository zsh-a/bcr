import { tableFromArrays, tableFromIPC, tableToIPC, type Table } from "apache-arrow";
import { validateMarketBars } from "./engine";
import type { MarketBar } from "./model";

const COLUMNS = ["date", "open", "high", "low", "close", "volume"] as const;

export function marketTableFromBars(input: ReadonlyArray<MarketBar>, minimumRows = 30): Table {
  const bars = validateMarketBars(input, minimumRows);
  return tableFromArrays({
    date: bars.map((bar) => bar.date),
    open: Float64Array.from(bars, (bar) => bar.open),
    high: Float64Array.from(bars, (bar) => bar.high),
    low: Float64Array.from(bars, (bar) => bar.low),
    close: Float64Array.from(bars, (bar) => bar.close),
    volume: Float64Array.from(bars, (bar) => bar.volume),
  });
}

export function encodeMarketArrow(bars: ReadonlyArray<MarketBar>): Uint8Array {
  return tableToIPC(marketTableFromBars(bars), "stream");
}

export function decodeMarketArrow(bytes: Uint8Array, minimumRows = 30): MarketBar[] {
  let table: Table;
  try {
    table = tableFromIPC(bytes);
  } catch (error) {
    throw new Error(`Arrow IPC 无效 · ${error instanceof Error ? error.message : String(error)}`);
  }
  const vectors = Object.fromEntries(COLUMNS.map((name) => [name, table.getChild(name)]));
  const missing = COLUMNS.filter((name) => vectors[name] === null);
  if (missing.length > 0) throw new Error(`Arrow 缺少列: ${missing.join(", ")}`);

  const bars = Array.from({ length: table.numRows }, (_, index): MarketBar => ({
    date: String(vectors.date?.get(index) ?? ""),
    open: Number(vectors.open?.get(index)),
    high: Number(vectors.high?.get(index)),
    low: Number(vectors.low?.get(index)),
    close: Number(vectors.close?.get(index)),
    volume: Number(vectors.volume?.get(index)),
  }));
  return validateMarketBars(bars, minimumRows);
}
