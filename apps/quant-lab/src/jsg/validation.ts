import { validateConfig, type JsgConfig, type ResearchManifest } from "./model";
import { configKey, canonicalConfig } from "./session";
import { gridConfigs, MAX_GRID_CONFIGS, type GridAxis, type GridResult } from "./grid";
import type { WalkForwardResult } from "./walk-forward";

export interface ValidationRequest {
  mode: "cost" | "holdout" | "rolling" | "walk-forward";
  objective: "sharpe" | "totalReturn";
  axes: GridAxis[];
  trainPercent: number;
  trainDays: number;
  testDays: number;
}
export interface ValidationFold {
  train: { start: number; end: number };
  test: { start: number; end: number };
}
export interface ValidationPlan {
  folds: ValidationFold[];
  strategies: JsgConfig[];
  training: JsgConfig[];
}
export interface ValidationResult {
  version: 1 | 2;
  request: ValidationRequest;
  training: GridResult["results"];
  folds: (ValidationFold & {
    config: JsgConfig;
    trainMetrics: GridResult["results"][number]["metrics"];
    testMetrics: GridResult["results"][number]["metrics"];
  })[];
  costs: { multiplier: number; metrics: GridResult["results"][number]["metrics"] }[];
  costBase: JsgConfig;
  continuous?: WalkForwardResult;
}
export function validationPlan(
  manifest: ResearchManifest,
  base: JsgConfig,
  request: ValidationRequest,
): ValidationPlan {
  if (
    !["cost", "holdout", "rolling", "walk-forward"].includes(request.mode) ||
    !["sharpe", "totalReturn"].includes(request.objective)
  )
    throw new Error("验证方式或选择指标无效");
  const { researchWindow: _window, ...whole } = canonicalConfig(base);
  const strategies = request.mode === "cost" ? [whole] : gridConfigs(whole, request.axes);
  const dates = manifest.calendar
    .filter((d) => d.date >= manifest.startDate && d.date <= manifest.endDate)
    .map((d) => d.date);
  const folds: ValidationFold[] = [];
  if (request.mode === "holdout") {
    if (
      !Number.isFinite(request.trainPercent) ||
      request.trainPercent < 10 ||
      request.trainPercent > 90
    )
      throw new Error("训练比例应在 10–90% 内");
    const split = Math.floor((dates.length * request.trainPercent) / 100);
    if (split < 20 || dates.length - split < 5)
      throw new Error("样本外验证至少需要 20 个训练日和 5 个测试日");
    folds.push({
      train: { start: dates[0]!, end: dates[split - 1]! },
      test: { start: dates[split]!, end: dates.at(-1)! },
    });
  } else if (request.mode === "rolling" || request.mode === "walk-forward") {
    if (
      !Number.isSafeInteger(request.trainDays) ||
      request.trainDays < 20 ||
      !Number.isSafeInteger(request.testDays) ||
      request.testDays < 5
    )
      throw new Error("滚动窗口至少需要 20 个训练日和 5 个测试日");
    for (
      let split = request.trainDays;
      request.mode === "walk-forward"
        ? split < dates.length
        : split + request.testDays <= dates.length;
      split += request.testDays
    ) {
      folds.push({
        train: { start: dates[split - request.trainDays]!, end: dates[split - 1]! },
        test: {
          start: dates[split]!,
          end: dates[Math.min(dates.length, split + request.testDays) - 1]!,
        },
      });
      if (folds.length * strategies.length > MAX_GRID_CONFIGS)
        throw new Error("训练组合 × 滚动窗口超过 64，请减少参数值或增加测试窗口");
    }
    if (!folds.length) throw new Error("冻结数据不足以覆盖一个完整滚动窗口");
  }
  return {
    folds,
    strategies,
    training: folds.flatMap((f) => strategies.map((s) => ({ ...s, researchWindow: f.train }))),
  };
}
/** Only training metrics participate in selection; test results are unavailable at this point. */
export function selectValidationTests(
  plan: ValidationPlan,
  training: GridResult,
  objective: ValidationRequest["objective"],
) {
  if (training.results.length !== plan.training.length) throw new Error("训练结果数量不匹配");
  return plan.folds.map((fold, index) => {
    const rows = training.results.slice(
      index * plan.strategies.length,
      (index + 1) * plan.strategies.length,
    );
    for (const [i, row] of rows.entries())
      if (configKey(row.config) !== configKey(plan.training[index * plan.strategies.length + i]!))
        throw new Error("训练结果配置不匹配");
    const best = rows.reduce((a, b) => (b.metrics[objective] > a.metrics[objective] ? b : a));
    return { config: { ...best.config, researchWindow: fold.test }, trainMetrics: best.metrics };
  });
}
export function costStress(base: JsgConfig) {
  const { researchWindow: _window, ...whole } = canonicalConfig(base);
  const rows = [0.5, 1, 2, 3].map((multiplier) => {
    const config: JsgConfig = {
      ...whole,
      commissionBps: whole.commissionBps * multiplier,
      slippageBps: whole.slippageBps * multiplier,
      fees: (whole.fees ?? []).map((f) => ({
        ...f,
        ...(f.commissionBps != null ? { commissionBps: f.commissionBps * multiplier } : {}),
        minimumCommission: f.minimumCommission * multiplier,
        transferBps: f.transferBps * multiplier,
        sellTaxBps: f.sellTaxBps * multiplier,
      })),
    };
    validateConfig(config);
    return { multiplier, config };
  });
  return { rows, configs: [...new Map(rows.map((r) => [configKey(r.config), r.config])).values()] };
}
