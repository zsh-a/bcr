import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import initQuant, { JsgBacktest, JsgGrid } from "../../../crates/quant/pkg/bcr_quant.js";
import { demoResearch } from "../src/jsg/demo";
import {
  DEFAULT_CONFIG,
  DEFAULT_STRATEGY,
  parseManifest,
  strategySpec,
  rebalanceSession,
  type JsgConfig,
} from "../src/jsg/model";
import { gridConfigs } from "../src/jsg/grid";
import { configKey } from "../src/jsg/session";
import { researchContext, snapshotDifference } from "../src/jsg/context";
import { prepareCalendar, publicProfile, DEFAULT_CONNECTION } from "../src/jsg/clickhouse-http";
beforeAll(async () => {
  await initQuant({
    module_or_path: readFileSync(
      new URL("../../../crates/quant/pkg/bcr_quant_bg.wasm", import.meta.url),
    ),
  });
});
async function execute(engine: JsgBacktest | JsgGrid) {
  try {
    for (const file of demoResearch().files.slice(1)) {
      engine.load_partition(new Uint8Array(await file.arrayBuffer()));
      while (engine.advance()) {
        /* daily replay */
      }
    }
    return JSON.parse(engine.finish());
  } finally {
    engine.free();
  }
}
it("replays mixed strategy periods identically in shared WASM grids and independent portfolios", async () => {
  const configs: JsgConfig[] = [
    DEFAULT_CONFIG,
    {
      ...DEFAULT_CONFIG,
      strategy: { ...DEFAULT_STRATEGY, id: "momentum", lookback: 10, rebalance: "daily" },
    },
    {
      ...DEFAULT_CONFIG,
      strategy: { ...DEFAULT_STRATEGY, lookback: 5, allocation: "inverse-volatility" },
    },
  ];
  const manifest = JSON.stringify(demoResearch().manifest);
  const shared = await execute(new JsgGrid(manifest, JSON.stringify(configs)));
  for (let i = 0; i < configs.length; i++)
    expect(shared.results[i].metrics).toEqual(
      (await execute(new JsgBacktest(manifest, JSON.stringify(configs[i])))).metrics,
    );
  const momentum = await execute(new JsgBacktest(manifest, JSON.stringify(configs[1])));
  expect(momentum.orders.length).toBeGreaterThan(0);
  expect(
    momentum.research.some((d: { candidates: { score?: number }[] | null }) =>
      d.candidates?.some((c) => c.score !== undefined),
    ),
  ).toBe(true);
});
it("includes signal periods in cache identity and expands them as real strategy grid parameters", () => {
  const configs = gridConfigs(DEFAULT_CONFIG, [{ field: "strategyLookback", values: "5,20,60" }]);
  expect(configs.map((c) => strategySpec(c).lookback)).toEqual([5, 20, 60]);
  expect(new Set(configs.map(configKey)).size).toBe(3);
  expect(configKey(DEFAULT_CONFIG)).toBe(
    configKey({ ...DEFAULT_CONFIG, strategy: DEFAULT_STRATEGY }),
  );
  expect(() => gridConfigs(DEFAULT_CONFIG, [{ field: "strategyLookback", values: "251" }])).toThrow(
    "5–250",
  );
});
it("retains full-calendar month ends and requests longer warmup without persisting credentials", () => {
  const all: string[] = [];
  for (let day = 0; day < 140; day++)
    all.push(new Date(Date.UTC(2023, 10, 1 + day)).toISOString().slice(0, 10));
  const prepared = prepareCalendar(all, "2024-01-01", "2024-01-15", 61);
  expect(prepared.dates).toHaveLength(76);
  expect(prepared.sessions.at(-1)!.monthEnd).toBe(false);
  const profile = publicProfile(
    { ...DEFAULT_CONNECTION, password: "secret" },
    { start: "2024-01-01", end: "2024-01-15", strictPit: true, refresh: false, warmupSessions: 61 },
  );
  expect(profile.warmupSessions).toBe(61);
  expect(JSON.stringify(profile)).not.toContain("secret");
  const manifest = demoResearch().manifest;
  manifest.calendar.at(-1)!.monthEnd = false;
  const parsed = parseManifest(manifest);
  expect(parsed.calendar.at(-1)!.monthEnd).toBe(false);
  expect(
    rebalanceSession(parsed, parsed.calendar.length - 1, {
      ...DEFAULT_STRATEGY,
      rebalance: "monthly",
    }),
  ).toBe(false);
});
it("distinguishes immutable snapshot differences and strategy-specific data requirements", () => {
  const manifest = demoResearch().manifest;
  const dataset = {
    manifest,
    manifestRef: { id: "one", type: "quant/jsg-manifest", storage: "opfs" as const },
    partitions: [{ id: "p1", type: "quant/jsg-daily", storage: "opfs" as const, hash: "same" }],
  };
  const after = {
    ...dataset,
    manifest: {
      ...manifest,
      calendar: manifest.calendar.slice(0, -1),
      instruments: manifest.instruments.slice(1),
    },
    partitions: [{ ...dataset.partitions[0]!, hash: "different" }],
  };
  const diff = snapshotDifference(dataset, after);
  expect(diff.removedDates).toBe(1);
  expect(diff.removedSymbols).toBe(1);
  expect(diff.differentPartitions).toBe(1);
  const context = researchContext(dataset, {
    ...DEFAULT_CONFIG,
    strategy: { ...DEFAULT_STRATEGY, id: "momentum", lookback: 60 },
  });
  expect(context.requiredWarmup).toBe(61);
  expect(context.rows.find((r) => r.label === "财务数据")!.value).toBe("策略不使用财务筛选");
});
