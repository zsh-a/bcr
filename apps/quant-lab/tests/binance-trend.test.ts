import { artifactPath, type ComputeTask } from "@bcr/core";
import {
  DAY,
  MINUTE,
  validateBinanceManifest,
  type BinanceManifest,
} from "@bcr/market-data/binance/model";
import {
  DEFAULT_TREND_CONFIG,
  withTradingPeriod,
  type TrendChartData,
  type TrendChunk,
} from "@bcr/quant-core/trend";
import { createArtifactIO } from "@bcr/runtime-worker";
import { MemoryStore } from "@bcr/storage-opfs";
import { describe, expect, it } from "vitest";
import { binanceHistoryHandler } from "../src/trend/execution/data";
import { trendChartHandler } from "../src/trend/execution/chart";
import { trendHandler, type TrendEngine } from "../src/trend/execution/compute";

const start = Date.UTC(2024, 0, 1);
function csv(from: number, to: number) {
  return Array.from(
    { length: (to - from) / MINUTE },
    (_, i) => `${from + i * MINUTE},100,101,99,100,1,${from + (i + 1) * MINUTE - 1},0,1,0,0,0`,
  ).join("\n");
}
function setup(abort = new AbortController()) {
  const store = new MemoryStore(),
    io = createArtifactIO(store, "opfs");
  const task: ComputeTask = {
    id: "binance-test",
    runtime: "wasm",
    operation: "market.binance.history",
    inputs: [],
    outputs: [],
    config: { request: { symbol: "BTCUSDT", start: "2024-01-01", end: "2024-01-01" } },
  };
  const ctx = { signal: abort.signal, progress: () => undefined, emitChunk: () => undefined };
  const urls: string[] = [];
  const download = async (url: string) => {
    urls.push(url);
    const from = Date.parse(`${url.match(/(\d{4}-\d{2}-\d{2})\.zip$/u)?.[1]}T00:00:00Z`);
    const data = url.includes("fundingRate")
      ? "calc_time,funding_interval_hours,last_funding_rate\n" +
        Array.from({ length: 6 }, (_, i) => `${start + i * 8 * 60 * MINUTE + 1},8,.0001`).join("\n")
      : csv(from, from + DAY);
    const checksum = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data))),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { url, csv: data, checksum };
  };
  return { store, io, task, ctx, download, urls };
}
describe("Binance worker pipeline", () => {
  it("skips prior result artifacts indexed as having no price overlays", async () => {
    const s = setup();
    const refs = await binanceHistoryHandler(s.io, s.download)(s.task, s.ctx);
    const missing = {
      id: "unused-old-contexts",
      hash: "a".repeat(64),
      type: "quant/trend-chunk",
      storage: "opfs",
      format: "json",
    } as const;
    const task = {
      ...s.task,
      inputs: [
        ...refs.map((r) => (r.type === "market/binance-manifest" ? { ...r, port: "manifest" } : r)),
        missing,
      ],
      config: {
        from: start + 60 * MINUTE,
        to: start + 120 * MINUTE,
        minutes: 1,
        hasTrades: false,
        chunks: [
          {
            ref: missing,
            from: start,
            to: start + 30 * MINUTE,
            trades: 0,
            indicators: 0,
            positionEvents: 0,
            contexts: 10,
          },
        ],
      },
    };
    const output = await trendChartHandler(s.io)(task, s.ctx);
    const chart = await s.io.readJsonArtifact<TrendChartData>(output[0]!, s.ctx);
    expect(chart.bars).toHaveLength(60);
    expect(chart.indicators).toEqual([]);
  });
  it("adds only missing warmup archives and rejects insufficient history before creating Rust state", async () => {
    const s = setup();
    const handler = binanceHistoryHandler(s.io, s.download);
    const initial = await handler(s.task, s.ctx);
    let created = false;
    await expect(
      trendHandler(s.io, async () => {
        created = true;
        throw new Error("unexpected engine creation");
      })(
        {
          ...s.task,
          inputs: initial.map((ref) =>
            ref.type === "market/binance-manifest" ? { ...ref, port: "manifest" } : ref,
          ),
          config: {
            strategy: withTradingPeriod(
              {
                ...DEFAULT_TREND_CONFIG,
                strategy: { ...DEFAULT_TREND_CONFIG.strategy, filter: "ema" },
              },
              60,
            ),
          },
        },
        s.ctx,
      ),
    ).rejects.toThrow("预热不足");
    expect(created).toBe(false);
    const refs = await handler(
      {
        ...s.task,
        config: {
          request: { symbol: "BTCUSDT", start: "2024-01-01", end: "2024-01-01", warmupDays: 3 },
        },
      },
      s.ctx,
    );
    const manifest = await s.io.readJsonArtifact<BinanceManifest>(
      refs.find((r) => r.type === "market/binance-manifest")!,
      s.ctx,
    );
    validateBinanceManifest(manifest);
    expect(manifest.warmupStart).toBe(start - 3 * DAY);
    expect(manifest.rows).toBe(5760);
    expect(s.urls).toHaveLength(9);
    expect(manifest.startTime).toBe(start);
  });
  it("returns bounded higher-period candles spanning multiple UTC days", async () => {
    const s = setup();
    const refs = await binanceHistoryHandler(s.io, s.download)(
      {
        ...s.task,
        config: { request: { symbol: "BTCUSDT", start: "2024-01-01", end: "2024-01-02" } },
      },
      s.ctx,
    );
    const task = {
      ...s.task,
      inputs: refs.map((ref) =>
        ref.type === "market/binance-manifest" ? { ...ref, port: "manifest" } : ref,
      ),
      config: { from: start, to: start + 2 * DAY, minutes: 1440, chunks: [], hasTrades: false },
    };
    const outputs = await trendChartHandler(s.io)(task, s.ctx);
    const bars = await s.io.readJsonArtifact<TrendChartData>(outputs[0]!, s.ctx);
    expect(bars.bars.map((b) => b.time)).toEqual([start, start + DAY]);
    expect(bars.bars[0]?.volume).toBe(1440);
    const midnight = await trendChartHandler(s.io)(
      {
        ...task,
        config: {
          ...task.config,
          from: start + DAY - 30 * MINUTE,
          to: start + DAY + 30 * MINUTE,
          minutes: 1,
        },
      },
      s.ctx,
    );
    const crossing = await s.io.readJsonArtifact<TrendChartData>(midnight[0]!, s.ctx);
    expect(crossing.bars).toHaveLength(60);
    expect(crossing.bars[30]?.time).toBe(start + DAY);
    await expect(
      trendChartHandler(s.io)(
        { ...task, config: { ...task.config, to: start + 3 * DAY, minutes: 1 } },
        s.ctx,
      ),
    ).rejects.toThrow("4096");
  });
  it("publishes only complete aligned data, freezes provenance and reuses verified archives", async () => {
    const s = setup(),
      handler = binanceHistoryHandler(s.io, s.download);
    const refs = await handler(s.task, s.ctx);
    const manifest = await s.io.readJsonArtifact<BinanceManifest>(
      refs.find((r) => r.type === "market/binance-manifest")!,
      s.ctx,
    );
    validateBinanceManifest(manifest);
    expect(new Set(refs.map((r) => r.id)).size).toBe(refs.length);
    expect(manifest.rows).toBe(2880);
    expect(s.urls).toHaveLength(5);
    await handler(s.task, s.ctx);
    expect(s.urls).toHaveLength(5);
    await handler({ ...s.task, config: { ...s.task.config, refresh: true } }, s.ctx);
    expect(s.urls).toHaveLength(10);
    expect(manifest.fundingPrice).toBe("minute-mark-open");
  });
  it("extracts bounded candle windows and validates frozen inputs inside the worker", async () => {
    const s = setup();
    const refs = await binanceHistoryHandler(s.io, s.download)(s.task, s.ctx);
    const manifestRef = refs.find((r) => r.type === "market/binance-manifest")!;
    const inputs = refs.map((ref) =>
      ref.id === manifestRef.id ? { ...ref, port: "manifest" } : ref,
    );
    const task = {
      ...s.task,
      inputs,
      config: { from: start, to: start + DAY, chunks: [], hasTrades: false },
    };
    const output = await trendChartHandler(s.io)(task, s.ctx);
    const bars = await s.io.readJsonArtifact<TrendChartData>(output[0]!, s.ctx);
    expect(bars.bars).toHaveLength(1440);
    expect(bars.bars[0]?.time).toBe(start);
    expect(bars.bars.at(-1)?.time).toBe(start + DAY - MINUTE);
    const aggregated = await trendChartHandler(s.io)(
      { ...task, config: { ...task.config, minutes: 5 } },
      s.ctx,
    );
    const candles = await s.io.readJsonArtifact<TrendChartData>(aggregated[0]!, s.ctx);
    expect(candles.bars).toHaveLength(288);
    expect(candles.bars[0]?.volume).toBe(5);
    expect(candles.bars.at(-1)?.time).toBe(start + DAY - 5 * MINUTE);
    await expect(
      trendChartHandler(s.io)({ ...task, config: { from: start, to: start + 2 * DAY } }, s.ctx),
    ).rejects.toThrow();
    await expect(
      trendChartHandler(s.io)({ ...task, inputs: [{ ...manifestRef, port: "manifest" }] }, s.ctx),
    ).rejects.toThrow("输入");
  });
  it("rejects missing funding instead of silently charging zero", async () => {
    const s = setup();
    const handler = binanceHistoryHandler(s.io, async (url) =>
      url.includes("fundingRate")
        ? { ...(await s.download(url)), csv: `${start + 1},8,.001` }
        : s.download(url),
    );
    await expect(handler(s.task, s.ctx)).rejects.toThrow("资金费率");
    expect((await s.store.list()).filter((key) => key.includes("manifest"))).toHaveLength(0);
  });
  it("retains reusable archives after cancel and never publishes an incomplete dataset", async () => {
    const abort = new AbortController(),
      s = setup(abort);
    const handler = binanceHistoryHandler(s.io, async (url) => {
      const data = await s.download(url);
      if (s.urls.length === 3) abort.abort();
      return data;
    });
    await expect(handler(s.task, s.ctx)).rejects.toThrow();
    expect((await s.store.list()).some((key) => key.includes("cache/binance"))).toBe(true);
    expect((await s.store.list()).some((key) => key.includes("manifest"))).toBe(false);
  });
  it("cleans owned result chunks and frees Rust state if cancellation interrupts replay", async () => {
    const abort = new AbortController(),
      s = setup(abort);
    const refs = await binanceHistoryHandler(s.io, s.download)(s.task, s.ctx);
    const manifestRef = refs.find((r) => r.type === "market/binance-manifest")!;
    let freed = false,
      drains = 0;
    const engine: TrendEngine = {
      load_partition: () => undefined,
      advance: () => false,
      processed_rows: () => 512,
      drain_output: () => {
        drains++;
        return JSON.stringify({
          equity: [{ time: start, equity: 10000, cash: 10000, drawdown: 0 }],
          trades: [],
          events: [],
          indicators: [],
        } satisfies TrendChunk);
      },
      finish: () => "{}",
      free: () => {
        freed = true;
      },
    };
    const handler = trendHandler(s.io, async () => engine);
    await expect(
      handler(
        {
          ...s.task,
          inputs: refs.map((ref) =>
            ref.id === manifestRef.id ? { ...ref, port: "manifest" } : ref,
          ),
          config: { strategy: DEFAULT_TREND_CONFIG },
        },
        { ...s.ctx, progress: () => abort.abort() },
      ),
    ).rejects.toThrow();
    expect(freed).toBe(true);
    expect(drains).toBe(1);
    expect((await s.store.list()).some((key) => key.includes("trend/result"))).toBe(false);
    expect(await s.store.has(artifactPath(manifestRef))).toBe(true);
  });
});
