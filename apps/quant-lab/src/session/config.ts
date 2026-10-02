import { MODEL, strategySpec, type JsgConfig } from "@bcr/quant-core";
import { type DatasetRefs, type ResearchSession } from "./model";

export function copyConfig(config: JsgConfig): JsgConfig {
  return structuredClone(config);
}
export function configKey(c: JsgConfig): string {
  return JSON.stringify({
    strategy: strategySpec(c),
    ...(c.researchWindow
      ? { researchWindow: { start: c.researchWindow.start, end: c.researchWindow.end } }
      : {}),
    executionModel: c.executionModel ?? MODEL,
    initialCapital: c.initialCapital,
    poolSize: c.poolSize,
    stockCount: c.stockCount,
    commissionBps: c.commissionBps,
    slippageBps: c.slippageBps,
    stopLoss: c.stopLoss,
    trailingStop: c.trailingStop,
    maxDrawdown: c.maxDrawdown,
    maxPositionPct: c.maxPositionPct ?? 0,
    maxExposurePct: c.maxExposurePct ?? 0,
    maxDailyLoss: c.maxDailyLoss ?? 0,
    takeProfit: c.takeProfit ?? 0,
    tPlusOne: c.tPlusOne,
    industryBlacklist: [...c.industryBlacklist].sort(),
    participation: c.participation ?? 0.1,
    fees: (c.fees ?? []).map((f) => ({
      from: f.from,
      commissionBps: f.commissionBps ?? null,
      minimumCommission: f.minimumCommission,
      transferBps: f.transferBps,
      sellTaxBps: f.sellTaxBps,
    })),
  });
}
export function datasetKey(d: DatasetRefs): string {
  return JSON.stringify([
    d.manifestRef.hash ?? d.manifestRef.id,
    ...d.partitions.map((p) => p.hash ?? p.id),
  ]);
}
/** Single and grid detail jobs use the same explicit defaults for their task-cache identity. */
export function canonicalConfig(config: JsgConfig): JsgConfig {
  return JSON.parse(configKey(config)) as JsgConfig;
}
export function isDraftChanged(state: ResearchSession): boolean {
  const run = state.selected?.run;
  return (
    run !== undefined &&
    (configKey(state.draft) !== configKey(run.config) ||
      state.dataset === null ||
      datasetKey(state.dataset) !== datasetKey(run.dataset))
  );
}
