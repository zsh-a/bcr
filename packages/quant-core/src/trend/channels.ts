import { MINUTE, type MinuteBar } from "@bcr/market-data/binance/model";
import { TREND_PERIODS } from "./config";

export interface TrendChannelConfig {
  tradeMinutes: number;
  entryBars: number;
  exitBars: number | null;
}
export interface TrendChannelPoint {
  time: number;
  upper: number;
  lower: number;
  exitUpper?: number;
  exitLower?: number;
}
export function validateTrendChannelConfig(value: TrendChannelConfig, displayMinutes: number) {
  if (
    !value ||
    !TREND_PERIODS.includes(value.tradeMinutes as (typeof TREND_PERIODS)[number]) ||
    displayMinutes < value.tradeMinutes ||
    displayMinutes % value.tradeMinutes !== 0 ||
    !Number.isInteger(value.entryBars) ||
    value.entryBars < 2 ||
    value.entryBars > 250 ||
    (value.exitBars !== null && value.exitBars !== Math.max(1, Math.floor(value.entryBars / 2)))
  )
    throw new Error("通道图层与冻结策略周期不一致");
}

/** Price thresholds known at each displayed candle's OPEN. Never include that candle. */
export class TrendChannelProjection {
  private readonly history: MinuteBar[] = [];
  readonly points: TrendChannelPoint[] = [];
  constructor(
    private readonly config: TrendChannelConfig,
    private readonly from: number,
    private readonly to: number,
    private readonly displayMinutes: number,
  ) {
    validateTrendChannelConfig(config, displayMinutes);
  }
  append(bars: readonly MinuteBar[]) {
    for (const bar of bars) {
      if (bar.time >= this.to) break;
      if (
        bar.time >= this.from &&
        bar.time % (this.displayMinutes * MINUTE) === 0 &&
        this.history.length === this.config.entryBars
      ) {
        const exit = this.config.exitBars === null ? [] : this.history.slice(-this.config.exitBars);
        this.points.push({
          time: bar.time,
          upper: Math.max(...this.history.map((b) => b.high)),
          lower: Math.min(...this.history.map((b) => b.low)),
          ...(exit.length
            ? {
                exitUpper: Math.max(...exit.map((b) => b.high)),
                exitLower: Math.min(...exit.map((b) => b.low)),
              }
            : {}),
        });
      }
      this.history.push(bar);
      if (this.history.length > this.config.entryBars) this.history.shift();
    }
  }
}
