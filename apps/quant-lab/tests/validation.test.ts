import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import initQuant, { JsgBacktest, JsgGrid } from "../../../crates/quant/pkg/bcr_quant.js";
import { demoResearch } from "../src/jsg/demo";
import { DEFAULT_CONFIG, type JsgConfig, type JsgResult } from "../src/jsg/model";
import {
  validationPlan,
  selectValidationTests,
  costStress,
  type ValidationRequest,
} from "../src/jsg/validation";
import type { GridResult } from "../src/jsg/grid";
import { canonicalConfig, configKey } from "../src/jsg/session";

beforeAll(async () => {
  await initQuant({
    module_or_path: readFileSync(
      new URL("../../../crates/quant/pkg/bcr_quant_bg.wasm", import.meta.url),
    ),
  });
});
const request: ValidationRequest = {
  mode: "holdout",
  objective: "sharpe",
  axes: [
    { field: "stockCount", values: "6,10" },
    { field: "stopLoss", values: "0,5" },
  ],
  trainPercent: 70,
  trainDays: 60,
  testDays: 20,
};
async function replay(configs: JsgConfig[], shared: boolean) {
  const demo = demoResearch();
  const engine = shared
    ? new JsgGrid(JSON.stringify(demo.manifest), JSON.stringify(configs))
    : new JsgBacktest(JSON.stringify(demo.manifest), JSON.stringify(configs[0]));
  try {
    for (const file of demo.files.slice(1)) {
      engine.load_partition(new Uint8Array(await file.arrayBuffer()));
      while (engine.advance()) {
        /* complete all frozen rows */
      }
    }
    return JSON.parse(engine.finish()) as GridResult & JsgResult;
  } finally {
    engine.free();
  }
}
describe("chronological validation", () => {
  it("splits on trading sessions and keeps windows and cache identities distinct", () => {
    const manifest = demoResearch().manifest,
      plan = validationPlan(manifest, DEFAULT_CONFIG, request);
    const dates = manifest.calendar.filter((d) => d.date >= manifest.startDate).map((d) => d.date),
      split = Math.floor(dates.length * 0.7);
    expect(plan.folds).toEqual([
      {
        train: { start: dates[0], end: dates[split - 1] },
        test: { start: dates[split], end: dates.at(-1) },
      },
    ]);
    expect(plan.training).toHaveLength(4);
    expect(configKey(plan.training[0]!)).not.toBe(
      configKey({ ...plan.training[0]!, researchWindow: plan.folds[0]!.test }),
    );
    expect(canonicalConfig(plan.training[0]!).researchWindow).toEqual(plan.folds[0]!.train);
  });
  it("uses bounded rolling training windows and non-overlapping complete test windows", () => {
    const plan = validationPlan(demoResearch().manifest, DEFAULT_CONFIG, {
      ...request,
      mode: "rolling",
    });
    expect(plan.folds).toHaveLength(4);
    expect(plan.training).toHaveLength(16);
    for (const [i, f] of plan.folds.entries()) {
      expect(f.train.end).toBeLessThan(f.test.start);
      if (i) expect(plan.folds[i - 1]!.test.end).toBeLessThan(f.test.start);
    }
    expect(() =>
      validationPlan(demoResearch().manifest, DEFAULT_CONFIG, {
        ...request,
        mode: "rolling",
        trainDays: 20,
        testDays: 5,
      }),
    ).toThrow(/64/u);
    expect(() =>
      validationPlan(demoResearch().manifest, DEFAULT_CONFIG, {
        ...request,
        mode: "rolling",
        trainDays: 200,
      }),
    ).toThrow(/不足/u);
    expect(() =>
      validationPlan(demoResearch().manifest, DEFAULT_CONFIG, { ...request, trainPercent: 99 }),
    ).toThrow();
  });
  it("selects solely by training metrics with stable tie handling", async () => {
    const plan = validationPlan(demoResearch().manifest, DEFAULT_CONFIG, request),
      training = await replay(plan.training, true);
    training.results.forEach((r, i) => {
      r.metrics.sharpe = i === 1 || i === 2 ? 5 : 1;
      r.metrics.totalReturn = i === 3 ? 10 : 0;
    });
    expect(selectValidationTests(plan, training, "sharpe")[0]!.config.stockCount).toBe(
      plan.training[1]!.stockCount,
    );
    expect(selectValidationTests(plan, training, "sharpe")[0]!.config.stopLoss).toBe(0.05);
    expect(selectValidationTests(plan, training, "totalReturn")[0]!.config.stockCount).toBe(10);
    expect(selectValidationTests(plan, training, "sharpe")[0]!.config.researchWindow).toEqual(
      plan.folds[0]!.test,
    );
    training.results.reverse();
    expect(() => selectValidationTests(plan, training, "sharpe")).toThrow(/配置/u);
  });
  it("matches independent Rust windows and leaves research history disabled for shared grids", async () => {
    const plan = validationPlan(demoResearch().manifest, DEFAULT_CONFIG, {
        ...request,
        mode: "rolling",
      }),
      grid = await replay(plan.training, true);
    for (const i of [0, 5, 15]) {
      const independent = await replay([plan.training[i]!], false);
      expect(grid.results[i]!.metrics).toEqual(independent.metrics);
      expect(independent.research![0]!.date.replaceAll("-", "")).toBe(
        String(plan.training[i]!.researchWindow!.start),
      );
      expect(independent.equity[0]!.holdings).toBe(0);
    }
  });
  it("scales every raw fee, deduplicates zero-cost profiles, and preserves the base", () => {
    const base: JsgConfig = {
      ...DEFAULT_CONFIG,
      executionModel: "jsg-raw-v2",
      fees: [
        { from: 20200101, commissionBps: 2, minimumCommission: 5, transferBps: 0.1, sellTaxBps: 5 },
      ],
    };
    const costs = costStress(base);
    expect(costs.configs).toHaveLength(4);
    expect(costs.rows[3]!.config.fees![0]).toEqual({
      from: 20200101,
      commissionBps: 6,
      minimumCommission: 15,
      transferBps: 0.30000000000000004,
      sellTaxBps: 15,
    });
    expect(base.fees![0]!.minimumCommission).toBe(5);
    expect(
      costStress({ ...DEFAULT_CONFIG, commissionBps: 0, slippageBps: 0 }).configs,
    ).toHaveLength(1);
  });
});
