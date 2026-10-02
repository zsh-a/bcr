import { validateConfig, type JsgConfig } from "@bcr/quant-core";

export function configErrors(config: JsgConfig): Record<string, string> {
  const errors: Record<string, string> = {};
  if (
    !Number.isFinite(config.initialCapital) ||
    config.initialCapital <= 0 ||
    config.initialCapital > 1e15
  )
    errors["initialCapital"] = "请输入大于 0 的有效金额";
  if (!Number.isSafeInteger(config.poolSize) || config.poolSize < 1 || config.poolSize > 20_000)
    errors["poolSize"] = "候选池应为 1–20,000 的整数";
  if (
    !Number.isSafeInteger(config.stockCount) ||
    config.stockCount < 1 ||
    config.stockCount > config.poolSize
  )
    errors["stockCount"] = "股票数应为整数，且不超过候选池";
  for (const key of ["commissionBps", "slippageBps"] as const)
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 100)
      errors[key] = "请输入 0–100 bps 的有效数值";
  for (const key of ["stopLoss", "trailingStop", "maxDrawdown", "maxDailyLoss"] as const)
    if (!Number.isFinite(config[key] ?? 0) || (config[key] ?? 0) < 0 || (config[key] ?? 0) >= 1)
      errors[key] = "请输入小于 100% 的有效比例";
  for (const key of ["maxPositionPct", "maxExposurePct", "takeProfit"] as const) {
    const value = config[key] ?? 0,
      max = key === "takeProfit" ? 10 : 1;
    if (!Number.isFinite(value) || value < 0 || value > max)
      errors[key] = `请输入 0–${max * 100}% 的有效比例`;
  }
  try {
    validateConfig(config);
  } catch (error) {
    if (Object.keys(errors).length === 0)
      errors["advanced"] = error instanceof Error ? error.message : String(error);
  }
  return errors;
}
