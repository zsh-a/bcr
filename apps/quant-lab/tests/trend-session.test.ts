import type { ArtifactRef, RuntimeMetadata } from "@bcr/core";
import { DAY, type BinanceDataset } from "@bcr/market-data/binance/model";
import type { TrendConfig, TrendRun } from "@bcr/quant-core/trend";
import { describe, expect, it, vi } from "vitest";
import {
  createTrendSessionState,
  createTrendSessionStore,
  decodeTrendSession,
  TREND_SESSION_KEY,
} from "../src/trend/session/store";

function fixture() {
  const state = createTrendSessionState();
  const start = Date.UTC(2024, 0, 1);
  const ref = (id: string): ArtifactRef => ({
    id,
    hash: "a".repeat(64),
    type: "test",
    format: "json",
    storage: "opfs",
  });
  const source = "https://data.binance.vision/data/futures/um/history.zip";
  const dataset: BinanceDataset = {
    manifestRef: ref("manifest"),
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
    resultRef: ref("result"),
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
    expect(restored.state.config.version).toBe(5);
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
