import { artifactStore, ArtifactStoreTag, type ArtifactRef } from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { demoResearch } from "../src/jsg/demo";
import { DEFAULT_CONFIG, type JsgResult, type ResearchDataset } from "../src/jsg/model";
import {
  copyConfig,
  datasetKey,
  initialSession,
  isDraftChanged,
  MAX_RUNS,
  readRun,
  restoreSession,
  saveSession,
  sessionReducer,
  type ResearchSession,
  type SelectedRun,
} from "../src/jsg/session";
import { EMPTY_ORDER_FILTER, queryCurve, queryDecision, queryOrders } from "../src/jsg/result-data";
import { saveBenchmark, readBenchmark } from "../src/jsg/benchmark";
import { replayVersions } from "../src/jsg/versions";
import { draftChanges } from "../src/jsg/draft";
import { DEFAULT_CONNECTION } from "../src/jsg/clickhouse-http";
import type { ValidationResult } from "../src/jsg/validation";

const ref = (id: string, type = "quant/jsg-result"): ArtifactRef => ({
  id,
  type,
  storage: "opfs",
  format: "json",
});
it("persists completed validation with its frozen snapshot and preserves it after a canceled replacement", async () => {
  const services = await storage(),
    snapshot = selected();
  await putRun(services, snapshot);
  const resultRef = ref("study", "quant/jsg-study-result");
  const studyResult: ValidationResult = {
    version: 1,
    request: {
      mode: "cost",
      objective: "sharpe",
      axes: [],
      trainPercent: 70,
      trainDays: 60,
      testDays: 20,
    },
    training: [],
    folds: [],
    costs: [{ multiplier: 1, metrics: result().metrics }],
    costBase: copyConfig(DEFAULT_CONFIG),
  };
  await putJson(services, resultRef, studyResult);
  const state = ready(snapshot);
  state.study = {
    run: { ...snapshot.run, resultRef },
    dataset: snapshot.dataset,
    result: studyResult,
  };
  await saveSession(services, state);
  expect((await restoreSession(services))!.study).toEqual(state.study);
  const started = sessionReducer(state, {
    type: "started",
    operation: { id: "new", kind: "grid", label: "training", progress: 0 },
  });
  const canceled = sessionReducer(started, { type: "stopped", id: "new" });
  expect(canceled.study).toEqual(state.study);
  expect(canceled.selected).toEqual(state.selected);
});
function result(): JsgResult {
  return {
    metrics: {
      engine: "rust-wasm",
      model: "jsg-adjusted-v1",
      finalEquity: 1100000,
      totalReturn: 0.1,
      annualizedReturn: 0.2,
      sharpe: 1.4,
      maxDrawdown: -0.15,
      filledOrders: 0,
      rejectedOrders: 0,
      fees: 0,
      days: 156,
    },
    equity: [],
    orders: [],
    decisions: [],
    holdings: [],
    warnings: [],
    pendingOrders: 0,
  };
}
function selected(id = "first"): SelectedRun {
  const manifest = demoResearch().manifest;
  const dataset: ResearchDataset = {
    manifest,
    manifestRef: ref("manifest", "quant/jsg-manifest"),
    partitions: manifest.partitions.map((_, i) => ref(`input-${i}`, "quant/jsg-daily")),
  };
  const summary = result();
  return {
    dataset,
    result: summary,
    run: {
      id,
      createdAt: "2026-10-01T00:00:00Z",
      config: copyConfig(DEFAULT_CONFIG),
      dataset: { manifestRef: dataset.manifestRef, partitions: dataset.partitions },
      name: manifest.name,
      startDate: manifest.startDate,
      endDate: manifest.endDate,
      resultRef: ref(`result-${id}`),
      metrics: summary.metrics,
      durationMs: 30,
      cached: false,
    },
  };
}
function ready(snapshot = selected()): ResearchSession {
  return {
    ...initialSession(),
    ready: true,
    dataset: snapshot.dataset,
    selected: snapshot,
    runs: [snapshot.run],
  };
}

describe("research draft differences", () => {
  it("compares captured calendar requests rather than aligned trading dates, and ignores passwords", () => {
    const state = ready();
    state.selected!.dataset.snapshot = {
      createdAt: "2026-10-01T00:00:00Z",
      request: {
        url: DEFAULT_CONNECTION.url,
        database: "stock_data",
        user: "default",
        start: "2024-01-01",
        end: "2024-01-13",
        strictPit: false,
      },
    };
    state.selected!.run.startDate = 20240102;
    state.selected!.run.endDate = 20240112;
    const source = {
      kind: "clickhouse" as const,
      connection: { ...DEFAULT_CONNECTION, url: "http://localhost:8123", password: "session-only" },
      range: { start: "2024-01-01", end: "2024-01-13", strictPit: false, refresh: false },
    };
    expect(draftChanges(state, source)).toEqual([]);
    source.range.start = "2024-01-02";
    source.range.strictPit = true;
    expect(draftChanges(state, source).map((change) => change.label)).toEqual([
      "开始日期",
      "严格历史数据",
    ]);
  });
  it("shows actual field differences and preserves invalid drafts", () => {
    const state = ready();
    state.draft.stockCount = 6;
    state.draft.stopLoss = 0.1;
    const source = {
      kind: "local" as const,
      connection: DEFAULT_CONNECTION,
      range: { start: "", end: "", strictPit: false, refresh: false },
    };
    expect(draftChanges(state, source).map((change) => change.label)).toEqual([
      "目标股票数",
      "个股止损",
    ]);
    state.draft.stockCount = NaN;
    expect(draftChanges(state, source)[0]!.after).toBe("无效值");
    state.draft = copyConfig(state.selected!.run.config);
    expect(draftChanges(state, source)).toEqual([]);
  });
});
async function storage() {
  const store = new MemoryStore(),
    records = new Map<string, string>();
  const context = await Effect.runPromise(
    Effect.scoped(Layer.build(artifactStore({ opfs: store }))),
  );
  const artifacts = Context.get(context, ArtifactStoreTag);
  return {
    artifacts,
    metadata: {
      get: async (key: string) => records.get(key),
      set: async (key: string, value: string) => {
        records.set(key, value);
      },
    },
    records,
  };
}
async function putJson(
  services: Awaited<ReturnType<typeof storage>>,
  target: ArtifactRef,
  value: unknown,
) {
  await Effect.runPromise(
    services.artifacts.put(target, new TextEncoder().encode(JSON.stringify(value))),
  );
}
async function putRun(services: Awaited<ReturnType<typeof storage>>, snapshot: SelectedRun) {
  await putJson(services, snapshot.dataset.manifestRef, snapshot.dataset.manifest);
  for (const target of snapshot.dataset.partitions)
    await Effect.runPromise(services.artifacts.put(target, new Uint8Array([1])));
  await putJson(services, snapshot.run.resultRef, snapshot.result);
}

describe("immutable research runs", () => {
  it("persists a benchmark for its captured run while preserving a different selected result and draft", async () => {
    const services = await storage(),
      old = selected("old"),
      current = selected("current");
    await putRun(services, old);
    await putRun(services, current);
    const binding = await saveBenchmark(services, {
      version: 1,
      name: "固定基准",
      kind: "price",
      source: "fixture",
      acquiredAt: "2026-10-01T00:00:00Z",
      points: [
        { date: "2024-02-02", close: 100 },
        { date: "2024-02-05", close: 110 },
      ],
    });
    old.run.versions = replayVersions();
    const before = {
      ...ready(current),
      runs: [old.run, current.run],
      draft: { ...DEFAULT_CONFIG, stockCount: 6 },
    };
    const bound = sessionReducer(before, {
      type: "benchmark",
      runId: old.run.id,
      benchmark: binding,
    });
    expect(bound.selected!.run.id).toBe("current");
    expect(bound.selected!.run.benchmark).toBeUndefined();
    expect(bound.draft.stockCount).toBe(6);
    await saveSession(services, bound);
    const restored = await restoreSession(services);
    expect(restored!.runs[0]!.versions).toEqual(replayVersions());
    expect(
      (await readBenchmark(services, restored!.runs[0]!.benchmark!)).points.at(-1)!.close,
    ).toBe(110);
    const removed = sessionReducer({ ...before, ...restored }, { type: "benchmark", runId: "old" });
    expect(removed.runs[0]!.benchmark).toBeUndefined();
  });
  it("keeps the last result when parameters change, including invalid draft fields", () => {
    const before = ready(),
      after = sessionReducer(before, { type: "draft", patch: { stockCount: 6 } });
    expect(after.selected).toBe(before.selected);
    expect(after.selected?.run.config.stockCount).toBe(10);
    expect(isDraftChanged(after)).toBe(true);
    const invalid = sessionReducer(after, { type: "draft", patch: { initialCapital: NaN } });
    expect(invalid.selected).toBe(before.selected);
    expect(isDraftChanged(invalid)).toBe(true);
  });
  it("captures a run independently of edits made while it is executing", () => {
    const before = ready();
    const captured = copyConfig(before.draft),
      completed = selected("second");
    completed.run.config = captured;
    let state = sessionReducer(before, {
      type: "started",
      operation: { id: "second", kind: "backtest", label: "running", progress: 0 },
    });
    state = sessionReducer(state, {
      type: "draft",
      patch: { stockCount: 6, industryBlacklist: ["tech"] },
    });
    state = sessionReducer(state, { type: "finished", id: "second", selected: completed });
    expect(state.draft.stockCount).toBe(6);
    expect(state.selected?.run.config.stockCount).toBe(10);
    expect(state.selected?.run.config.industryBlacklist).toEqual(["ads"]);
    expect(isDraftChanged(state)).toBe(true);
  });
  it("retains data and results after cancellation/failure and ignores late task events", () => {
    const before = ready();
    const running = sessionReducer(before, {
      type: "started",
      operation: { id: "pending", kind: "load", label: "loading", progress: null },
    });
    for (const event of [
      { type: "stopped", id: "pending" },
      { type: "stopped", id: "pending", error: "network failure" },
    ] as const) {
      const stopped = sessionReducer(running, event);
      expect(stopped.dataset).toBe(before.dataset);
      expect(stopped.selected).toBe(before.selected);
      expect(
        sessionReducer(stopped, { type: "finished", id: "pending", selected: selected("late") }),
      ).toBe(stopped);
      expect(
        sessionReducer(stopped, { type: "progress", id: "pending", label: "late", progress: 1 }),
      ).toBe(stopped);
    }
  });
  it("limits history and selecting a previous run keeps the current editing draft", () => {
    let state = ready();
    for (let i = 0; i < 25; i++) {
      const snapshot = selected(`run-${i}`);
      state = sessionReducer(state, {
        type: "started",
        operation: { id: snapshot.run.id, kind: "backtest", label: "running", progress: 0 },
      });
      state = sessionReducer(state, { type: "finished", id: snapshot.run.id, selected: snapshot });
    }
    expect(state.runs).toHaveLength(MAX_RUNS);
    expect(state.runs[0]?.id).toBe("run-5");
    state = sessionReducer(state, { type: "draft", patch: { stockCount: 6 } });
    state = sessionReducer(state, { type: "selected", selected: selected("previous") });
    expect(state.draft.stockCount).toBe(6);
  });
  it("replaces a template completely and compares actual partition identities", () => {
    const before = sessionReducer(ready(), {
      type: "draft",
      patch: {
        executionModel: "jsg-raw-v2",
        participation: 0.2,
        fees: [{ from: 20200101, minimumCommission: 5, transferBps: 0, sellTaxBps: 0 }],
      },
    });
    const reset = sessionReducer(before, { type: "replace-draft", config: DEFAULT_CONFIG });
    expect(reset.draft).toEqual(DEFAULT_CONFIG);
    expect(reset.draft).not.toBe(DEFAULT_CONFIG);
    const dataset = selected().dataset,
      changed = {
        ...dataset,
        partitions: [ref("updated-partition"), ...dataset.partitions.slice(1)],
      };
    expect(datasetKey(dataset)).not.toBe(datasetKey(changed));
    expect(isDraftChanged({ ...ready(), dataset: changed })).toBe(true);
  });
  it("persists artifact references and restores the selected immutable snapshot separately from draft", async () => {
    const services = await storage(),
      snapshot = selected();
    await putRun(services, snapshot);
    const state = sessionReducer(ready(snapshot), { type: "draft", patch: { stockCount: 6 } });
    await saveSession(services, state);
    const saved = services.records.get("jsg-session-v2")!;
    expect(saved).not.toContain('"equity"');
    expect(saved).not.toContain('"password"');
    expect(saved).not.toContain('"calendar"');
    const restored = await restoreSession(services);
    expect(restored?.draft.stockCount).toBe(6);
    expect(restored?.selected?.run.config.stockCount).toBe(10);
    expect(restored?.selected?.result).toEqual(snapshot.result);
  });
  it("deduplicates dataset references across history while preserving each run's parameters", async () => {
    const services = await storage(),
      snapshot = selected();
    await putRun(services, snapshot);
    snapshot.run.snapshot = { createdAt: "2024-03-01T00:00:00Z" };
    snapshot.dataset.snapshot = snapshot.run.snapshot;
    const state = ready(snapshot);
    state.runs.push({
      ...snapshot.run,
      id: "second",
      snapshot: { createdAt: "2024-03-02T00:00:00Z" },
      config: { ...snapshot.run.config, stockCount: 6 },
      dataset: { ...snapshot.run.dataset, partitions: [...snapshot.run.dataset.partitions] },
    });
    await saveSession(services, state);
    const saved = JSON.parse(services.records.get("jsg-session-v2")!);
    expect(saved.datasets).toHaveLength(1);
    expect(saved.runs.map((run: { dataset: number }) => run.dataset)).toEqual([0, 0]);
    const restored = await restoreSession(services);
    expect(restored?.runs.map((run) => run.config.stockCount)).toEqual([10, 6]);
    expect(restored?.selected?.run.config.stockCount).toBe(10);
    expect(restored?.selected?.dataset.snapshot?.createdAt).toBe("2024-03-01T00:00:00Z");
    expect((await readRun(services, restored!.runs[1]!)).dataset.snapshot?.createdAt).toBe(
      "2024-03-02T00:00:00Z",
    );
  });
  it("restores direct-reference v2 sessions as well as the compact dataset catalog", async () => {
    const services = await storage(),
      snapshot = selected();
    await putRun(services, snapshot);
    services.records.set(
      "jsg-session-v2",
      JSON.stringify({
        version: 2,
        dataset: snapshot.run.dataset,
        draft: { ...DEFAULT_CONFIG, stockCount: 6 },
        runs: [snapshot.run],
        selectedId: snapshot.run.id,
      }),
    );
    const restored = await restoreSession(services);
    expect(restored?.draft.stockCount).toBe(6);
    expect(restored?.selected?.run.id).toBe(snapshot.run.id);
  });
  it("migrates a previously saved v1 project without recomputing its result", async () => {
    const services = await storage(),
      snapshot = selected();
    await putRun(services, snapshot);
    services.records.set(
      "jsg-project-v1",
      JSON.stringify({
        dataset: snapshot.run.dataset,
        config: snapshot.run.config,
        resultRef: snapshot.run.resultRef,
      }),
    );
    const restored = await restoreSession(services);
    expect(restored?.runs).toHaveLength(1);
    expect(restored?.selected?.result).toEqual(snapshot.result);
    expect(restored?.draft).toEqual(snapshot.run.config);
    await saveSession(services, { ...initialSession(), ...restored, ready: true });
    expect(services.records.has("jsg-session-v2")).toBe(true);
  });
  it("reports missing artifacts rather than displaying a partial historical run", async () => {
    const services = await storage(),
      snapshot = selected();
    await putRun(services, snapshot);
    await Effect.runPromise(services.artifacts.delete(snapshot.dataset.partitions[0]!));
    await expect(readRun(services, snapshot.run)).rejects.toThrow("已被移除");
  });
});

describe("bounded complete-result queries", () => {
  const order = (
    i: number,
    date = "2024-01-02",
    quantity = 100,
    status = "filled",
  ): JsgResult["orders"][number] => ({
    code: `sh.${String(i).padStart(6, "0")}`,
    date,
    signalDate: date,
    side: i % 2 ? "sell" : "buy",
    timing: "close",
    reason: "rebalance",
    requested: 100,
    quantity,
    price: 10,
    fee: 1,
    status,
  });
  const signal = () => new AbortController().signal;
  it("filters all chunks, orders newest first and retains only one page beyond the preview", async () => {
    const services = await storage(),
      summary = result();
    const first = Array.from({ length: 70 }, (_, i) => order(i)),
      second = Array.from({ length: 80 }, (_, i) => order(i + 70, "2024-02-01"));
    const a = ref("chunk-a"),
      b = ref("chunk-b");
    await putJson(services, a, { orders: first, equity: [], decisions: [] });
    await putJson(services, b, { orders: second, equity: [], decisions: [] });
    summary.orders = second.slice(-2);
    summary.chunks = [
      { ref: a, start: "2024-01-02", end: "2024-01-02", orders: 70 },
      { ref: b, start: "2024-02-01", end: "2024-02-01", orders: 80 },
    ];
    const page = await queryOrders(services, summary, EMPTY_ORDER_FILTER, 50, signal());
    expect(page.count).toBe(150);
    expect(page.rows).toHaveLength(50);
    expect(page.rows[0]?.code).toBe("sh.000099");
    const search = await queryOrders(
      services,
      summary,
      { ...EMPTY_ORDER_FILTER, code: "000001", to: "2024-01-31" },
      0,
      signal(),
    );
    expect(search.rows).toEqual([first[1]]);
  });
  it("uses chunk counts to skip unrelated pages without rereading every order file", async () => {
    const services = await storage(),
      summary = result();
    summary.chunks = [];
    for (let i = 0; i < 10; i++) {
      const target = ref(`page-${i}`),
        date = `2024-01-${String(i + 1).padStart(2, "0")}`;
      await putJson(services, target, {
        orders: Array.from({ length: 50 }, (_, n) => order(i * 50 + n, date)),
        equity: [],
        decisions: [],
      });
      summary.chunks.push({ ref: target, start: date, end: date, orders: 50 });
    }
    let reads = 0;
    const counted = {
      artifacts: {
        ...services.artifacts,
        get: (target: ArtifactRef) => {
          reads++;
          return services.artifacts.get(target);
        },
      },
    };
    const page = await queryOrders(counted, summary, EMPTY_ORDER_FILTER, 150, signal());
    expect(page.count).toBe(500);
    expect(page.rows).toHaveLength(50);
    expect(reads).toBe(1);
    expect(page.rows[0]?.code).toBe("sh.000349");
  });
  it("includes partial fills as executed orders and distinguishes concrete rejection reasons", async () => {
    const services = await storage(),
      summary = result();
    summary.orders = [
      order(1),
      order(2, undefined, 50, "partial"),
      order(3, undefined, 0, "limit-up"),
      order(4, undefined, 0, "suspended"),
    ];
    expect(
      (
        await queryOrders(
          services,
          summary,
          { ...EMPTY_ORDER_FILTER, status: "filled" },
          0,
          signal(),
        )
      ).count,
    ).toBe(2);
    expect(
      (
        await queryOrders(
          services,
          summary,
          { ...EMPTY_ORDER_FILTER, status: "rejected" },
          0,
          signal(),
        )
      ).count,
    ).toBe(2);
    expect(
      (
        await queryOrders(
          services,
          summary,
          { ...EMPTY_ORDER_FILTER, status: "partial" },
          0,
          signal(),
        )
      ).count,
    ).toBe(1);
  });
  it("uses order summaries for filtered pagination and skips impossible code matches", async () => {
    const services = await storage(),
      summary = result();
    const a = ref("indexed-old"),
      b = ref("indexed-new");
    const first = Array.from({ length: 60 }, (_, n) => ({
      ...order(n, "2024-01-02", 50, "partial"),
      side: "buy" as const,
    }));
    const second = Array.from({ length: 60 }, (_, n) => ({
      ...order(n + 60, "2024-02-01", 50, "partial"),
      side: "buy" as const,
    }));
    for (const [target, orders] of [
      [a, first],
      [b, second],
    ] as const)
      await putJson(services, target, { orders, equity: [], decisions: [] });
    summary.chunks = [
      {
        ref: a,
        start: "2024-01-02",
        end: "2024-01-02",
        orders: 60,
        codes: first.map((o) => o.code),
        orderStats: [{ side: "buy", status: "partial", filled: true, count: 60 }],
      },
      {
        ref: b,
        start: "2024-02-01",
        end: "2024-02-01",
        orders: 60,
        codes: second.map((o) => o.code),
        orderStats: [{ side: "buy", status: "partial", filled: true, count: 60 }],
      },
    ];
    let reads = 0;
    const counted = {
      artifacts: {
        get: (target: ArtifactRef) => {
          reads++;
          return services.artifacts.get(target);
        },
      },
    };
    const page = await queryOrders(
      counted,
      summary,
      { ...EMPTY_ORDER_FILTER, side: "buy", status: "filled" },
      60,
      signal(),
    );
    expect(page.count).toBe(120);
    expect(page.rows).toHaveLength(50);
    expect(reads).toBe(1);
    reads = 0;
    expect(
      (
        await queryOrders(
          counted,
          summary,
          { ...EMPTY_ORDER_FILTER, status: "rejected" },
          0,
          signal(),
        )
      ).count,
    ).toBe(0);
    expect(
      (await queryOrders(counted, summary, { ...EMPTY_ORDER_FILTER, code: "missing" }, 0, signal()))
        .count,
    ).toBe(0);
    expect(reads).toBe(0);
    const partial = await queryOrders(
      counted,
      summary,
      { ...EMPTY_ORDER_FILTER, from: "2024-02-01", to: "2024-02-01", status: "partial" },
      0,
      signal(),
    );
    expect(partial.count).toBe(60);
    expect(partial.rows).toHaveLength(50);
  });
  it("reads an exact historical decision instead of falling back to the latest preview", async () => {
    const services = await storage(),
      summary = result(),
      target = ref("decisions");
    const decision = {
      date: "2024-01-02",
      topIndustry: "tech",
      breadth: 0.6,
      targets: ["sh.000001"],
    };
    await putJson(services, target, { decisions: [decision], equity: [], orders: [] });
    summary.chunks = [{ ref: target, start: decision.date, end: decision.date, orders: 0 }];
    expect(await queryDecision(services, summary, decision.date, signal())).toEqual(decision);
    expect(await queryDecision(services, summary, "2024-02-01", signal())).toBeUndefined();
  });
  it("caps long curves while preserving endpoints, equity extremes and drawdown extremes", async () => {
    const services = await storage(),
      summary = result();
    summary.equity = Array.from({ length: 20000 }, (_, i) => ({
      date: new Date(Date.UTC(1950, 0, 1 + i)).toISOString().slice(0, 10),
      equity: 1000 + (i % 11),
      drawdown: -0.01,
      cash: 500,
      holdings: 2,
    }));
    summary.equity[8192]!.equity = 100000;
    summary.equity[8193]!.equity = 1;
    summary.equity[10001]!.drawdown = -0.9;
    const sampled = await queryCurve(
      services,
      summary,
      summary.equity[0]!.date,
      summary.equity.at(-1)!.date,
      signal(),
    );
    expect(sampled.length).toBeLessThanOrEqual(4096);
    expect(sampled[0]).toEqual(summary.equity[0]);
    expect(sampled.at(-1)).toEqual(summary.equity.at(-1));
    expect(sampled.some((p) => p.equity === 100000)).toBe(true);
    expect(sampled.some((p) => p.equity === 1)).toBe(true);
    expect(sampled.some((p) => p.drawdown === -0.9)).toBe(true);
    expect(
      await queryCurve(
        services,
        summary,
        summary.equity[8192]!.date,
        summary.equity[8192]!.date,
        signal(),
      ),
    ).toEqual([summary.equity[8192]]);
  });
  it("rejects canceled queries and incomplete result chunks", async () => {
    const services = await storage(),
      summary = result(),
      abort = new AbortController();
    abort.abort();
    await expect(
      queryOrders(services, summary, EMPTY_ORDER_FILTER, 0, abort.signal),
    ).rejects.toThrow();
    summary.chunks = [{ ref: ref("missing"), start: "2024-01-02", end: "2024-01-02", orders: 1 }];
    await expect(queryOrders(services, summary, EMPTY_ORDER_FILTER, 0, signal())).rejects.toThrow();
  });
});
