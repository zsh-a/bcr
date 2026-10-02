import { DAY, utcDate, validateBinanceRequest, type BinanceRequest } from "./model";

export const BINANCE_ARCHIVE_ORIGIN = "https://data.binance.vision";
export interface ArchiveWindow {
  from: number;
  to: number;
  period: "daily" | "monthly";
  date: string;
}
export function candleWindows(request: BinanceRequest): ArchiveWindow[] {
  const { warmup, end } = validateBinanceRequest(request);
  const windows: ArchiveWindow[] = [];
  let cursor = warmup;
  while (cursor < end) {
    const date = new Date(cursor);
    const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    if (date.getUTCDate() === 1 && nextMonth <= end) {
      windows.push({
        from: cursor,
        to: nextMonth,
        period: "monthly",
        date: utcDate(cursor).slice(0, 7),
      });
      cursor = nextMonth;
    } else {
      windows.push({ from: cursor, to: cursor + DAY, period: "daily", date: utcDate(cursor) });
      cursor += DAY;
    }
  }
  return windows;
}
export function fundingMonths(request: BinanceRequest): string[] {
  const { start, end } = validateBinanceRequest(request);
  const months: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCDate(1);
  while (cursor.getTime() < end) {
    months.push(utcDate(cursor.getTime()).slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
export function candleArchive(symbol: string, window: ArchiveWindow, marks = false): string {
  return `${BINANCE_ARCHIVE_ORIGIN}/data/futures/um/${window.period}/${marks ? "markPriceKlines" : "klines"}/${symbol}/1m/${symbol}-1m-${window.date}.zip`;
}
export function fundingArchive(symbol: string, month: string): string {
  return `${BINANCE_ARCHIVE_ORIGIN}/data/futures/um/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${month}.zip`;
}
