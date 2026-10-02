import type { ArtifactRef } from "@bcr/core";
import { dateValue, type ResearchManifest } from "@bcr/market-data/research/model";
import type { Diagnostics, ResearchDay } from "./research-model";
import { strategySpec, validateStrategy, type StrategySpec } from "./strategy";
export * from "./strategy";
export const MODEL = "jsg-adjusted-v1";
export interface FeeSchedule {
  commissionBps?: number | null;
  from: number;
  minimumCommission: number;
  transferBps: number;
  sellTaxBps: number;
}
export interface ResearchConfig {
  strategy?: StrategySpec;
  researchWindow?: { start: number; end: number };
  executionModel?: "jsg-adjusted-v1" | "jsg-raw-v2";
  fees?: FeeSchedule[];
  participation?: number;
  initialCapital: number;
  poolSize: number;
  stockCount: number;
  commissionBps: number;
  slippageBps: number;
  stopLoss: number;
  trailingStop: number;
  maxDrawdown: number;
  maxPositionPct?: number;
  maxExposurePct?: number;
  maxDailyLoss?: number;
  takeProfit?: number;
  tPlusOne: boolean;
  industryBlacklist: string[];
}
export type JsgConfig = ResearchConfig;
export interface ParameterStep {
  from: number;
  selectedAt: number;
  config: ResearchConfig;
}
/** Selection closes must immediately precede deployment; execution assumptions stay fixed. */
export function validateParameterSchedule(
  manifest: ResearchManifest,
  base: ResearchConfig,
  steps: ParameterStep[],
) {
  validateConfig(base);
  const window = base.researchWindow;
  if (
    window &&
    (window.start < manifest.startDate ||
      window.end > manifest.endDate ||
      !manifest.calendar.some((d) => d.date === window.end))
  )
    throw new Error("连续回放区间必须使用快照覆盖的交易日");
  if (
    !window ||
    !Array.isArray(steps) ||
    !steps.length ||
    steps.length > 64 ||
    steps[0]!.from !== window.start
  )
    throw new Error("连续回放需要覆盖样本外起点的 1–64 段参数");
  const executionKey = (c: ResearchConfig) =>
    JSON.stringify([
      c.initialCapital,
      c.executionModel ?? MODEL,
      c.tPlusOne,
      c.participation ?? 0.1,
      c.commissionBps,
      c.slippageBps,
      (c.fees ?? []).map((f) => [
        f.from,
        f.commissionBps ?? null,
        f.minimumCommission,
        f.transferBps,
        f.sellTaxBps,
      ]),
      strategySpec(c).id,
    ]);
  let previous = 0;
  for (const step of steps) {
    validateConfig(step.config);
    const index = manifest.calendar.findIndex((d) => d.date === step.from);
    if (
      step.from <= previous ||
      step.from > window.end ||
      index < 1 ||
      manifest.calendar[index - 1]!.date !== step.selectedAt
    )
      throw new Error("参数必须由部署前一个交易日的训练结果选出");
    const w = step.config.researchWindow;
    if (
      !w ||
      w.start !== window.start ||
      w.end !== window.end ||
      executionKey(step.config) !== executionKey(base)
    )
      throw new Error("连续回放不可更改本金、成交规则或策略类型");
    previous = step.from;
  }
}
export const DEFAULT_CONFIG: JsgConfig = {
  initialCapital: 1_000_000,
  poolSize: 20,
  stockCount: 10,
  commissionBps: 3,
  slippageBps: 10,
  stopLoss: 0,
  trailingStop: 0,
  maxDrawdown: 0,
  maxPositionPct: 0,
  maxExposurePct: 0,
  maxDailyLoss: 0,
  takeProfit: 0,
  tPlusOne: false,
  industryBlacklist: ["ads"],
};
export interface JsgResult {
  diagnostics?: Diagnostics;
  research?: ResearchDay[];
  timings?: {
    totalMs: number;
    readMs: number;
    computeMs: number;
    writeMs: number;
    rows: number;
    partitions: number;
  };
  chunks?: {
    ref: ArtifactRef;
    start: string;
    end: string;
    orders: number;
    codes?: string[];
    orderStats?: { side: string; status: string; filled: boolean; count: number }[];
  }[];
  receivables?: number;
  metrics: {
    engine: string;
    model: string;
    finalEquity: number;
    totalReturn: number;
    annualizedReturn: number;
    sharpe: number;
    maxDrawdown: number;
    filledOrders: number;
    rejectedOrders: number;
    fees: number;
    days: number;
  };
  equity: { date: string; equity: number; cash: number; drawdown: number; holdings: number }[];
  orders: {
    date: string;
    signalDate: string;
    code: string;
    side: string;
    timing: string;
    reason: string;
    riskReason?: string;
    requested: number;
    quantity: number;
    price: number;
    fee: number;
    status: string;
  }[];
  holdings: { code: string; quantity: number; averageCost: number; price: number; value: number }[];
  decisions: { date: string; topIndustry: string | null; breadth: number; targets: string[] }[];
  pendingOrders: number;
  warnings: string[];
}
export function validateConfig(config: JsgConfig): void {
  validateStrategy(strategySpec(config));
  if (config.researchWindow) {
    dateValue(config.researchWindow.start);
    dateValue(config.researchWindow.end);
    if (config.researchWindow.start > config.researchWindow.end)
      throw new Error("研究窗口日期无效");
  }
  if (
    config.executionModel !== undefined &&
    config.executionModel !== "jsg-adjusted-v1" &&
    config.executionModel !== "jsg-raw-v2"
  )
    throw new Error("成交模型无效");
  if (
    config.participation !== undefined &&
    (!Number.isFinite(config.participation) ||
      config.participation <= 0 ||
      config.participation > 1)
  )
    throw new Error("成交量参与率应在 0–100% 内");
  let previous = 0;
  for (const f of config.fees ?? []) {
    dateValue(f.from);
    if (
      f.commissionBps !== undefined &&
      f.commissionBps !== null &&
      (!Number.isFinite(f.commissionBps) || f.commissionBps < 0 || f.commissionBps > 100)
    )
      throw new Error("分期佣金应在 0–100 bps 内");
    if (
      f.from <= previous ||
      [f.minimumCommission, f.transferBps, f.sellTaxBps].some(
        (v) => !Number.isFinite(v) || v < 0 || v > 10000,
      )
    )
      throw new Error("费用日期必须递增，费率需有效");
    previous = f.from;
  }
  if (config.executionModel === "jsg-raw-v2" && (config.fees?.length ?? 0) === 0)
    throw new Error("原始价格模型需要明确的费用表");
  if (
    !Number.isFinite(config.initialCapital) ||
    config.initialCapital <= 0 ||
    config.initialCapital > 1e15 ||
    !Number.isSafeInteger(config.poolSize) ||
    config.poolSize < 1 ||
    config.poolSize > 20_000 ||
    !Number.isSafeInteger(config.stockCount) ||
    config.stockCount < 1 ||
    config.stockCount > config.poolSize ||
    typeof config.tPlusOne !== "boolean" ||
    !Array.isArray(config.industryBlacklist) ||
    config.industryBlacklist.some((s) => typeof s !== "string")
  )
    throw new Error("本金、股票数或候选池参数无效");
  for (const bps of [config.commissionBps, config.slippageBps]) {
    if (!Number.isFinite(bps) || bps < 0 || bps > 100)
      throw new Error("费率或滑点应在 0–100 bps 内");
  }
  for (const risk of [
    config.stopLoss,
    config.trailingStop,
    config.maxDrawdown,
    config.maxDailyLoss ?? 0,
  ]) {
    if (!Number.isFinite(risk) || risk < 0 || risk >= 1)
      throw new Error("风控比例应在 0–100% 内，0 为关闭");
  }
  for (const cap of [config.maxPositionPct ?? 0, config.maxExposurePct ?? 0]) {
    if (!Number.isFinite(cap) || cap < 0 || cap > 1)
      throw new Error("仓位上限应在 0–100% 内，0 为关闭");
  }
  const takeProfit = config.takeProfit ?? 0;
  if (!Number.isFinite(takeProfit) || takeProfit < 0 || takeProfit > 10)
    throw new Error("固定止盈应在 0–1000% 内，0 为关闭");
}
