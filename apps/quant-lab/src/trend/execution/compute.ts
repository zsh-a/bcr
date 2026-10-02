import { artifactPath, type ArtifactRef, type ComputeTask } from "@bcr/core";
import {
  DAY,
  validateBinanceManifest,
  type BinanceManifest,
  type FundingRate,
} from "@bcr/market-data/binance/model";
import {
  trendWarmupDays,
  validateTrendConfig,
  type TrendChunk,
  type TrendConfig,
  type TrendMetrics,
  type TrendResult,
} from "@bcr/quant-core/trend";
import { throwIfAborted, type ArtifactIO, type WorkerContext } from "@bcr/runtime-worker";
import initQuant, { TrendBacktest } from "../../../../../crates/quant/pkg/bcr_quant.js";
import { TREND_EXECUTOR_VERSION } from "./versions";

export interface TrendEngine {
  load_partition(candles: string, marks: string): void;
  advance(rows: number): boolean;
  processed_rows(): number;
  drain_output(): string;
  finish(): string;
  free(): void;
}
type Factory = (config: string, funding: string, window: string) => Promise<TrendEngine>;
let ready: Promise<unknown> | undefined;
async function create(config: string, funding: string, window: string): Promise<TrendEngine> {
  ready ??= initQuant();
  await ready;
  return new TrendBacktest(config, funding, window);
}
export function trendHandler(io: ArtifactIO, factory: Factory = create) {
  return async (task: ComputeTask, ctx: WorkerContext): Promise<readonly ArtifactRef[]> => {
    const manifestRef = task.inputs.find((ref) => ref.port === "manifest");
    if (!manifestRef) throw new Error("趋势回测缺少行情清单");
    const manifest = await io.readJsonArtifact<BinanceManifest>(manifestRef, ctx);
    validateBinanceManifest(manifest);
    const config = task.config?.["strategy"] as TrendConfig;
    validateTrendConfig(config);
    if (manifest.startTime - manifest.warmupStart < trendWarmupDays(config) * DAY)
      throw new Error("行情预热不足，请按当前交易周期重新获取数据");
    const inputs = new Set(task.inputs.map((ref) => ref.id));
    if (
      manifest.version !== 1 ||
      manifest.market !== "usdt-perpetual" ||
      manifest.interval !== "1m" ||
      !inputs.has(manifest.funding.id) ||
      manifest.partitions.some((p) => !inputs.has(p.candles.id) || !inputs.has(p.marks.id))
    )
      throw new Error("Binance 回测清单与冻结输入不一致");
    const funding = await io.readJsonArtifact<FundingRate[]>(manifest.funding, ctx);
    const engine = await factory(
      JSON.stringify(config),
      JSON.stringify(funding),
      JSON.stringify({
        startTime: manifest.startTime,
        endTime: manifest.endTime,
        warmupStart: manifest.warmupStart,
      }),
    );
    const namespace = `trend/result-${crypto.randomUUID()}`;
    const created: ArtifactRef[] = [];
    const chunks: TrendResult["chunks"] = [],
      equity: TrendResult["equity"] = [],
      trades: TrendResult["trades"] = [];
    let chunkFrom = manifest.startTime;
    const drain = async () => {
      const chunk = JSON.parse(engine.drain_output()) as TrendChunk;
      if (
        !chunk.equity.length &&
        !chunk.trades.length &&
        !chunk.events.length &&
        !chunk.indicators.length &&
        !chunk.contexts?.length
      )
        return;
      throwIfAborted(ctx);
      const times = [
        ...chunk.equity.map((p) => p.time),
        ...chunk.trades.map((t) => t.exitTime),
        ...chunk.events.map((e) => e.time),
        ...chunk.indicators.map((p) => p.time),
        ...(chunk.contexts ?? []).map((p) => p.time),
      ];
      const to = Math.max(chunkFrom, ...times) + 1;
      const ref = await io.writeTypedJsonArtifact(
        namespace,
        `chunk-${chunks.length}`,
        "quant/trend-chunk",
        chunk,
      );
      created.push(ref);
      chunks.push({
        ref,
        from: chunkFrom,
        to,
        trades: chunk.trades.length,
        contexts: chunk.contexts?.length ?? 0,
        indicators: chunk.indicators.length,
        positionEvents: chunk.events.filter((e) => e.kind === "stop" || e.kind === "exit").length,
      });
      chunkFrom = to - 1;
      equity.push(...chunk.equity);
      if (equity.length > 3000) {
        const compact = equity.filter((_, i) => i % 2 === 0 || i === equity.length - 1);
        equity.splice(0, equity.length, ...compact);
      }
      trades.push(...chunk.trades);
      if (trades.length > 100) trades.splice(0, trades.length - 100);
    };
    let published = false;
    try {
      for (const p of manifest.partitions) {
        throwIfAborted(ctx);
        const candles = await (await io.getBlob(p.candles)).text();
        const marks = await (await io.getBlob(p.marks)).text();
        throwIfAborted(ctx);
        engine.load_partition(candles, marks);
        let done = false;
        while (!done) {
          throwIfAborted(ctx);
          done = engine.advance(512);
          await drain();
          ctx.progress(engine.processed_rows() / manifest.rows);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      const metrics = JSON.parse(engine.finish()) as TrendMetrics;
      await drain();
      throwIfAborted(ctx);
      const result: TrendResult = {
        version: 1,
        engine: TREND_EXECUTOR_VERSION,
        metrics,
        equity,
        trades,
        chunks,
      };
      const ref = await io.writeTypedJsonArtifact(
        namespace,
        "summary",
        "quant/trend-result",
        result,
      );
      created.push(ref);
      throwIfAborted(ctx);
      published = true;
      return [ref, ...chunks.map((c) => c.ref)];
    } finally {
      engine.free();
      if (!published)
        await Promise.allSettled(created.map((ref) => io.store.delete(artifactPath(ref))));
    }
  };
}
