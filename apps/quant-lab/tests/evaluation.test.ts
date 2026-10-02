import type { ArtifactRef } from "@bcr/core";
import {
  benchmarkBaseline,
  fetchBenchmark,
  parseBenchmarkCsv,
  validateBenchmark,
  validateBenchmarkCoverage,
  type BenchmarkSnapshot,
} from "@bcr/market-data/research/benchmark";
import { dateText } from "@bcr/market-data/research/model";
import { DEFAULT_CONFIG } from "@bcr/quant-core";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import initQuant, { JsgBacktest } from "../../../crates/quant/pkg/bcr_quant.js";
import { demoResearch } from "../src/data/demo";
import { evaluateResult } from "../src/results/evaluation";
const dates = ["2024-12-30", "2024-12-31", "2025-01-02", "2025-02-03"],
  baseline = "2024-12-27";
const signal = () => new AbortController().signal;
const storage = { artifacts: { get: () => Effect.die(new Error("unexpected read")) } };
const result = {
  equity: [110, 99, 108.9, 119.79].map((equity, i) => ({
    date: dates[i]!,
    equity,
    cash: 0,
    drawdown: 0,
    holdings: 0,
  })),
  orders: [],
  decisions: [],
};
const benchmark = (): BenchmarkSnapshot => ({
  version: 1,
  name: "测试基准",
  kind: "price",
  source: "fixture",
  acquiredAt: "2026-10-01T00:00:00Z",
  points: [baseline, ...dates].map((date, i) => ({ date, close: [100, 105, 100, 110, 121][i]! })),
});
beforeAll(async () => {
  await initQuant({
    module_or_path: readFileSync(
      new URL("../../../crates/quant/pkg/bcr_quant_bg.wasm", import.meta.url),
    ),
  });
});
describe("research evaluation", () => {
  it("evaluates a detail window and only requires its preceding session and covered dates", async () => {
    const full = demoResearch().manifest;
    const sessions = full.calendar.filter((s) => s.date >= full.startDate);
    const manifest = { ...full, startDate: sessions[10]!.date, endDate: sessions[19]!.date };
    const baseline = benchmarkBaseline(manifest);
    const timeline = sessions.slice(10, 20).map((s) => dateText(s.date));
    const snapshot = {
      ...benchmark(),
      points: [baseline, ...timeline].map((date, i) => ({ date, close: 100 + i })),
    };
    expect(() => validateBenchmarkCoverage(snapshot, manifest)).not.toThrow();
    expect(() =>
      validateBenchmarkCoverage({ ...snapshot, points: snapshot.points.slice(1) }, manifest),
    ).toThrow(/缺少交易日/u);
    const window = {
      ...result,
      equity: timeline.map((date, i) => ({ ...result.equity[0]!, date, equity: 101 + i })),
    };
    const evaluated = await evaluateResult(
      storage,
      window,
      100,
      timeline,
      baseline,
      snapshot,
      signal(),
    );
    expect(evaluated.strategy.days).toBe(10);
    expect(evaluated.first).toBe(timeline[0]);
    expect(evaluated.last).toBe(timeline.at(-1));
    expect(evaluated.strategy.totalReturn).toBeCloseTo(0.1);
    expect(evaluated.benchmark?.stats.totalReturn).toBeCloseTo(0.1);
  });
  it("bounds curve output and retains benchmark extrema independently of strategy prices", async () => {
    const timeline = Array.from({ length: 5000 }, (_, i) =>
      new Date(Date.UTC(2020, 0, 2 + i)).toISOString().slice(0, 10),
    );
    const points = timeline.map((date, i) => ({
      date,
      close: i === 37 ? 200 : i === 41 ? 50 : 100,
    }));
    const b = { ...benchmark(), points: [{ date: "2020-01-01", close: 100 }, ...points] };
    const e = await evaluateResult(
      storage,
      {
        ...result,
        equity: timeline.map((date) => ({
          date,
          equity: 100,
          cash: 100,
          drawdown: 0,
          holdings: 0,
        })),
      },
      100,
      timeline,
      "2020-01-01",
      b,
      signal(),
    );
    expect(e.curve.length).toBeLessThanOrEqual(3072);
    expect(e.curve.find((p) => p.date === timeline[37])!.benchmark).toBe(2);
    expect(e.curve.find((p) => p.date === timeline[41])!.benchmark).toBe(0.5);
    expect(e.benchmark!.stats.maxDrawdown).toBeCloseTo(-0.75, 12);
  });
  it("compounds complete periods across year/month boundaries, including the first session", async () => {
    const e = await evaluateResult(storage, result, 100, dates, baseline, benchmark(), signal());
    expect(e.months.map((p) => p.period)).toEqual(["2024-12", "2025-01", "2025-02"]);
    expect(e.months[0]!.strategy).toBeCloseTo(-0.01, 12);
    expect(e.months[1]!.strategy).toBeCloseTo(0.1, 12);
    expect(e.months[2]!.strategy).toBeCloseTo(0.1, 12);
    expect(e.years[1]!.strategy).toBeCloseTo(0.21, 12);
    expect(e.months.reduce((v, p) => v * (1 + p.strategy), 1) - 1).toBeCloseTo(
      e.strategy.totalReturn,
      12,
    );
    expect(e.benchmark!.stats.totalReturn).toBeCloseTo(0.21, 12);
    expect(e.benchmark!.excessReturn).toBeCloseTo(-0.0121, 12);
    expect(e.benchmark!.relativeReturn).toBeCloseTo(1.1979 / 1.21 - 1, 12);
    const returns = [0.1, -0.1, 0.1, 0.1],
      mean = returns.reduce((a, b) => a + b) / 4,
      variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / 3;
    expect(e.strategy.volatility).toBeCloseTo(Math.sqrt(variance * 252), 12);
    expect(e.strategy.sharpe).toBeCloseTo((mean / Math.sqrt(variance)) * Math.sqrt(252), 12);
    expect(e.strategy.maxDrawdown).toBeCloseTo(-0.1, 12);
  });
  it("scans complete chunks once instead of the lossy preview and rejects incomplete calendars", async () => {
    const refs = [0, 1].map(
        (i) => ({ id: `chunk-${i}`, type: "quant/jsg-chunk", storage: "opfs" }) as ArtifactRef,
      ),
      reads: string[] = [];
    const s = {
      ...storage,
      readChunk: async (ref: ArtifactRef) => {
        reads.push(ref.id);
        return {
          ...result,
          equity: ref.id === "chunk-0" ? result.equity.slice(0, 2) : result.equity.slice(2),
        };
      },
    };
    const e = await evaluateResult(
      s,
      {
        ...result,
        equity: [result.equity.at(-1)!],
        chunks: refs.map((ref) => ({ ref, start: "", end: "", orders: 0 })),
      },
      100,
      dates,
      baseline,
      undefined,
      signal(),
    );
    expect(reads).toEqual(["chunk-0", "chunk-1"]);
    expect(e.strategy.totalReturn).toBeCloseTo(0.1979, 12);
    await expect(
      evaluateResult(
        storage,
        { ...result, equity: result.equity.slice(1) },
        100,
        dates,
        baseline,
        undefined,
        signal(),
      ),
    ).rejects.toThrow(/日历/u);
    await expect(
      evaluateResult(
        storage,
        { ...result, equity: result.equity.slice(0, 3) },
        100,
        dates,
        baseline,
        undefined,
        signal(),
      ),
    ).rejects.toThrow(/缺少/u);
  });
  it("requires the precise baseline and every session without forward-filling", async () => {
    for (const index of [0, 2])
      await expect(
        evaluateResult(
          storage,
          result,
          100,
          dates,
          baseline,
          { ...benchmark(), points: benchmark().points.filter((_, i) => i !== index) },
          signal(),
        ),
      ).rejects.toThrow(/缺少交易日/u);
    expect(() =>
      parseBenchmarkCsv("date,close\n2024-12-27,100\n2024-12-27,110", "重复", "price"),
    ).toThrow(/递增/u);
    expect(() =>
      parseBenchmarkCsv("date,close\n2024-12-27,0\n2024-12-30,110", "零", "price"),
    ).toThrow();
    expect(() =>
      parseBenchmarkCsv("date,close\n2024-02-30,100\n2024-12-30,110", "日期", "price"),
    ).toThrow();
    expect(() => validateBenchmark({ ...benchmark(), kind: "unknown" })).toThrow();
    expect(
      parseBenchmarkCsv("date,close\n2024-12-27,100\n2024-12-30,110", "全收益", "total-return")
        .kind,
    ).toBe("total-return");
  });
  it("matches the independent Rust/WASM replay's daily summary metrics", async () => {
    const demo = demoResearch(),
      engine = new JsgBacktest(JSON.stringify(demo.manifest), JSON.stringify(DEFAULT_CONFIG));
    try {
      for (const file of demo.files.slice(1)) {
        engine.load_partition(new Uint8Array(await file.arrayBuffer()));
        while (engine.advance()) {}
      }
      const full = JSON.parse(engine.finish()),
        e = await evaluateResult(
          storage,
          full,
          DEFAULT_CONFIG.initialCapital,
          full.equity.map((p: { date: string }) => p.date),
          benchmarkBaseline(demo.manifest),
          undefined,
          signal(),
        );
      for (const key of [
        "days",
        "totalReturn",
        "annualizedReturn",
        "sharpe",
        "maxDrawdown",
      ] as const)
        expect(e.strategy[key]).toBeCloseTo(full.metrics[key], 10);
    } finally {
      engine.free();
    }
  });
  it("honors cancellation while reading complete result blocks", async () => {
    const controller = new AbortController();
    const s = {
      ...storage,
      readChunk: async () => {
        controller.abort();
        return result;
      },
    };
    await expect(
      evaluateResult(
        s,
        {
          ...result,
          chunks: [
            {
              ref: { id: "one", type: "quant/jsg-chunk", storage: "opfs" },
              start: "",
              end: "",
              orders: 0,
            },
          ],
        },
        100,
        dates,
        baseline,
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("queries ClickHouse with typed parameters and keeps credentials out of snapshots", async () => {
    const demo = demoResearch(),
      all = [
        benchmarkBaseline(demo.manifest),
        ...demo.manifest.calendar
          .filter((s) => s.date >= demo.manifest.startDate)
          .map((s) => dateText(s.date)),
      ];
    const original = globalThis.fetch;
    let requestUrl = "",
      body = "";
    globalThis.fetch = async (input, options) => {
      requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      body = typeof options?.body === "string" ? options.body : "";
      return new Response(all.map((date) => JSON.stringify({ date, close: 100 })).join("\n"));
    };
    try {
      const b = await fetchBenchmark(
        {
          url: "http://localhost:8123/",
          database: "stock_data",
          user: "default",
          password: "secret",
        },
        "sh.000300",
        demo.manifest,
        signal(),
      );
      expect(new URL(requestUrl).searchParams.get("param_code")).toBe("sh.000300");
      expect(body).toContain("{code:String}");
      expect(JSON.stringify(b)).not.toContain("secret");
      await expect(
        fetchBenchmark(
          { url: "http://localhost:8123/", database: "stock_data", user: "default", password: "" },
          "sh.000300';DROP",
          demo.manifest,
          signal(),
        ),
      ).rejects.toThrow(/代码/u);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("complete daily risk and profit statistics", () => {
  it("uses every daily return and first-day monetary P&L", async () => {
    const { strategy: s, benchmark: b } = await evaluateResult(
      storage,
      result,
      100,
      dates,
      baseline,
      benchmark(),
      signal(),
    );
    expect(s.downsideDeviation).toBeCloseTo(Math.sqrt((0.01 / 4) * 252), 12);
    expect(s.sortino).toBeCloseTo((0.05 * 252) / s.downsideDeviation, 10);
    expect(s.calmar).toBeCloseTo(s.annualizedReturn / 0.1, 8);
    expect(s.winningDays).toBe(3);
    expect(s.losingDays).toBe(1);
    expect(s.winRate).toBe(0.75);
    expect(s.profitFactor).toBeCloseTo(30.79 / 11, 12);
    expect(s.avgWin).toBeCloseTo(30.79 / 3, 12);
    expect(s.avgLoss).toBeCloseTo(-11, 12);
    expect(b!.stats.winningDays).toBe(3);
  });
  it.each([
    [100, 100, 100, 100],
    [110, 121, 133.1, 146.41],
  ])("exports undefined ratios as null for %j", async (...values) => {
    const r = { ...result, equity: result.equity.map((p, i) => ({ ...p, equity: values[i]! })) };
    const e = await evaluateResult(storage, r, 100, dates, baseline, undefined, signal());
    expect(e.strategy.sortino).toBeNull();
    expect(e.strategy.calmar).toBeNull();
    expect(e.strategy.profitFactor).toBeNull();
    expect(e.strategy.downsideDeviation).toBe(0);
    expect(JSON.parse(JSON.stringify(e)).strategy.sortino).toBeNull();
  });
  it("includes flat sessions in win rate and handles all losing sessions", async () => {
    const r = {
      ...result,
      equity: result.equity.map((p, i) => ({ ...p, equity: [100, 90, 90, 81][i]! })),
    };
    const { strategy: s } = await evaluateResult(
      storage,
      r,
      100,
      dates,
      baseline,
      undefined,
      signal(),
    );
    expect(s.winRate).toBe(0);
    expect(s.losingDays).toBe(2);
    expect(s.winningDays).toBe(0);
    expect(s.profitFactor).toBe(0);
    expect(s.avgWin).toBe(0);
    expect(s.avgLoss).toBe(-9.5);
    expect(s.sortino).toBeLessThan(0);
    expect(s.calmar).toBeLessThan(0);
  });
});
