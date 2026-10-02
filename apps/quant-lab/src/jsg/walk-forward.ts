import type { ArtifactRef } from "@bcr/core";
import { canonicalConfig, configKey } from "./session";
import {
  dateText,
  validateParameterSchedule,
  type JsgConfig,
  type JsgResult,
  type ResearchManifest,
  type ParameterStep,
} from "./model";
import { GRID_FIELDS, gridValue, type GridAxis } from "./grid";
import { evaluateResult, type Evaluation } from "./evaluation";
import { chunkData, type ResultStorage } from "./result-data";
import type { ValidationFold } from "./validation";

export interface DeployedFold {
  start: number;
  end: number;
  days: number;
  startEquity: number;
  endEquity: number;
  totalReturn: number;
  maxDrawdown: number;
  fees: number;
  filledOrders: number;
}
export interface ParameterStability {
  switches: number;
  transitions: number;
  axes: { field: GridAxis["field"]; values: { value: number; folds: number }[] }[];
}
export interface WalkForwardResult {
  config: JsgConfig;
  schedule: ParameterStep[];
  resultRef: ArtifactRef;
  result: JsgResult;
  evaluation: Evaluation;
  deployed: DeployedFold[];
  stability: ParameterStability;
}
export function walkForwardSchedule(
  manifest: ResearchManifest,
  choices: JsgConfig[],
  folds: ValidationFold[],
) {
  if (!folds.length || choices.length !== folds.length) throw new Error("连续回放的训练选择不完整");
  const window = { start: folds[0]!.test.start, end: folds.at(-1)!.test.end };
  const config = { ...canonicalConfig(choices[0]!), researchWindow: window };
  const schedule = folds.map((f, i) => {
    const previous = folds[i - 1];
    if (previous) {
      const next = manifest.calendar.findIndex((d) => d.date === previous.test.end) + 1;
      if (manifest.calendar[next]?.date !== f.test.start)
        throw new Error("连续测试窗口不能重叠或留空");
    }
    if (
      choices[i]!.researchWindow?.start !== f.test.start ||
      choices[i]!.researchWindow?.end !== f.test.end
    )
      throw new Error("选定参数与测试窗口不一致");
    return {
      from: f.test.start,
      selectedAt: f.train.end,
      config: { ...canonicalConfig(choices[i]!), researchWindow: window },
    };
  });
  validateParameterSchedule(manifest, config, schedule);
  return { config, schedule };
}
export function parameterStability(
  schedule: ParameterStep[],
  axes: GridAxis[],
): ParameterStability {
  const keys = schedule.map((s) => {
    const { researchWindow: _window, ...config } = s.config;
    return configKey(config);
  });
  return {
    transitions: Math.max(0, keys.length - 1),
    switches: keys.slice(1).filter((key, i) => key !== keys[i]).length,
    axes: axes.map((axis) => {
      if (!GRID_FIELDS[axis.field]) throw new Error("稳定性参数无效");
      const counts = new Map<number, number>();
      for (const s of schedule) {
        const value = gridValue(s.config, axis.field);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return {
        field: axis.field,
        values: [...counts].sort(([a], [b]) => a - b).map(([value, folds]) => ({ value, folds })),
      };
    }),
  };
}
/** Scan full daily data, preserving the prior fold's closing equity as each segment's baseline. */
export async function analyzeWalkForward(
  services: ResultStorage,
  manifest: ResearchManifest,
  result: JsgResult,
  config: JsgConfig,
  folds: ValidationFold[],
  signal: AbortSignal,
) {
  const window = config.researchWindow!;
  const dates = manifest.calendar
    .filter((d) => d.date >= window.start && d.date <= window.end)
    .map((d) => dateText(d.date));
  const startIndex = manifest.calendar.findIndex((d) => d.date === window.start);
  const evaluation = await evaluateResult(
    services,
    result,
    config.initialCapital,
    dates,
    dateText(manifest.calendar[startIndex - 1]!.date),
    undefined,
    signal,
  );
  const deployed: DeployedFold[] = folds.map((f) => ({
    start: f.test.start,
    end: f.test.end,
    days: 0,
    startEquity: 0,
    endEquity: 0,
    totalReturn: 0,
    maxDrawdown: 0,
    fees: 0,
    filledOrders: 0,
  }));
  let index = 0,
    previous = config.initialCapital,
    peak = previous;
  const consume = (chunk: Pick<JsgResult, "equity" | "orders">) => {
    for (const p of chunk.equity) {
      const date = Number(p.date.replaceAll("-", ""));
      while (deployed[index] && date > deployed[index]!.end) index++;
      const fold = deployed[index];
      if (!fold || date < fold.start) throw new Error("连续结果与测试窗口不一致");
      if (!fold.days) {
        fold.startEquity = previous;
        peak = previous;
      }
      fold.days++;
      fold.endEquity = p.equity;
      fold.totalReturn = p.equity / fold.startEquity - 1;
      peak = Math.max(peak, p.equity);
      fold.maxDrawdown = Math.min(fold.maxDrawdown, p.equity / peak - 1);
      previous = p.equity;
    }
    for (const order of chunk.orders) {
      const date = Number(order.date.replaceAll("-", ""));
      const fold = deployed.find((f) => f.start <= date && date <= f.end);
      if (!fold) throw new Error("连续成交发生在样本外区间之外");
      fold.fees += order.fee;
      fold.filledOrders += Number(order.quantity > 0);
    }
  };
  if (result.chunks === undefined) consume(result);
  else
    for (const c of result.chunks) {
      signal.throwIfAborted();
      consume(await chunkData(services, c.ref, signal));
    }
  if (deployed.some((f) => !f.days)) throw new Error("连续结果缺少测试窗口");
  signal.throwIfAborted();
  return { evaluation, deployed };
}
