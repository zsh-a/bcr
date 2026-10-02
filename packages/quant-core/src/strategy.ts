import type { JsgConfig } from "./model";
import type { ResearchManifest } from "@bcr/market-data/research/model";

export interface StrategySpec {
  id: "jsg" | "momentum";
  lookback: number;
  rebalance: "weekly" | "monthly" | "daily";
  allocation: "equal" | "inverse-volatility";
  investment: number;
}
export const DEFAULT_STRATEGY: StrategySpec = {
  id: "jsg",
  lookback: 20,
  rebalance: "weekly",
  allocation: "equal",
  investment: 0.95,
};
export const STRATEGIES = {
  jsg: {
    title: "行业宽度轮动",
    defaultRebalance: "weekly",
    version: "jsg-2",
    periodLabel: "宽度均线周期",
    description: "最宽行业决定是否持仓，按市值升序选择盈利股票。",
    fields: "复权价格、历史成分、行业、利润、股本",
  },
  momentum: {
    title: "横截面动量",
    defaultRebalance: "daily",
    version: "momentum-1",
    periodLabel: "动量观察周期",
    description: "按过去一段时间的复权收益排序，持有正动量最高的证券。",
    fields: "复权价格、选择成分、ST 标记；不使用利润或股本筛选",
  },
} as const;
export function strategySpec(config: Pick<JsgConfig, "strategy">): StrategySpec {
  return { ...DEFAULT_STRATEGY, ...config.strategy };
}
export function validateStrategy(spec: StrategySpec): void {
  if (!Object.hasOwn(STRATEGIES, spec.id)) throw new Error("策略类型无效");
  if (!Number.isSafeInteger(spec.lookback) || spec.lookback < 5 || spec.lookback > 250)
    throw new Error("观察周期应为 5–250 个交易日");
  if (!["weekly", "monthly", "daily"].includes(spec.rebalance)) throw new Error("调仓频率无效");
  if (!["equal", "inverse-volatility"].includes(spec.allocation)) throw new Error("仓位分配无效");
  if (!Number.isFinite(spec.investment) || spec.investment <= 0 || spec.investment > 1)
    throw new Error("目标投资比例应大于 0 且不超过 100%");
}
export function rebalanceSession(manifest: ResearchManifest, index: number, spec: StrategySpec) {
  const session = manifest.calendar[index];
  if (!session) return false;
  if (spec.rebalance === "daily") return true;
  if (spec.rebalance === "weekly") return session.rebalance;
  const next = manifest.calendar[index + 1];
  return (
    session.monthEnd ?? (!!next && Math.floor(next.date / 100) !== Math.floor(session.date / 100))
  );
}
export const warmupSessions = (spec: StrategySpec) =>
  spec.lookback + (spec.id === "momentum" || spec.allocation === "inverse-volatility" ? 1 : 0);
