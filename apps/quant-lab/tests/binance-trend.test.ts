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
  type TrendEvent,
  type TrendResult,
} from "@bcr/quant-core/trend";
import { createArtifactIO } from "@bcr/runtime-worker";
import { MemoryStore } from "@bcr/storage-opfs";
import { describe, expect, it } from "vitest";
import { binanceHistoryHandler } from "../src/trend/execution/data";
import { trendChartHandler } from "../src/trend/execution/chart";
import { trendHandler, type TrendEngine } from "../src/trend/execution/compute";
import { TREND_EXECUTOR_VERSION } from "../src/trend/execution/versions";
import { canReuseTrendDataset } from "../src/trend/execution/window";
import contract from "../../../crates/quant/fixtures/trend-contract.json";

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
function monthlySetup(abort = new AbortController()) {
  const s = setup(abort);
  const task = {
    ...s.task,
    config: { request: { symbol: "BTCUSDT", start: "2024-02-01", end: "2024-02-29" } },
  };
  const download = async (url: string) => {
    s.urls.push(url);
    const date = url.match(/(\d{4}-\d{2}(?:-\d{2})?)\.zip$/u)![1]!;
    const from = Date.parse(`${date.length === 7 ? date + "-01" : date}T00:00:00Z`);
    const to = date.length === 7 ? Date.UTC(2024, 2, 1) : from + DAY;
    let data: string;
    if (url.includes("fundingRate")) {
      data = Array.from(
        { length: (to - from) / (8 * 60 * MINUTE) },
        (_, i) => `${from + i * 8 * 60 * MINUTE + 1},8,.0001`,
      ).join("\n");
    } else {
      data = csv(from, to);
      if (date.length === 7 && url.includes("markPriceKlines"))
        data = data
          .split("\n")
          .filter((line) => Number(line.split(",")[0]) !== from + 14 * DAY + 10 * MINUTE)
          .join("\n");
    }
    const checksum = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data))),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { url, csv: data, checksum };
  };
  return { ...s, task, download };
}
describe("Binance worker pipeline", () => {
  it("loads pre-window frozen candles for causal channels and rejects missing history inputs", async () => {
    const s = setup();
    const refs = await binanceHistoryHandler(s.io, s.download)(s.task, s.ctx);
    const inputs = refs.map((ref) =>
      ref.type === "market/binance-manifest" ? { ...ref, port: "manifest" } : ref,
    );
    const task = {
      ...s.task,
      inputs,
      config: {
        from: start,
        to: start + DAY,
        minutes: 5,
        chunks: [],
        hasTrades: false,
        channel: { tradeMinutes: 1, entryBars: 20, exitBars: 10 },
      },
    };
    const output = await trendChartHandler(s.io)(task, s.ctx);
    const chart = await s.io.readJsonArtifact<TrendChartData>(output[0]!, s.ctx);
    expect(chart.channels).toHaveLength(288);
    expect(chart.channels![0]).toEqual({
      time: start,
      upper: 101,
      lower: 99,
      exitUpper: 101,
      exitLower: 99,
    });
    const manifest = await s.io.readJsonArtifact<BinanceManifest>(
      inputs.find((r) => r.port === "manifest")!,
      s.ctx,
    );
    await expect(
      trendChartHandler(s.io)(
        { ...task, inputs: inputs.filter((ref) => ref.id !== manifest.partitions[0]!.candles.id) },
        s.ctx,
      ),
    ).rejects.toThrow("输入不一致");
  });
  it("keeps browser cache identity in sync with the shared engine contract", () => {
    expect(TREND_EXECUTOR_VERSION).toBe(contract.executor);
  });
  it("separates cached coverage from the config's replay window and progress", async () => {
    const s = setup();
    const request = { symbol: "BTCUSDT", start: "2024-01-01", end: "2024-01-01" };
    const refs = await binanceHistoryHandler(s.io, s.download)(
      { ...s.task, config: { request: { ...request, warmupDays: 3 } } },
      s.ctx,
    );
    const manifestRef = refs.find((ref) => ref.type === "market/binance-manifest")!;
    const manifest = await s.io.readJsonArtifact<BinanceManifest>(manifestRef, s.ctx);
    const original = JSON.stringify(manifest);
    const config = withTradingPeriod(DEFAULT_TREND_CONFIG, 1);
    expect(canReuseTrendDataset({ manifest, manifestRef }, request, config)).toBe(true);
    const processed: number[] = [],
      progress: number[] = [];
    let window: { startTime: number; endTime: number; warmupStart: number };
    const handler = trendHandler(s.io, async (_config, _funding, value) => {
      window = JSON.parse(value);
      return {
        load_partition: (candles) => {
          processed.push(
            ...candles
              .split("\n")
              .filter(Boolean)
              .map((line) => Number(line.split(",")[0])),
          );
        },
        advance: () => true,
        processed_rows: () => processed.length,
        drain_output: () => JSON.stringify({ equity: [], trades: [], events: [], indicators: [] }),
        finish: () => JSON.stringify({ rows: processed.length }),
        free: () => undefined,
      };
    });
    const output = await handler(
      {
        ...s.task,
        inputs: refs.map((ref) => (ref.id === manifestRef.id ? { ...ref, port: "manifest" } : ref)),
        config: { strategy: config },
      },
      { ...s.ctx, progress: (value) => progress.push(value) },
    );
    const result = await s.io.readJsonArtifact<TrendResult>(output[0]!, s.ctx);
    expect(window!).toEqual({ startTime: start, endTime: start + DAY, warmupStart: start - DAY });
    expect(result.window).toEqual(window!);
    expect(processed[0]).toBe(start - DAY);
    expect(processed).toHaveLength(2880);
    expect(progress.at(-1)).toBe(1);
    expect(JSON.stringify(manifest)).toBe(original);
  });
  it("recovers an incomplete monthly mark archive, freezes source receipts and reuses the daily repair cache", async () => {
    const s = monthlySetup(),
      handler = binanceHistoryHandler(s.io, s.download);
    const refs = await handler(s.task, s.ctx);
    const manifest = await s.io.readJsonArtifact<BinanceManifest>(
      refs.find((r) => r.type === "market/binance-manifest")!,
      s.ctx,
    );
    validateBinanceManifest(manifest);
    const partition = manifest.partitions[1]!;
    const repair = partition.repairs![0]!;
    expect(repair.kind).toBe("marks");
    expect(repair.days.map((day) => day.date)).toEqual(["2024-02-15"]);
    expect(partition.marks.id).toBe(`binance/complete/${partition.marks.hash}`);
    expect(repair.original.id).toBe(`binance/archive/${partition.markChecksum}`);
    expect(refs).toContainEqual(repair.original);
    expect(refs).toContainEqual(repair.days[0]!.ref);
    expect(
      s.urls.filter((url) => url.includes("daily/markPriceKlines") && url.includes("2024-02-15")),
    ).toHaveLength(1);
    expect(s.urls.some((url) => url.includes("daily/klines") && url.includes("2024-02-15"))).toBe(
      false,
    );
    const frozen = JSON.stringify(manifest);
    await handler(s.task, s.ctx);
    expect(s.urls).toHaveLength(6);
    await handler({ ...s.task, config: { ...s.task.config, refresh: true } }, s.ctx);
    expect(s.urls).toHaveLength(12);
    expect(JSON.stringify(manifest)).toBe(frozen);
    const task = {
      ...s.task,
      inputs: refs.map((r) =>
        r.type === "market/binance-manifest" ? { ...r, port: "manifest" } : r,
      ),
      config: {
        from: Date.UTC(2024, 1, 15),
        to: Date.UTC(2024, 1, 16),
        minutes: 5,
        hasTrades: false,
        chunks: [],
      },
    };
    const output = await trendChartHandler(s.io)(task, s.ctx);
    expect((await s.io.readJsonArtifact<TrendChartData>(output[0]!, s.ctx)).bars).toHaveLength(288);
    for (const alter of [
      (m: BinanceManifest) => {
        m.partitions[1]!.repairs![0]!.days[0]!.date = "2024-03-01";
      },
      (m: BinanceManifest) => {
        m.partitions[1]!.repairs![0]!.days[0]!.checksum = "invalid";
      },
      (m: BinanceManifest) => {
        const repair = m.partitions[1]!.repairs![0]!;
        repair.original = { ...repair.original, id: "unverified" };
      },
    ]) {
      const invalid = structuredClone(manifest);
      alter(invalid);
      expect(() => validateBinanceManifest(invalid)).toThrow("来源无效");
    }
  });
  it("never publishes a dataset if the official recovery day also has a gap", async () => {
    const s = monthlySetup();
    let incomplete = true;
    const handler = binanceHistoryHandler(s.io, async (url) => {
      const result = await s.download(url);
      return incomplete && url.includes("2024-02-15.zip")
        ? { ...result, csv: result.csv.split("\n").slice(1).join("\n") }
        : result;
    });
    await expect(handler(s.task, s.ctx)).rejects.toThrow("官方日档案仍缺少分钟");
    expect((await s.store.list()).some((key) => key.includes("manifest"))).toBe(false);
    incomplete = false;
    const retry = await handler(s.task, s.ctx);
    expect(retry.some((ref) => ref.type === "market/binance-manifest")).toBe(true);
    expect(s.urls.filter((url) => url.includes("2024-02-15.zip"))).toHaveLength(2);
    expect(s.urls.filter((url) => url.includes("monthly/markPriceKlines"))).toHaveLength(1);
  });
  it("recovers candle and mark-price gaps independently and preserves receipts for both", async () => {
    const s = monthlySetup();
    const handler = binanceHistoryHandler(s.io, async (url) => {
      const result = await s.download(url);
      if (!url.includes("monthly/klines")) return result;
      const data = result.csv.split("\n").slice(1).join("\n");
      const checksum = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data))),
      ]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return { ...result, csv: data, checksum };
    });
    const refs = await handler(s.task, s.ctx);
    const manifest = await s.io.readJsonArtifact<BinanceManifest>(
      refs.find((r) => r.type === "market/binance-manifest")!,
      s.ctx,
    );
    validateBinanceManifest(manifest);
    expect(manifest.partitions[1]!.repairs!.map((r) => [r.kind, r.days[0]!.date])).toEqual([
      ["candles", "2024-02-01"],
      ["marks", "2024-02-15"],
    ]);
  });
  it("preserves verified month cache but stops publishing when cancellation interrupts the daily repair", async () => {
    const abort = new AbortController(),
      s = monthlySetup(abort);
    const handler = binanceHistoryHandler(s.io, async (url) => {
      const result = await s.download(url);
      if (url.includes("2024-02-15.zip")) abort.abort();
      return result;
    });
    await expect(handler(s.task, s.ctx)).rejects.toThrow();
    expect((await s.store.list()).some((key) => key.includes("cache/binance"))).toBe(true);
    expect((await s.store.list()).some((key) => key.includes("manifest"))).toBe(false);
  });
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
  it("seeds the latest position across historical chunks and stops its segment at exit", async () => {
    const s = setup();
    const refs = await binanceHistoryHandler(s.io, s.download)(s.task, s.ctx);
    const event = (
      minute: number,
      kind: TrendEvent["kind"],
      price: number,
      tradeId: number,
    ): TrendEvent => ({
      time: start + minute * MINUTE,
      kind,
      price,
      tradeId,
      side: "long",
      value: null,
      reason: "test",
    });
    const older: TrendChunk = {
      events: [event(0, "stop", 80, 1), event(10, "exit", 100, 1)],
      trades: [],
      equity: [],
      indicators: [],
    };
    const before: TrendChunk = {
      // Equal timestamps keep their engine order: the third stop belongs to the new position.
      events: [event(20, "stop", 90, 2), event(20, "exit", 100, 2), event(20, "stop", 95, 3)],
      trades: [],
      equity: [],
      indicators: [],
    };
    const inside: TrendChunk = {
      events: [event(65, "stop", 96, 3), event(70, "exit", 100, 3), event(80, "stop", 97, 4)],
      trades: [],
      equity: [],
      indicators: [],
    };
    const chunkRefs = [];
    for (const [index, chunk] of [older, before, inside].entries())
      chunkRefs.push(
        await s.io.writeTypedJsonArtifact(
          `chart-seed-${index}`,
          "chunk",
          "quant/trend-chunk",
          chunk,
        ),
      );
    const chunks = chunkRefs.map((ref, index) => ({
      ref,
      from: start + [0, 15, 60][index]! * MINUTE,
      to: start + [15, 30, 90][index]! * MINUTE,
      trades: 0,
      indicators: 0,
      positionEvents: index === 0 ? 2 : 3,
    }));
    const output = await trendChartHandler(s.io)(
      {
        ...s.task,
        inputs: [
          ...refs.map((ref) =>
            ref.type === "market/binance-manifest" ? { ...ref, port: "manifest" } : ref,
          ),
          ...chunkRefs,
        ],
        config: { from: start + 60 * MINUTE, to: start + 90 * MINUTE, minutes: 5, chunks },
      },
      s.ctx,
    );
    const chart = await s.io.readJsonArtifact<TrendChartData>(output[0]!, s.ctx);
    expect(chart.stops).toEqual([
      {
        tradeId: 3,
        points: [
          { time: start + 60 * MINUTE, value: 95 },
          { time: start + 65 * MINUTE, value: 96 },
        ],
      },
      {
        tradeId: 4,
        points: [
          { time: start + 80 * MINUTE, value: 97 },
          { time: start + 85 * MINUTE, value: 97 },
        ],
      },
    ]);
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
          config: { strategy: withTradingPeriod(DEFAULT_TREND_CONFIG, 1) },
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
