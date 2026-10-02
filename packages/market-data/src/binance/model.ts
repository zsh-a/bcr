import type { ArtifactRef } from "@bcr/core";

export const MINUTE = 60_000;
export const DAY = 86_400_000;
export const MAX_BINANCE_DAYS = 730;
export const MAX_BINANCE_WARMUP_DAYS = 250;
export interface BinanceRequest {
  symbol: string;
  start: string;
  end: string;
  warmupDays?: number;
}
export interface MinuteBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface FundingRate {
  time: number;
  rate: number;
  intervalHours: number;
}
export interface BinancePartition {
  candles: ArtifactRef;
  marks: ArtifactRef;
  from: number;
  to: number;
  rows: number;
  source: string;
  checksum: string;
  markSource: string;
  markChecksum: string;
}
export interface BinanceManifest {
  version: 1;
  provider: "binance-public-data";
  market: "usdt-perpetual";
  interval: "1m";
  symbol: string;
  startTime: number;
  endTime: number;
  warmupStart: number;
  rows: number;
  funding: ArtifactRef;
  fundingSources: { url: string; checksum: string }[];
  fundingPrice: "minute-mark-open";
  partitions: BinancePartition[];
  createdAt: string;
}
export interface BinanceDataset {
  manifest: BinanceManifest;
  manifestRef: ArtifactRef;
}
export function utcDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}
export function dateTime(date: string): number {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(time) || utcDate(time) !== date)
    throw new Error("请选择有效的 UTC 日期");
  return time;
}
export function validateBinanceRequest(request: BinanceRequest, now = Date.now()) {
  if (!/^[A-Z0-9]{2,20}USDT$/u.test(request.symbol))
    throw new Error("请输入 USDT 永续交易对，例如 BTCUSDT");
  const start = dateTime(request.start),
    end = dateTime(request.end) + DAY;
  if (start < Date.UTC(2019, 8, 1) || start >= end || end > Math.floor(now / DAY) * DAY)
    throw new Error("仅支持已结束的完整交易日，起止日期需要按顺序选择");
  if ((end - start) / DAY > MAX_BINANCE_DAYS)
    throw new Error(`单次最多 ${MAX_BINANCE_DAYS} 天，请缩短研究区间`);
  const days = request.warmupDays ?? 1;
  if (!Number.isInteger(days) || days < 1 || days > MAX_BINANCE_WARMUP_DAYS)
    throw new Error(`行情预热需要 1–${MAX_BINANCE_WARMUP_DAYS} 个完整 UTC 日`);
  return { start, end, warmup: start - days * DAY };
}
export function defaultBinanceRequest(now = new Date()): BinanceRequest {
  // Funding archives are monthly and published on the first Monday. Leave
  // a full week before choosing the previous month; never silently omit fees.
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (now.getUTCDate() < 8 ? 1 : 0), 1);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 1);
  return { symbol: "BTCUSDT", start: utcDate(start.getTime()), end: utcDate(end - DAY) };
}

export function validateBinanceManifest(m: BinanceManifest): void {
  if (
    m.version !== 1 ||
    m.provider !== "binance-public-data" ||
    m.market !== "usdt-perpetual" ||
    m.interval !== "1m" ||
    m.fundingPrice !== "minute-mark-open" ||
    !/^[A-Z0-9]{2,20}USDT$/u.test(m.symbol) ||
    !Number.isSafeInteger(m.startTime) ||
    !Number.isSafeInteger(m.endTime) ||
    !Number.isSafeInteger(m.warmupStart) ||
    m.startTime % DAY ||
    m.endTime % DAY ||
    m.warmupStart % DAY ||
    m.startTime - m.warmupStart < DAY ||
    m.startTime - m.warmupStart > MAX_BINANCE_WARMUP_DAYS * DAY ||
    m.endTime <= m.startTime ||
    m.endTime - m.startTime > MAX_BINANCE_DAYS * DAY ||
    m.rows !== (m.endTime - m.warmupStart) / MINUTE ||
    !m.funding?.id ||
    !m.partitions?.length ||
    !m.fundingSources?.length
  )
    throw new Error("Binance 冻结行情清单无效");
  let expected = m.warmupStart;
  const source = (url: string, sha: string) =>
    url.startsWith("https://data.binance.vision/data/futures/um/") && /^[a-f0-9]{64}$/u.test(sha);
  for (const p of m.partitions) {
    if (
      p.from !== expected ||
      p.to <= p.from ||
      p.to > m.endTime ||
      p.rows !== (p.to - p.from) / MINUTE ||
      !Number.isInteger(p.rows) ||
      !p.candles?.id ||
      !p.marks?.id ||
      !source(p.source, p.checksum) ||
      !source(p.markSource, p.markChecksum)
    )
      throw new Error("Binance 行情分片缺失或不连续");
    expected = p.to;
  }
  if (expected !== m.endTime || m.fundingSources.some((s) => !source(s.url, s.checksum)))
    throw new Error("Binance 行情或资金费来源不完整");
}
