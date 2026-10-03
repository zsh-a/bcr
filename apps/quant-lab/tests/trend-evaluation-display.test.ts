import { DAY } from "@bcr/market-data/binance/model";
import {
  TREND_EVALUATION_CONVENTIONS,
  type LegacyTrendEvaluation,
  type TrendEvaluationV2,
  type TrendMetrics,
  type TrendResult,
} from "@bcr/quant-core/trend";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import contract from "../../../crates/quant/fixtures/trend-evaluation-contract.json";
import {
  TrendEvaluationPanel,
  TrendMonthlyReturns,
} from "../src/trend/results/TrendEvaluationPanel";
import {
  number,
  percent,
  trendEvaluationView,
  trendPerformancePoints,
} from "../src/trend/results/evaluation";

const fixture = contract.cases[0]!;
const window = { startTime: fixture.startTime, endTime: fixture.endTime };
const legacy: LegacyTrendEvaluation = {
  netExpectancy: 20,
  averageWin: 40,
  averageLoss: 20,
  payoffRatio: 2,
  grossPnl: 120,
  meanHoldHours: 5,
  exposurePct: 0.25,
  turnover: 4,
  dailySharpe: fixture.expected.dailySharpe,
  sortino: fixture.expected.sortino,
  calmar: fixture.expected.calmar,
  positiveDays: 12,
  totalDays: 30,
  bestTradeShare: 0.6,
  withoutBestTrade: -4,
  longNetPnl: 90,
  shortNetPnl: -10,
  exitReasons: { "hard-stop": 1 },
};
function evaluation(): TrendEvaluationV2 {
  return {
    ...legacy,
    version: 2,
    conventions: TREND_EVALUATION_CONVENTIONS,
    durationMs: 30 * DAY,
    annualizedReturn: fixture.expected.annualizedReturn,
    annualizedVolatility: fixture.expected.annualizedVolatility,
    dailyMaxDrawdown: fixture.expected.dailyMaxDrawdown,
    maxDrawdownDurationMs: 2 * DAY,
    currentDrawdownDurationMs: DAY,
    currentDrawdown: -0.01,
    bestDayReturn: fixture.expected.bestDayReturn,
    worstDayReturn: fixture.expected.worstDayReturn,
    daily: fixture.daily.map((p, index) => ({
      from: fixture.startTime + index * DAY,
      to: p.time + 1,
      equity: p.equity,
      returnPct: null,
      complete: true,
      drawdown: -0.02,
      maxIntradayDrawdown: -0.04,
    })),
    monthly: [
      {
        from: fixture.startTime,
        to: fixture.endTime,
        equity: fixture.daily.at(-1)!.equity,
        returnPct: 0.057107642596003,
        complete: false,
      },
    ],
    costs: {
      fees: 12,
      funding: -2,
      slippageAndRounding: 5,
      total: 15,
      grossBeforeCosts: 95,
      netPnl: 80,
      costToGrossProfit: 15 / 95,
    },
  };
}
function metrics(e: TrendMetrics["evaluation"] = evaluation()): TrendMetrics {
  return {
    ...(e ? { evaluation: e } : {}),
    finalEquity: 10080,
    totalReturn: 0.008,
    maxDrawdown: -0.04,
    trades: 4,
    wins: 3,
    losses: 1,
    winRate: 0.75,
    profitFactor: 5,
    meanR: 0.3,
    fees: 12,
    funding: -2,
    longestLossStreak: 1,
    rejectedSignals: 2,
    fundingEvents: 9,
    rows: 43200,
  };
}
function result(e: TrendMetrics["evaluation"] = evaluation()): TrendResult {
  return {
    version: 1,
    engine: e?.version === 2 ? "trend-continuation-9" : "trend-continuation-8",
    metrics: metrics(e),
    chunks: [],
    trades: [],
    equity: [{ time: window.startTime + DAY - 1, equity: 5000, cash: 5000, drawdown: -0.5 }],
  };
}

describe("trend evaluation presentation", () => {
  it("keeps the nine overview metrics ordered and uses recorded minute and daily definitions", () => {
    const view = trendEvaluationView(metrics(), window);
    expect(view.overview.map((m) => m.id)).toEqual([
      "return",
      "drawdown",
      "drawdownDuration",
      "sharpe",
      "calmar",
      "profitFactor",
      "expectancy",
      "trades",
      "coverage",
    ]);
    const values = Object.fromEntries(view.overview.map((m) => [m.id, m.value]));
    expect(values).toMatchObject({
      return: "0.80%",
      drawdown: "-4.00%",
      drawdownDuration: "2.0 天",
      sharpe: "2.18",
      calmar: "48.03",
      profitFactor: "5.00",
      expectancy: "20.00",
      trades: "4",
      coverage: "30.0 天",
    });
    const details = view.groups.flatMap((group) => group.metrics);
    expect(details.find((m) => m.id === "dailyDrawdown")?.value).toBe("-2.01%");
    expect(details.find((m) => m.id === "costRatio")).toMatchObject({
      label: "成本侵蚀率",
      value: "15.79%",
    });
    expect(details.find((m) => m.id === "costRatio")?.help).toContain("总成本前净盈亏");
    expect(details.find((m) => m.id === "funding")?.value).toBe("-2.00");
    expect(details.find((m) => m.id === "averageLoss")).toMatchObject({
      value: "20.00",
      help: "亏损交易净亏损绝对值的平均值，以正数表示。",
    });
  });

  it("keeps unavailable and degenerate values distinct from zero", () => {
    const old = trendEvaluationView(metrics(legacy), window);
    expect(old.overview.find((m) => m.id === "drawdownDuration")?.value).toBe("—");
    expect(old.overview.find((m) => m.id === "sharpe")?.value).toBe("2.18");
    expect(old.groups.flatMap((g) => g.metrics).find((m) => m.id === "annualReturn")?.value).toBe(
      "—",
    );
    expect(old.monthly).toBeUndefined();
    const flat = trendEvaluationView(
      {
        ...metrics(),
        trades: 0,
        wins: 0,
        losses: 0,
        profitFactor: null,
        evaluation: {
          ...evaluation(),
          dailySharpe: null,
          calmar: null,
          netExpectancy: null,
          maxDrawdownDurationMs: 0,
        },
      },
      window,
    );
    expect(flat.overview.find((m) => m.id === "profitFactor")?.value).toBe("—");
    expect(flat.overview.find((m) => m.id === "expectancy")?.value).toBe("—");
    expect(flat.overview.find((m) => m.id === "drawdownDuration")?.value).toBe("0 天");
    const noLoss = trendEvaluationView({ ...metrics(), losses: 0, profitFactor: null }, window);
    expect(noLoss.overview.find((m) => m.id === "profitFactor")?.value).toBe("无亏损交易");
    expect(number(NaN)).toBe("—");
    expect(percent(Infinity)).toBe("—");
  });

  it("uses complete recorded daily observations for charts instead of the equity preview", () => {
    const points = trendPerformancePoints(result(), fixture.initialCapital, window);
    expect(points.sampled).toBe(false);
    expect(points.equity).toHaveLength(fixture.daily.length + 1);
    expect(points.equity[0]).toEqual({ time: window.startTime, value: 1 });
    expect(points.equity[1]?.value).toBe(1.01);
    expect(points.equity.at(-1)?.value).toBe(fixture.daily.at(-1)!.equity / fixture.initialCapital);
    expect(points.drawdown[1]?.value).toBe(-2);
    expect(points.intraday[1]?.value).toBe(-4);
    expect(points.equity.map((p) => p.time)).toEqual(points.drawdown.map((p) => p.time));
  });

  it("retains historical sampled equity without inventing a drawdown curve or monthly statistics", () => {
    const old = result(legacy);
    old.equity.push({ ...old.equity[0]!, equity: 6000 });
    const points = trendPerformancePoints(old, 10000, window);
    expect(points.sampled).toBe(true);
    expect(points.equity).toEqual([
      { time: Math.floor(old.equity[0]!.time / 1000) * 1000, value: 0.6 },
    ]);
    expect(points.drawdown).toEqual([]);
    expect(points.intraday).toEqual([]);
  });

  it("labels partial months and an unbound validation source without implying passed evidence", () => {
    const panel = renderToStaticMarkup(
      createElement(TrendEvaluationPanel, { metrics: metrics(), window }),
    );
    expect(panel.match(/data-metric=/gu)).toHaveLength(9 + 8 + 8 + 4 + 8);
    expect(panel).toContain("收益质量与交易管理");
    expect(panel).toContain("尚未绑定独立样本外");
    expect(panel).toContain("不再重复扣除");
    expect(panel).toContain("仅为指标展示门槛，短样本年化不能证明长期能力");
    const monthly = renderToStaticMarkup(
      createElement(TrendMonthlyReturns, { metrics: metrics(), window }),
    );
    expect(monthly).toContain("2024-01");
    expect(monthly).toContain("部分月份");
    expect(monthly).toContain("5.71%");
    const old = renderToStaticMarkup(
      createElement(TrendMonthlyReturns, { metrics: metrics(legacy), window }),
    );
    expect(old).toContain("旧结果未保存完整月度收益");
    expect(old).not.toContain("<table");
  });
});
