import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import { Effect } from "effect";
import initQuant, { JsgBacktest, JsgGrid } from "../../../crates/quant/pkg/bcr_quant.js";
import { demoResearch } from "../src/jsg/demo";
import {
  DEFAULT_CONFIG,
  strategySpec,
  validateParameterSchedule,
  type JsgConfig,
  type JsgResult,
  type ParameterStep,
} from "../src/jsg/model";
import {
  validationPlan,
  selectValidationTests,
  type ValidationRequest,
} from "../src/jsg/validation";
import {
  walkForwardSchedule,
  analyzeWalkForward,
  parameterStability,
} from "../src/jsg/walk-forward";
import type { GridResult } from "../src/jsg/grid";

const request: ValidationRequest = {
  mode: "walk-forward",
  objective: "sharpe",
  axes: [
    { field: "stockCount", values: "6,10" },
    { field: "strategyLookback", values: "10,20" },
  ],
  trainPercent: 70,
  trainDays: 60,
  testDays: 20,
};
const storage = { artifacts: { get: () => Effect.die(new Error("unexpected read")) } };
beforeAll(async () => {
  await initQuant({
    module_or_path: readFileSync(
      new URL("../../../crates/quant/pkg/bcr_quant_bg.wasm", import.meta.url),
    ),
  });
});
async function replay(configs: JsgConfig[], schedule?: ParameterStep[], streaming = false) {
  const demo = demoResearch();
  const engine =
    configs.length > 1
      ? new JsgGrid(JSON.stringify(demo.manifest), JSON.stringify(configs))
      : new JsgBacktest(JSON.stringify(demo.manifest), JSON.stringify(configs[0]));
  const collected = { equity: [], orders: [], decisions: [], research: [] } as Required<
    Pick<JsgResult, "equity" | "orders" | "decisions" | "research">
  >;
  try {
    if (engine instanceof JsgBacktest) {
      if (schedule) engine.set_schedule(JSON.stringify(schedule));
      if (streaming) engine.enable_streaming();
    }
    for (const file of demo.files.slice(1)) {
      engine.load_partition(new Uint8Array(await file.arrayBuffer()));
      while (engine.advance()) {
        if (streaming && engine instanceof JsgBacktest) {
          const chunk = JSON.parse(engine.drain_output()) as typeof collected;
          for (const field of ["equity", "orders", "decisions", "research"] as const)
            collected[field].push(...(chunk[field] as never[]));
        }
      }
    }
    const result = JSON.parse(engine.finish()) as JsgResult & GridResult;
    return streaming ? Object.assign(result, collected) : result;
  } finally {
    engine.free();
  }
}

it("covers every out-of-sample session, including the shorter final window", () => {
  const manifest = demoResearch().manifest,
    plan = validationPlan(manifest, DEFAULT_CONFIG, request);
  expect(plan.folds).toHaveLength(5);
  expect(plan.training).toHaveLength(20);
  expect(plan.folds.at(-1)!.test.end).toBe(manifest.endDate);
  const sessions = manifest.calendar.filter((d) => d.date >= manifest.startDate);
  expect(sessions.filter((d) => d.date >= plan.folds[0]!.test.start)).toHaveLength(96);
  expect(sessions.filter((d) => d.date >= plan.folds.at(-1)!.test.start)).toHaveLength(16);
  expect(() =>
    validationPlan(manifest, DEFAULT_CONFIG, { ...request, mode: "invalid" as never }),
  ).toThrow();
});

it("produces actual continuous metrics and deployed-fold compounding from full daily results", async () => {
  const manifest = demoResearch().manifest,
    plan = validationPlan(manifest, DEFAULT_CONFIG, request);
  const training = await replay(plan.training);
  const choices = selectValidationTests(plan, training, request.objective);
  const { config, schedule } = walkForwardSchedule(
    manifest,
    choices.map((c) => c.config),
    plan.folds,
  );
  const result = await replay([config], schedule);
  const analysis = await analyzeWalkForward(
    storage,
    manifest,
    result,
    config,
    plan.folds,
    new AbortController().signal,
  );
  expect(result.metrics.days).toBe(96);
  expect(analysis.evaluation.strategy.totalReturn).toBeCloseTo(result.metrics.totalReturn, 12);
  expect(analysis.evaluation.strategy.sharpe).toBeCloseTo(result.metrics.sharpe, 12);
  expect(analysis.deployed.map((d) => d.days)).toEqual([20, 20, 20, 20, 16]);
  expect(analysis.deployed.reduce((total, d) => total * (1 + d.totalReturn), 1) - 1).toBeCloseTo(
    result.metrics.totalReturn,
    12,
  );
  for (let i = 1; i < analysis.deployed.length; i++)
    expect(analysis.deployed[i]!.startEquity).toBe(analysis.deployed[i - 1]!.endEquity);
  expect(
    result.orders.every((o) => Number(o.date.replaceAll("-", "")) >= config.researchWindow!.start),
  ).toBe(true);
  const streamed = await replay([config], schedule, true);
  expect(streamed.metrics).toEqual(result.metrics);
  expect(streamed.equity).toEqual(result.equity);
  expect(streamed.orders).toEqual(result.orders);
});

it("rejects future selection, gaps, mismatched choices and changing execution assumptions", () => {
  const manifest = demoResearch().manifest,
    plan = validationPlan(manifest, DEFAULT_CONFIG, request);
  const choices = plan.folds.map((f) => ({ ...DEFAULT_CONFIG, researchWindow: f.test }));
  const { config, schedule } = walkForwardSchedule(manifest, choices, plan.folds);
  const invalid = structuredClone(schedule);
  invalid[0]!.selectedAt = invalid[0]!.from;
  expect(() => validateParameterSchedule(manifest, config, invalid)).toThrow(/前一个/u);
  invalid[0] = { ...schedule[0]!, config: { ...config, initialCapital: 2e6 } };
  expect(() => validateParameterSchedule(manifest, config, invalid)).toThrow(/本金/u);
  const gaps = structuredClone(plan.folds);
  gaps[1]!.test.start = manifest.calendar.find((d) => d.date > gaps[1]!.test.start)!.date;
  expect(() => walkForwardSchedule(manifest, choices, gaps)).toThrow(/留空/u);
  choices[0]!.researchWindow = plan.folds[1]!.test;
  expect(() => walkForwardSchedule(manifest, choices, plan.folds)).toThrow(/不一致/u);
});

it("does not let later parameter choices change earlier account history", async () => {
  const manifest = demoResearch().manifest,
    plan = validationPlan(manifest, DEFAULT_CONFIG, request);
  const { config, schedule } = walkForwardSchedule(
    manifest,
    plan.folds.map((f) => ({ ...DEFAULT_CONFIG, researchWindow: f.test })),
    plan.folds,
  );
  const changed = structuredClone(schedule);
  changed[2]!.config.strategy = { ...strategySpec(config), lookback: 45 };
  const first = await replay([config], schedule),
    second = await replay([config], changed);
  const cutoff = String(changed[2]!.selectedAt);
  expect(second.equity.filter((p) => p.date.replaceAll("-", "") <= cutoff)).toEqual(
    first.equity.filter((p) => p.date.replaceAll("-", "") <= cutoff),
  );
  expect(second.orders.filter((p) => p.date.replaceAll("-", "") <= cutoff)).toEqual(
    first.orders.filter((p) => p.date.replaceAll("-", "") <= cutoff),
  );
});

it("counts parameter switches independently of deployment dates", () => {
  const manifest = demoResearch().manifest,
    plan = validationPlan(manifest, DEFAULT_CONFIG, request);
  const { schedule } = walkForwardSchedule(
    manifest,
    plan.folds.map((f, i) => ({
      ...DEFAULT_CONFIG,
      stockCount: i === 2 ? 6 : 10,
      researchWindow: f.test,
    })),
    plan.folds,
  );
  const stability = parameterStability(schedule, request.axes);
  expect(stability.switches).toBe(2);
  expect(stability.transitions).toBe(4);
  expect(stability.axes[0]!.values).toEqual([
    { value: 6, folds: 1 },
    { value: 10, folds: 4 },
  ]);
  expect(stability.axes[1]!.values).toEqual([{ value: 20, folds: 5 }]);
});
