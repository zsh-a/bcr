import { DAY } from "@bcr/market-data/binance/model";
import {
  TREND_REASONS,
  type TrendEvaluationV2,
  type TrendMetrics,
  type TrendResult,
} from "@bcr/quant-core/trend";

export const number = (value: number | null | undefined, digits = 2): string =>
  value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("zh-CN", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
export const percent = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? "—" : `${number(value * 100)}%`;
export const timestamp = (time: number): string =>
  new Date(time).toISOString().slice(0, 16).replace("T", " ");
export const duration = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms === 0) return "0 天";
  if (ms >= DAY) return `${number(ms / DAY, 1)} 天`;
  if (ms >= 3_600_000) return `${number(ms / 3_600_000, 1)} 小时`;
  return `${number(ms / 60_000, 1)} 分钟`;
};
export interface EvaluationWindow {
  startTime: number;
  endTime: number;
}
interface Context {
  metrics: TrendMetrics;
  evaluation: TrendMetrics["evaluation"];
  current: TrendEvaluationV2 | undefined;
  window: EvaluationWindow;
}
interface MetricDefinition {
  id: string;
  label: string;
  help: string;
  unit?: string;
  format?: "percent" | "integer" | "duration";
  value: (context: Context) => number | null | undefined;
  empty?: (context: Context) => string;
}
export interface MetricDisplay {
  id: string;
  label: string;
  value: string;
  unit?: string;
  help: string;
}

const overview: MetricDefinition[] = [
  {
    id: "return",
    label: "净收益",
    format: "percent",
    value: (c) => c.metrics.totalReturn,
    help: "期末权益相对初始本金的收益，已计手续费、资金费与成交价格中的滑点。",
  },
  {
    id: "drawdown",
    label: "最大回撤 · MDD",
    format: "percent",
    value: (c) => c.metrics.maxDrawdown,
    help: "按分钟标记价格与成交后权益记录的最大峰谷跌幅，不是日终回撤。",
  },
  {
    id: "drawdownDuration",
    label: "最长回撤时长",
    format: "duration",
    value: (c) => c.current?.maxDrawdownDurationMs,
    help: "从权益前高到恢复前高的最长持续时间；未恢复的区间计至回测结束。",
  },
  {
    id: "sharpe",
    label: "Sharpe",
    value: (c) => c.evaluation?.dailySharpe,
    help: "完整 UTC 日收益、样本标准差、零无风险收益率，按 365 日年化；至少 30 个完整日。",
  },
  {
    id: "calmar",
    label: "Calmar",
    value: (c) => c.evaluation?.calmar,
    help: "年化净收益除以分钟级最大回撤绝对值；样本不足或分母为零时不显示。",
  },
  {
    id: "profitFactor",
    label: "净利润因子 · PF",
    value: (c) => c.metrics.profitFactor,
    empty: (c) => (c.metrics.wins > 0 && c.metrics.losses === 0 ? "无亏损交易" : "—"),
    help: "完整交易账本的净盈利总额除以净亏损总额绝对值，已扣费用与资金费。",
  },
  {
    id: "expectancy",
    label: "单笔净期望",
    unit: "USDT / 笔",
    value: (c) => c.evaluation?.netExpectancy,
    help: "全部已平仓交易净盈亏的平均值；没有交易时不显示。",
  },
  {
    id: "trades",
    label: "交易数",
    unit: "笔",
    format: "integer",
    value: (c) => c.metrics.trades,
    help: "完整交易账本中的已平仓交易数量，包含区间末尾结算。",
  },
  {
    id: "coverage",
    label: "回测覆盖时长",
    format: "duration",
    value: (c) => c.current?.durationMs ?? c.window.endTime - c.window.startTime,
    help: "实际回放窗口覆盖的自然时间，不含预热，也不是程序运行耗时。",
  },
];
const groups: { title: string; metrics: MetricDefinition[] }[] = [
  {
    title: "收益与风险",
    metrics: [
      {
        id: "annualReturn",
        label: "年化收益 · CAGR",
        format: "percent",
        value: (c) => c.current?.annualizedReturn,
        help: "按实际覆盖时间复合年化；至少 30 个完整 UTC 日。",
      },
      {
        id: "sortino",
        label: "Sortino",
        value: (c) => c.evaluation?.sortino,
        help: "零目标收益，下行波动按所有完整 UTC 日计算，365 日年化。",
      },
      {
        id: "volatility",
        label: "年化波动",
        format: "percent",
        value: (c) => c.current?.annualizedVolatility,
        help: "完整日收益的样本标准差乘以 √365；至少 30 个完整日。",
      },
      {
        id: "dailyDrawdown",
        label: "日终最大回撤",
        format: "percent",
        value: (c) => c.current?.dailyMaxDrawdown,
        help: "仅比较各日结束时的权益与日终前高，可能小于分钟级最大回撤。",
      },
      {
        id: "currentDrawdown",
        label: "期末回撤",
        format: "percent",
        value: (c) => c.current?.currentDrawdown,
        help: "期末权益相对分钟级历史前高的跌幅。",
      },
      {
        id: "underwater",
        label: "当前水下时长",
        format: "duration",
        value: (c) => c.current?.currentDrawdownDurationMs,
        help: "期末仍未恢复前高的持续时间；已经恢复则为零。",
      },
      {
        id: "worstDay",
        label: "最差日",
        format: "percent",
        value: (c) => c.current?.worstDayReturn,
        help: "完整 UTC 日中最低的单日收益；不完整日不参与排名。",
      },
      {
        id: "bestDay",
        label: "最好日",
        format: "percent",
        value: (c) => c.current?.bestDayReturn,
        help: "完整 UTC 日中最高的单日收益；不完整日不参与排名。",
      },
    ],
  },
  {
    title: "交易与持仓",
    metrics: [
      {
        id: "winRate",
        label: "胜率",
        format: "percent",
        value: (c) => c.metrics.winRate,
        help: "净盈利交易数除以全部已平仓交易数。",
      },
      {
        id: "payoff",
        label: "平均盈亏比",
        value: (c) => c.evaluation?.payoffRatio,
        help: "平均净盈利除以平均净亏损绝对值。",
      },
      {
        id: "meanR",
        label: "平均净 R",
        value: (c) => c.metrics.meanR,
        help: "每笔净盈亏除以其初始风险金额，再取平均。",
      },
      {
        id: "averageWin",
        label: "平均净盈利",
        unit: "USDT",
        value: (c) => c.evaluation?.averageWin,
        help: "净盈利交易的平均净盈亏。",
      },
      {
        id: "averageLoss",
        label: "平均净亏损",
        unit: "USDT",
        value: (c) => c.evaluation?.averageLoss,
        help: "亏损交易净亏损绝对值的平均值，以正数表示。",
      },
      {
        id: "meanHold",
        label: "平均持仓",
        unit: "小时",
        value: (c) => c.evaluation?.meanHoldHours,
        help: "完整交易账本中的平均持仓时长。",
      },
      {
        id: "exposure",
        label: "持仓时间占比",
        format: "percent",
        value: (c) => c.evaluation?.exposurePct,
        help: "实际回放分钟中有持仓的时间比例。",
      },
      {
        id: "turnover",
        label: "累计换手 / 本金",
        unit: "倍",
        value: (c) => c.evaluation?.turnover,
        help: "累计成交名义金额相对初始资金。",
      },
    ],
  },
  {
    title: "收益来源与集中度",
    metrics: [
      {
        id: "long",
        label: "多头净贡献",
        unit: "USDT",
        value: (c) => c.evaluation?.longNetPnl,
        help: "全部多头交易的净盈亏。",
      },
      {
        id: "short",
        label: "空头净贡献",
        unit: "USDT",
        value: (c) => c.evaluation?.shortNetPnl,
        help: "全部空头交易的净盈亏。",
      },
      {
        id: "withoutBest",
        label: "去掉最大盈利",
        unit: "USDT",
        value: (c) => c.evaluation?.withoutBestTrade,
        help: "总净盈亏减去最大一笔净盈利，用于观察收益集中程度。",
      },
      {
        id: "bestShare",
        label: "最大盈利占总盈利",
        format: "percent",
        value: (c) => c.evaluation?.bestTradeShare,
        help: "最大单笔净盈利占全部正净盈利的比例；不是占总净收益的比例。",
      },
    ],
  },
  {
    title: "成本与资金",
    metrics: [
      {
        id: "finalEquity",
        label: "期末资金",
        unit: "USDT",
        value: (c) => c.metrics.finalEquity,
        help: "区间末尾结算后的资金。",
      },
      {
        id: "gross",
        label: "成本前盈亏",
        unit: "USDT",
        value: (c) => c.current?.costs.grossBeforeCosts,
        help: "加回手续费、资金费、模拟滑点及取整影响后的参考盈亏。",
      },
      {
        id: "fees",
        label: "手续费",
        unit: "USDT",
        value: (c) => c.metrics.fees,
        help: "全部实际模拟成交的手续费支出。",
      },
      {
        id: "funding",
        label: "资金费净支出",
        unit: "USDT",
        value: (c) => c.metrics.funding,
        help: "有符号资金费支出；负数表示收到资金费。",
      },
      {
        id: "slippage",
        label: "滑点与取整影响",
        unit: "USDT",
        value: (c) => c.current?.costs.slippageAndRounding,
        help: "已经体现在模拟成交价中，仅作成本诊断，不再从净收益中扣除。",
      },
      {
        id: "totalCost",
        label: "总成本",
        unit: "USDT",
        value: (c) => c.current?.costs.total,
        help: "手续费、资金费净支出、滑点与取整影响的合计。",
      },
      {
        id: "costRatio",
        label: "成本侵蚀率",
        format: "percent",
        value: (c) => c.current?.costs.costToGrossProfit,
        help: "总成本除以总成本前净盈亏；仅总成本前净盈亏为正时显示，并非盈利交易总额。",
      },
      {
        id: "netPnl",
        label: "净盈亏",
        unit: "USDT",
        value: (c) => c.current?.costs.netPnl,
        help: "成本前盈亏减去总成本，应与期末资金减初始本金一致。",
      },
    ],
  },
];

export function trendEvaluationView(metrics: TrendMetrics, window: EvaluationWindow) {
  const evaluation = metrics.evaluation;
  const current = evaluation?.version === 2 ? evaluation : undefined;
  const context: Context = { metrics, evaluation, current, window };
  const display = (definition: MetricDefinition): MetricDisplay => {
    const value = definition.value(context);
    const formatted =
      value == null
        ? (definition.empty?.(context) ?? "—")
        : definition.format === "percent"
          ? percent(value)
          : definition.format === "duration"
            ? duration(value)
            : number(value, definition.format === "integer" ? 0 : 2);
    return {
      id: definition.id,
      label: definition.label,
      value: formatted,
      help: definition.help,
      ...(definition.unit ? { unit: definition.unit } : {}),
    };
  };
  return {
    current,
    overview: overview.map(display),
    groups: groups.map((group) => ({ title: group.title, metrics: group.metrics.map(display) })),
    exits: Object.entries(evaluation?.exitReasons ?? {}).map(([reason, count]) => ({
      label: TREND_REASONS[reason] ?? reason,
      count,
    })),
    monthly: current?.monthly.map((period) => ({
      key: period.from,
      month: new Date(period.from).toISOString().slice(0, 7),
      from: timestamp(period.from),
      to: timestamp(period.to - 1),
      complete: period.complete,
      duration: duration(period.to - period.from),
      returnPct: percent(period.returnPct),
      positive: period.returnPct === null ? undefined : period.returnPct >= 0,
      equity: number(period.equity),
    })),
  };
}

/** Only project recorded observations for charts; never derive evaluation statistics here. */
export function trendPerformancePoints(
  result: TrendResult,
  initialCapital: number,
  window: EvaluationWindow,
) {
  const evaluation = result.metrics.evaluation;
  if (evaluation?.version === 2)
    return {
      sampled: false,
      equity: [
        { time: window.startTime, value: 1 },
        ...evaluation.daily.map((p) => ({ time: p.to - 1, value: p.equity / initialCapital })),
      ],
      drawdown: [
        { time: window.startTime, value: 0 },
        ...evaluation.daily.map((p) => ({ time: p.to - 1, value: p.drawdown * 100 })),
      ],
      intraday: [
        { time: window.startTime, value: 0 },
        ...evaluation.daily.map((p) => ({ time: p.to - 1, value: p.maxIntradayDrawdown * 100 })),
      ],
    };
  return {
    sampled: true,
    equity: [
      ...new Map(
        result.equity.map((p) => [Math.floor(p.time / 1000) * 1000, p.equity / initialCapital]),
      ),
    ]
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time, value })),
    drawdown: [],
    intraday: [],
  };
}
