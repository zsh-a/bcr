import {
  DAY,
  utcDate,
  type BinanceDataset,
  type BinanceManifest,
  type BinanceRequest,
} from "@bcr/market-data/binance/model";
import { trendWarmupDays, type TrendConfig } from "@bcr/quant-core/trend";

/** Cached coverage may be wider; indicator seeds must depend only on this config. */
export function trendReplayWindow(manifest: BinanceManifest, config: TrendConfig) {
  const warmupStart = manifest.startTime - trendWarmupDays(config) * DAY;
  if (manifest.warmupStart > warmupStart)
    throw new Error("行情预热不足，请按当前交易周期重新获取数据");
  return { startTime: manifest.startTime, endTime: manifest.endTime, warmupStart };
}

export function canReuseTrendDataset(
  dataset: BinanceDataset | null | undefined,
  request: BinanceRequest,
  config: TrendConfig,
): boolean {
  const manifest = dataset?.manifest;
  return !!(
    manifest &&
    manifest.symbol === request.symbol &&
    utcDate(manifest.startTime) === request.start &&
    utcDate(manifest.endTime - 1) === request.end &&
    manifest.startTime - manifest.warmupStart >= trendWarmupDays(config) * DAY
  );
}
