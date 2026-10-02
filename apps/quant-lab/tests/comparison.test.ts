import { DEFAULT_CONFIG, validateConfig } from "@bcr/quant-core";
import { describe, expect, it } from "vitest";
import { gridConfigs } from "../src/experiments/grid";
import { compatibleRun, MAX_COMPARISONS, parameterDifferences } from "../src/results/comparison";
import { canonicalConfig, configKey } from "../src/session/config";
import type { ResearchRun } from "../src/session/model";
import { configErrors } from "../src/workbench/parameter-errors";

const run = (id: string, patch: Partial<ResearchRun> = {}) =>
  ({
    id,
    startDate: 20240101,
    endDate: 20241231,
    config: { ...DEFAULT_CONFIG },
    ...patch,
  }) as ResearchRun;
describe("research comparison", () => {
  it("requires distinct runs with exactly matching intervals", () => {
    expect(MAX_COMPARISONS).toBe(4);
    expect(compatibleRun(run("a"), run("b"))).toBe(true);
    expect(compatibleRun(run("a"), run("a"))).toBe(false);
    expect(compatibleRun(run("a"), run("b", { startDate: 20240102 }))).toBe(false);
    expect(compatibleRun(run("a"), run("b", { endDate: 20241230 }))).toBe(false);
  });
  it("compares canonical defaults and reports changes across every run", () => {
    const a = run("a"),
      b = run("b", { config: { ...DEFAULT_CONFIG, stockCount: 6, stopLoss: 0.1 } }),
      c = run("c", { config: { ...DEFAULT_CONFIG, stockCount: 8, initialCapital: 2_000_000 } });
    const differences = parameterDifferences([a, b, c]);
    expect(differences.find((d) => d.key === "stockCount")?.values).toEqual(["10", "6", "8"]);
    expect(differences.find((d) => d.key === "stopLoss")?.values).toEqual(["0%", "10%", "0%"]);
    expect(
      parameterDifferences([
        a,
        run("d", {
          config: {
            ...DEFAULT_CONFIG,
            executionModel: "jsg-adjusted-v1",
            participation: 0.1,
            fees: [],
          },
        }),
      ]),
    ).toEqual([]);
    expect(parameterDifferences([])).toEqual([]);
  });
});

describe("risk configuration contract", () => {
  it("keeps omitted limits disabled and gives every enabled limit a distinct cache identity", () => {
    const {
      maxPositionPct: _p,
      maxExposurePct: _e,
      maxDailyLoss: _d,
      takeProfit: _t,
      ...old
    } = DEFAULT_CONFIG;
    expect(canonicalConfig(old)).toEqual(canonicalConfig(DEFAULT_CONFIG));
    for (const key of ["maxPositionPct", "maxExposurePct", "maxDailyLoss", "takeProfit"] as const) {
      const config = { ...DEFAULT_CONFIG, [key]: 0.1 };
      expect(() => validateConfig(config)).not.toThrow();
      expect(configErrors(config)).toEqual({});
      expect(configKey(config)).not.toBe(configKey(DEFAULT_CONFIG));
      expect(parameterDifferences([run("a"), run("b", { config })])[0]?.key).toBe(key);
      expect(
        gridConfigs(DEFAULT_CONFIG, [{ field: key, values: "0, 10" }]).map((c) => c[key]),
      ).toEqual([0, 0.1]);
      expect(() => validateConfig({ ...config, [key]: NaN })).toThrow();
      expect(() => validateConfig({ ...config, [key]: -0.1 })).toThrow();
      expect(configErrors({ ...config, [key]: NaN })[key]).toBeDefined();
    }
    expect(() =>
      validateConfig({ ...DEFAULT_CONFIG, maxExposurePct: 1, maxPositionPct: 1, takeProfit: 2 }),
    ).not.toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, maxDailyLoss: 1 })).toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, maxPositionPct: 1.01 })).toThrow();
  });
});
