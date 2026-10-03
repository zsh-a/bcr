import type { ArtifactRef, RuntimeMetadata } from "@bcr/core";
import { DAY, type BinanceDataset } from "@bcr/market-data/binance/model";
import type { TrendConfig, TrendRun } from "@bcr/quant-core/trend";
import { describe, expect, it, vi } from "vitest";
import {
  RECORDED_V6,
  RECORDED_V7,
  RECORDED_V8,
  RECORDED_V9,
} from "../../../packages/quant-core/tests/fixtures/trend-recorded";
import {
  createTrendSessionState,
  createTrendSessionStore,
  decodeTrendSession,
  TREND_SESSION_KEY,
} from "../src/trend/session/store";

function fixture() {
  const state = createTrendSessionState();
  const start = Date.UTC(2024, 0, 1);
  const ref = (id: string, type = "test"): ArtifactRef => ({
    id,
    hash: "a".repeat(64),
    type,
    format: "json",
    storage: "opfs",
  });
  const source = "https://data.binance.vision/data/futures/um/history.zip";
  const dataset: BinanceDataset = {
    manifestRef: ref("manifest", "market/binance-manifest"),
    manifest: {
      version: 1,
      provider: "binance-public-data",
      market: "usdt-perpetual",
      interval: "1m",
      symbol: "BTCUSDT",
      startTime: start,
      endTime: start + DAY,
      warmupStart: start - DAY,
      rows: 2880,
      funding: ref("funding"),
      fundingPrice: "minute-mark-open",
      createdAt: "2024-02-01T00:00:00Z",
      fundingSources: [{ url: source, checksum: "a".repeat(64) }],
      partitions: [
        {
          from: start - DAY,
          to: start + DAY,
          rows: 2880,
          candles: ref("candles"),
          marks: ref("marks"),
          source,
          markSource: source,
          checksum: "a".repeat(64),
          markChecksum: "a".repeat(64),
        },
      ],
    },
  };
  const run: TrendRun = {
    id: "saved-run",
    createdAt: "2024-02-01T00:00:00Z",
    config: structuredClone(state.config),
    dataset,
    resultRef: ref("result", "quant/trend-result"),
    durationMs: 10,
    cached: false,
    metrics: {
      finalEquity: 10000,
      totalReturn: 0,
      maxDrawdown: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      profitFactor: null,
      meanR: null,
      fees: 0,
      funding: 0,
      longestLossStreak: 0,
      rejectedSignals: 0,
      fundingEvents: 0,
      rows: 2880,
    },
  };
  return {
    ...state,
    request: { symbol: "BTCUSDT", start: "2024-01-01", end: "2024-01-01" },
    dataset,
    runs: [run],
    selected: run.id,
  };
}

describe("trend session persistence", () => {
  it("migrates a v9 structured draft without changing frozen runs and preserves explicit v10 choices", () => {
    const state = fixture();
    const old = structuredClone(RECORDED_V9);
    const raw = JSON.stringify({
      ...state,
      config: old,
      runs: [{ ...state.runs[0], config: old }],
    });
    const restored = decodeTrendSession(raw);
    expect(restored.state.config.strategy.structuredPullback).toEqual({
      ...old.strategy.structuredPullback,
      confirmation: "before-breakout",
      keyRole: "pullback-retest",
    });
    expect(restored.state.config.version).toBe(10);
    expect(restored.state.runs).toEqual(JSON.parse(raw).runs);
    restored.state.config.strategy.structuredPullback!.confirmation = "signal-close";
    restored.state.config.strategy.structuredPullback!.keyRole = "impulse-context";
    const next = decodeTrendSession(JSON.stringify(restored.state));
    expect(next.state.config).toEqual(restored.state.config);
    expect(next.state.runs).toEqual(restored.state.runs);
  });
  it("upgrades a v8 policy draft while preserving its exact historical run and source", () => {
    const state = fixture();
    const old = structuredClone(RECORDED_V8);
    const raw = JSON.stringify({
      ...state,
      config: old,
      runs: [{ ...state.runs[0], config: old }],
    });
    const restored = decodeTrendSession(raw);
    expect(restored.state.config).toEqual({ ...old, version: 10 });
    expect(restored.state.runs).toEqual(JSON.parse(raw).runs);
    expect(restored.state.dataset).toEqual(state.dataset);
    expect(restored.state.selected).toBe(state.selected);
    expect(restored.notice).toContain("参数已升级");
    expect(restored.state.config.strategy.filter).toBe("none");
  });
  it("migrates only the v7 draft and round-trips v8 policies without changing historical runs", async () => {
    const state = fixture();
    const old = structuredClone(RECORDED_V7);
    let raw = JSON.stringify({ ...state, config: old, runs: [{ ...state.runs[0], config: old }] });
    const metadata = {
      get: vi.fn(async () => raw),
      set: vi.fn(async (_key: string, value: string) => {
        raw = value;
      }),
    } as unknown as RuntimeMetadata;
    const store = createTrendSessionStore(metadata);
    const restored = await store.restore();
    expect(restored.state.config).toEqual({ ...old, version: 10 });
    expect(restored.state.runs[0]!.config).toEqual(old);
    const next = {
      ...restored.state,
      config: {
        ...state.config,
        strategy: {
          ...state.config.strategy,
          channelExitBars: 40,
          breakoutReentry: "episode" as const,
        },
      },
    };
    await store.save(next);
    const reloaded = await createTrendSessionStore(metadata).restore();
    expect(reloaded.state.config).toEqual(next.config);
    expect(reloaded.state.runs).toEqual(restored.state.runs);
    expect(reloaded.state.dataset).toEqual(state.dataset);
    expect(reloaded.state.selected).toBe(state.selected);
  });
  it("migrates a v6 KDJ draft without changing its historical run, source or staged parameters", () => {
    const state = fixture();
    const old = structuredClone(RECORDED_V6);
    const raw = JSON.stringify({
      ...state,
      config: old,
      runs: [{ ...state.runs[0], config: old }],
    });
    const restored = decodeTrendSession(raw);
    expect(restored.state.config).toEqual({ ...old, version: 10 });
    expect(restored.state.runs).toEqual(JSON.parse(raw).runs);
    expect(restored.state.dataset).toEqual(state.dataset);
    expect(restored.state.selected).toBe(state.selected);
    expect(restored.notice).toContain("参数已升级");
  });
  it("migrates only the v5 editable draft and keeps its selected run and parameters frozen", () => {
    const state = fixture();
    const old = {
      ...state.config,
      version: 5,
      strategy: {
        ...state.config.strategy,
        filter: "ema",
        management: "atr",
        tradeMinutes: 1,
        maxCostAtr: 0.7,
      },
      risk: { ...state.config.risk, riskPct: 0.002 },
    };
    const raw = JSON.stringify({
      ...state,
      config: old,
      runs: [{ ...state.runs[0]!, config: old }],
    });
    const restored = decodeTrendSession(raw);
    expect(restored.state.config).toEqual({ ...old, version: 10 });
    expect(restored.state.runs).toEqual(JSON.parse(raw).runs);
    expect(restored.state.selected).toBe(state.selected);
    expect(restored.state.dataset).toEqual(state.dataset);
    expect(restored.notice).toContain("参数已升级");
    expect(restored.state.config.strategy.staged).toBeUndefined();
  });
  it("rejects damaged run envelopes and references before opening the persistence gate", async () => {
    const corruptions: ((state: ReturnType<typeof fixture>) => void)[] = [
      (state) => Reflect.deleteProperty(state.runs[0]!, "metrics"),
      (state) => Object.assign(state.runs[0]!.metrics, { totalReturn: "12%" }),
      (state) => Object.assign(state.runs[0]!.metrics, { finalEquity: null }),
      (state) => Reflect.deleteProperty(state.runs[0]!.metrics, "profitFactor"),
      (state) => Object.assign(state.runs[0]!.metrics, { trades: -1 }),
      (state) =>
        Object.assign(state.runs[0]!.metrics, {
          context: { evaluated: 1, allowed: 0, rejected: 1, reasons: { range: "1" } },
        }),
      (state) => Reflect.deleteProperty(state.runs[0]!, "resultRef"),
      (state) => Object.assign(state.runs[0]!.resultRef, { id: "" }),
      (state) => Object.assign(state.runs[0]!.resultRef, { storage: "unknown" }),
      (state) => Object.assign(state.runs[0]!.resultRef, { hash: "broken" }),
      (state) => Object.assign(state.runs[0]!.resultRef, { type: "quant/jsg-result" }),
      (state) => Object.assign(state.runs[0]!.resultRef, { format: "csv" }),
      (state) => Reflect.deleteProperty(state.runs[0]!.dataset, "manifestRef"),
      (state) => Object.assign(state.runs[0]!.dataset.manifestRef, { id: "" }),
      (state) => Object.assign(state.dataset.manifest.funding, { storage: null }),
      (state) => Object.assign(state.dataset.manifest.partitions[0]!.candles, { type: "" }),
      (state) => Reflect.deleteProperty(state.runs[0]!, "durationMs"),
      (state) => Object.assign(state.runs[0]!, { createdAt: "invalid", cached: "true" }),
      (state) => state.runs.push(structuredClone(state.runs[0]!)),
      (state) => Object.assign(state, { selected: "missing-run" }),
    ];
    for (const corrupt of corruptions) {
      const state = fixture();
      corrupt(state);
      const raw = JSON.stringify(state);
      let stored = raw;
      const metadata = {
        get: async () => stored,
        set: vi.fn(async (_key: string, value: string) => {
          stored = value;
        }),
      };
      const store = createTrendSessionStore(metadata);
      await expect(store.restore()).rejects.toThrow();
      await expect(store.save(createTrendSessionState())).rejects.toThrow("阻止覆盖");
      expect(metadata.set).not.toHaveBeenCalled();
      expect(stored).toBe(raw);
    }
  });

  it("keeps old configs and absent optional fields byte-for-byte in historical records", () => {
    for (const version of [2, 3, 4, 5]) {
      const state = fixture();
      const run = state.runs[0]!;
      const config = structuredClone(state.config);
      Object.assign(config, { version });
      Object.assign(config.strategy, { filter: "none" });
      if (version < 5) Reflect.deleteProperty(config.strategy, "maxCostAtr");
      if (version < 4) Reflect.deleteProperty(config.strategy, "management");
      Object.assign(run, { config });
      for (const ref of [run.resultRef, run.dataset.manifestRef, run.dataset.manifest.funding]) {
        Reflect.deleteProperty(ref, "hash");
        Reflect.deleteProperty(ref, "format");
      }
      // Older session indexes may still contain their evaluation payload. Preserve it unchanged.
      Object.assign(run.metrics, { evaluation: { version: 1, note: "legacy payload" } });
      const before = JSON.stringify(run);
      const decoded = decodeTrendSession(JSON.stringify(state));
      expect(JSON.stringify(decoded.state.runs[0])).toBe(before);
      expect(decoded.state.runs[0]!.metrics.context).toBeUndefined();
    }
    const state = fixture();
    Object.assign(state.runs[0]!, {
      config: {
        entry: "breakout",
        direction: "long",
        initialCapital: 10000,
        tickSize: 0.1,
        quantityStep: 0.001,
        feeBps: 5,
        slippageBps: 2,
        trendMinutes: 5,
        fastEma: 20,
        slowEma: 60,
      },
    });
    const before = JSON.stringify(state.runs);
    expect(JSON.stringify(decodeTrendSession(JSON.stringify(state)).state.runs)).toBe(before);
  });

  it("blocks writes before successful restoration and preserves malformed stored history", async () => {
    const invalid = [
      "{broken",
      JSON.stringify({ ...fixture(), runs: [{ id: "old", config: {} }] }),
      JSON.stringify({ ...fixture(), dataset: { manifest: {} } }),
      JSON.stringify({ ...fixture(), draftDefaultsVersion: 2 }),
      JSON.stringify({
        ...fixture(),
        draftDefaultsVersion: undefined,
        config: {
          ...fixture().config,
          strategy: { ...fixture().config.strategy, entry: "breakout", filter: "none" },
        },
        runs: [{ id: "unreadable-history", config: {} }],
      }),
    ];
    for (const raw of invalid) {
      let stored = raw;
      const metadata = {
        get: vi.fn(async () => stored),
        set: vi.fn(async (_key: string, text: string) => {
          stored = text;
        }),
      };
      const store = createTrendSessionStore(metadata);
      await expect(store.save(createTrendSessionState())).rejects.toThrow("阻止覆盖");
      await expect(store.restore()).rejects.toThrow();
      await expect(store.save(createTrendSessionState())).rejects.toThrow("阻止覆盖");
      expect(metadata.set).not.toHaveBeenCalled();
      expect(stored).toBe(raw);
    }
  });

  it("treats unavailable or failed metadata reads as restoration failure", async () => {
    const set = vi.fn(async () => undefined);
    for (const metadata of [
      undefined,
      {
        get: async () => {
          throw new Error("read failed");
        },
        set,
      },
    ]) {
      const store = createTrendSessionStore(metadata);
      await expect(store.restore()).rejects.toThrow();
      await expect(store.save(createTrendSessionState())).rejects.toThrow("阻止覆盖");
    }
    expect(set).not.toHaveBeenCalled();
  });

  it("recovers invalid drafts while preserving all frozen runs and the selected record", () => {
    const original = fixture();
    const raw = JSON.stringify({ ...original, request: {}, config: { version: 999 } });
    const restored = decodeTrendSession(raw);
    expect(restored.state.runs).toEqual(original.runs);
    expect(restored.state.selected).toBe(original.selected);
    expect(restored.state.dataset).toEqual(original.dataset);
    expect(restored.state.config.version).toBe(10);
    expect(restored.notice).toContain("历史记录保持原样");
    expect(JSON.parse(raw).config.version).toBe(999);
  });

  it("migrates an unmarked breakout draft once without changing other parameters or history", () => {
    const original = fixture();
    const config: TrendConfig = {
      ...original.config,
      strategy: {
        ...original.config.strategy,
        entry: "breakout",
        filter: "none",
        direction: "both",
        breakoutBars: 37,
        stopAtr: 3,
        maxCostAtr: 0.75,
      },
      execution: { ...original.config.execution, feeBps: 7 },
      risk: { ...original.config.risk, riskPct: 0.007 },
    };
    const legacy = {
      ...original,
      draftDefaultsVersion: undefined,
      config,
      runs: [{ ...original.runs[0]!, config: structuredClone(config) }],
    };
    const raw = JSON.stringify(legacy);
    const restored = decodeTrendSession(raw);
    expect(restored.state).toEqual({
      ...legacy,
      draftDefaultsVersion: 1,
      config: { ...config, strategy: { ...config.strategy, filter: "background" } },
    });
    expect(restored.notice).toContain("默认启用背景过滤");
    expect(restored.notice).toContain("历史运行保持原样");
    expect(JSON.parse(raw).config.strategy.filter).toBe("none");
    expect(JSON.parse(raw).runs[0].config.strategy.filter).toBe("none");
  });

  it.each([
    ["breakout", "ema"],
    ["breakout", "background"],
    ["pullback", "none"],
    ["pullback", "ema"],
    ["pullback", "background"],
  ] as const)("preserves an unmarked %s/%s draft", (entry, filter) => {
    const original = fixture();
    const config: TrendConfig = {
      ...original.config,
      strategy: {
        ...original.config.strategy,
        entry,
        filter,
        management: entry === "pullback" ? "atr" : original.config.strategy.management,
      },
    };
    const restored = decodeTrendSession(
      JSON.stringify({
        ...original,
        draftDefaultsVersion: undefined,
        config,
      }),
    );
    expect(restored.state.config).toEqual(config);
    expect(restored.state.draftDefaultsVersion).toBe(1);
    expect(restored.notice).toBe("");
  });

  it("persists the migration marker and respects a later explicit choice of no filter", async () => {
    const original = fixture();
    let stored = JSON.stringify({
      ...original,
      draftDefaultsVersion: undefined,
      config: { ...original.config, strategy: { ...original.config.strategy, filter: "none" } },
    });
    const metadata = {
      get: async () => stored,
      set: vi.fn(async (_key: string, text: string) => {
        stored = text;
      }),
    };
    const store = createTrendSessionStore(metadata);
    const { state } = await store.restore();
    expect(state.config.strategy.filter).toBe("background");
    expect(metadata.set).not.toHaveBeenCalled();
    await store.save(state);
    expect(JSON.parse(stored).draftDefaultsVersion).toBe(1);
    await store.save({
      ...state,
      config: { ...state.config, strategy: { ...state.config.strategy, filter: "none" } },
    });
    const reloaded = await createTrendSessionStore(metadata).restore();
    expect(reloaded.state.config.strategy.filter).toBe("none");
    expect(reloaded.state.runs).toEqual(original.runs);
    expect(reloaded.state.selected).toBe(original.selected);
    expect(reloaded.state.dataset).toEqual(original.dataset);
    expect(reloaded.notice).toBe("");
  });

  it("initializes an empty store and deduplicates acknowledged snapshots", async () => {
    const metadata = { get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) };
    const store = createTrendSessionStore(metadata);
    const restored = await store.restore();
    expect(restored.state.runs).toEqual([]);
    expect(restored.state.draftDefaultsVersion).toBe(1);
    await store.save(restored.state);
    await store.save(restored.state);
    expect(metadata.set).toHaveBeenCalledExactlyOnceWith(
      TREND_SESSION_KEY,
      JSON.stringify(restored.state),
    );
    await store.restore();
    expect(metadata.get).toHaveBeenCalledTimes(1);
  });

  it("reports a failed write without poisoning later queued snapshots or mutating their history", async () => {
    const initial = fixture();
    let stored = JSON.stringify(initial);
    let rejectFirst!: (reason: Error) => void;
    const gate = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const set = vi
      .fn<RuntimeMetadata["set"]>()
      .mockImplementationOnce(async () => {
        await gate;
      })
      .mockImplementation(async (_key, text) => {
        stored = text;
      });
    const store = createTrendSessionStore({ get: async () => stored, set });
    await store.restore();
    const firstState = {
      ...initial,
      config: { ...initial.config, execution: { ...initial.config.execution, feeBps: 6 } },
    };
    const secondState = {
      ...initial,
      config: { ...initial.config, execution: { ...initial.config.execution, feeBps: 7 } },
    };
    const first = expect(store.save(firstState)).rejects.toThrow("研究保存失败：quota exceeded");
    const second = store.save(secondState);
    secondState.config.execution.feeBps = 99;
    rejectFirst(new Error("quota exceeded"));
    await first;
    await second;
    expect(set).toHaveBeenCalledTimes(2);
    expect(JSON.parse(stored).config.execution.feeBps).toBe(7);
    expect(JSON.parse(stored).runs).toEqual(initial.runs);
    await store.save(firstState);
    expect(JSON.parse(stored).config.execution.feeBps).toBe(6);
  });

  it("cancels a queued commit before writing while keeping the queue usable", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const set = vi
      .fn<RuntimeMetadata["set"]>()
      .mockImplementationOnce(async () => gate)
      .mockResolvedValue(undefined);
    const store = createTrendSessionStore({ get: async () => undefined, set });
    const { state } = await store.restore();
    const first = store.save(state);
    const abort = new AbortController();
    const changed = { ...state, selected: "cancelled" };
    const cancelled = expect(store.save(changed, abort.signal)).rejects.toThrow();
    abort.abort();
    release();
    await first;
    await cancelled;
    expect(set).toHaveBeenCalledTimes(1);
    await store.save({ ...state, selected: "next" });
    expect(set).toHaveBeenCalledTimes(2);
  });
});
