import { backtest_long_only_f64 } from "../../../crates/kernels/pkg/bcr_kernels.js";
import { marketSpanYears } from "./engine";
import type { BacktestResult, MarketBar, SignalPoint, StrategyConfig, Trade } from "./model";

/** 将 Rust/WASM 的 TypedArray 与交易索引还原为应用层日期模型。 */
export function runWasmBacktest(
  bars: ReadonlyArray<MarketBar>,
  signals: ReadonlyArray<SignalPoint>,
  config: Pick<StrategyConfig, "initialCapital" | "feeBps">,
): BacktestResult {
  if (bars.length !== signals.length || bars.length === 0) {
    throw new Error("行情与信号长度必须一致且非空");
  }
  const output = backtest_long_only_f64(
    Float64Array.from(bars, (bar) => bar.close),
    Uint8Array.from(signals, (signal) => signal.position),
    config.initialCapital,
    config.feeBps,
    marketSpanYears(bars),
  );
  try {
    const equities = output.equity();
    const drawdowns = output.drawdown();
    if (equities.length !== bars.length || drawdowns.length !== bars.length) {
      throw new Error("Rust/WASM equity batch length mismatch");
    }
    const entryIndices = output.trade_entry_indices();
    const exitIndices = output.trade_exit_indices();
    const entryPrices = output.trade_entry_prices();
    const exitPrices = output.trade_exit_prices();
    const returns = output.trade_returns();
    const pnls = output.trade_pnls();
    const tradeCount = output.trade_count();
    const tradeArrays = [entryIndices, exitIndices, entryPrices, exitPrices, returns, pnls];
    if (tradeArrays.some((values) => values.length !== tradeCount)) {
      throw new Error("Rust/WASM trade batch length mismatch");
    }

    const trades: Trade[] = Array.from({ length: tradeCount }, (_, index) => {
      const entryBar = bars[entryIndices[index] ?? -1];
      const exitBar = bars[exitIndices[index] ?? -1];
      if (entryBar === undefined || exitBar === undefined) {
        throw new Error("Rust/WASM trade index out of bounds");
      }
      return {
        entryDate: entryBar.date,
        entryPrice: entryPrices[index] ?? Number.NaN,
        exitDate: exitBar.date,
        exitPrice: exitPrices[index] ?? Number.NaN,
        returnPct: returns[index] ?? Number.NaN,
        pnl: pnls[index] ?? Number.NaN,
      };
    });
    return {
      equity: bars.map((bar, index) => ({
        date: bar.date,
        equity: equities[index] ?? Number.NaN,
        drawdown: drawdowns[index] ?? Number.NaN,
      })),
      trades,
      metrics: {
        engine: "rust-wasm",
        totalReturn: output.total_return(),
        annualizedReturn: output.annualized_return(),
        buyHoldReturn: output.buy_hold_return(),
        sharpe: output.sharpe(),
        maxDrawdown: output.max_drawdown(),
        winRate: output.win_rate(),
        exposure: output.exposure(),
        tradeCount,
        finalEquity: output.final_equity(),
      },
    };
  } finally {
    output.free();
  }
}
