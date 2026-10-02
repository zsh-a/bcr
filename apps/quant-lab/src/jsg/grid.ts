import { validateConfig, strategySpec, type JsgConfig, type JsgResult } from "./model";
import { configKey, copyConfig } from "./session";

export const MAX_GRID_CONFIGS = 64;
export const GRID_FIELDS = {
  strategyLookback: { label: "观察周期", unit: "次", scale: 1 },
  stockCount: { label: "目标股票数", unit: "只", scale: 1 },
  poolSize: { label: "候选池大小", unit: "只", scale: 1 },
  stopLoss: { label: "个股止损", unit: "%", scale: 100 },
  trailingStop: { label: "移动止盈", unit: "%", scale: 100 },
  maxDrawdown: { label: "组合回撤", unit: "%", scale: 100 },
  maxPositionPct: { label: "单股仓位上限", unit: "%", scale: 100 },
  maxExposurePct: { label: "总仓位上限", unit: "%", scale: 100 },
  maxDailyLoss: { label: "单日亏损", unit: "%", scale: 100 },
  takeProfit: { label: "固定止盈", unit: "%", scale: 100 },
  slippageBps: { label: "滑点", unit: "bps", scale: 1 },
  commissionBps: { label: "佣金", unit: "bps", scale: 1 },
} as const;
export type GridField = keyof typeof GRID_FIELDS;
export const gridValue = (config: JsgConfig, field: GridField) =>
  field === "strategyLookback" ? strategySpec(config).lookback : (config[field] ?? 0);
export interface GridAxis {
  field: GridField;
  values: string;
}
export interface GridResult {
  decodedRows: number;
  results: { config: JsgConfig; metrics: JsgResult["metrics"] }[];
  timings?: { totalMs: number; readMs: number; computeMs: number; partitions: number };
}
export function gridConfigs(base: JsgConfig, axes: readonly GridAxis[]): JsgConfig[] {
  validateConfig(base);
  if (!axes.length || axes.length > 6) throw new Error("请选择 1–6 个实验参数");
  const fields = new Set<string>();
  let configs = [copyConfig(base)];
  for (const axis of axes) {
    const field = GRID_FIELDS[axis.field];
    if (!field || fields.has(axis.field)) throw new Error("实验参数不可重复");
    fields.add(axis.field);
    if (typeof axis.values !== "string" || axis.values.length > 400) throw new Error("参数值过长");
    const values = [
      ...new Set(
        axis.values
          .trim()
          .split(/[,，;；\s]+/u)
          .map((value) => {
            if (!value || !/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(value))
              throw new Error(`${field.label}：请输入用逗号分隔的数值`);
            const number = Number(value) / field.scale;
            if (!Number.isFinite(number)) throw new Error(`${field.label}数值无效`);
            return number;
          }),
      ),
    ];
    if (configs.length * values.length > MAX_GRID_CONFIGS)
      throw new Error(`组合数量超过 ${MAX_GRID_CONFIGS} 组，请减少参数值`);
    configs = configs.flatMap((config) =>
      values.map((value) =>
        axis.field === "strategyLookback"
          ? { ...copyConfig(config), strategy: { ...strategySpec(config), lookback: value } }
          : { ...copyConfig(config), [axis.field]: value },
      ),
    );
  }
  for (const config of configs) validateConfig(config);
  return [...new Map(configs.map((config) => [configKey(config), config])).values()];
}
export function validateGrid(configs: readonly JsgConfig[]) {
  if (!Array.isArray(configs) || !configs.length || configs.length > MAX_GRID_CONFIGS)
    throw new Error(`参数实验需要 1–${MAX_GRID_CONFIGS} 组配置`);
  for (const config of configs) validateConfig(config);
  if (new Set(configs.map(configKey)).size !== configs.length) throw new Error("参数组合重复");
}
export type GridMetric = "totalReturn" | "maxDrawdown" | "sharpe" | "fees";
export function rankGrid(result: GridResult, metric: GridMetric, descending: boolean) {
  return result.results
    .map((row, index) => ({ ...row, index }))
    .sort(
      (a, b) =>
        (descending
          ? b.metrics[metric] - a.metrics[metric]
          : a.metrics[metric] - b.metrics[metric]) || a.index - b.index,
    );
}
