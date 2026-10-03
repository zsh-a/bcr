import { MINUTE } from "@bcr/market-data/binance/model";
import type { TrendChannelConfig } from "./channels";
import type { TrendChartData } from "./chart";
import type { TrendTrade } from "./model";

/** Historical references never invent an ATR or replace the frozen execution record. */
export function trendEntryEvidence(
  trade: TrendTrade,
  channel?: TrendChannelConfig,
  data?: TrendChartData | null,
) {
  if (trade.entrySignal) return { source: "recorded" as const, ...trade.entrySignal };
  if (!channel || !data || data.minutes !== channel.tradeMinutes) return undefined;
  const step = channel.tradeMinutes * MINUTE;
  if (trade.entryTime % step !== 0) return undefined;
  const open = trade.entryTime - step;
  const candle = data.bars.find((bar) => bar.time === open);
  const point = data.channels?.find((value) => value.time === open);
  if (!candle || !point) return undefined;
  return {
    source: "derived" as const,
    time: trade.entryTime - 1,
    price: candle.close,
    boundary: trade.side === "long" ? point.upper : point.lower,
    lookbackBars: channel.entryBars,
    atr: undefined,
  };
}
