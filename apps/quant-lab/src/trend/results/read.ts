import type { RuntimeServices } from "@bcr/core";
import { MINUTE, type BinanceDataset } from "@bcr/market-data/binance/model";
import type {
  TrendChunk,
  TrendChartWindow,
  TrendChartData,
  TrendResult,
  TrendTrade,
  TrendContextDecision,
  TrendChannelConfig,
} from "@bcr/quant-core/trend";
import { Effect } from "effect";
import { readJson } from "../../data/io";

export async function readChartWindow(
  services: RuntimeServices,
  dataset: BinanceDataset,
  result: TrendResult,
  window: TrendChartWindow,
  signal: AbortSignal,
  channel?: TrendChannelConfig,
): Promise<TrendChartData> {
  signal.throwIfAborted();
  const historyFrom = channel
    ? Math.max(
        dataset.manifest.warmupStart,
        window.from - channel.entryBars * channel.tradeMinutes * MINUTE,
      )
    : window.from;
  const handle = await Effect.runPromise(
    services.scheduler.submit({
      id: `trend-chart-${crypto.randomUUID()}`,
      runtime: "wasm",
      operation: "quant.chart.trend",
      inputs: [
        ...new Map(
          [
            { ...dataset.manifestRef, port: "manifest" },
            ...dataset.manifest.partitions
              .filter((p) => p.to > historyFrom && p.from < window.to)
              .map((p) => p.candles),
            ...result.chunks.map((c) => c.ref),
          ].map((ref) => [ref.id, ref]),
        ).values(),
      ],
      outputs: [{ name: "chart", type: "quant/trend-chart", storage: "opfs", format: "json" }],
      resources: { memoryMB: 256, threads: 1 },
      cache: { enabled: true },
      config: {
        ...window,
        chunks: result.chunks,
        hasTrades: result.metrics.trades > 0,
        ...(channel ? { channel } : {}),
      },
    }),
  );
  const cancel = () => {
    void Effect.runPromise(handle.cancel);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) {
      cancel();
      signal.throwIfAborted();
    }
    const outputs = await Effect.runPromise(handle.await);
    signal.throwIfAborted();
    const ref = outputs.find((r) => r.type === "quant/trend-chart");
    if (!ref) throw new Error("未读取到图表行情");
    const data = await readJson<TrendChartData>(services, ref);
    signal.throwIfAborted();
    return data;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
export async function readTradePage(
  services: RuntimeServices,
  result: TrendResult,
  page: number,
  size: number,
  signal: AbortSignal,
): Promise<TrendTrade[]> {
  let skipped = 0;
  const start = page * size,
    trades: TrendTrade[] = [];
  for (const c of result.chunks) {
    signal.throwIfAborted();
    if (skipped + c.trades <= start) {
      skipped += c.trades;
      continue;
    }
    const chunk = await readJson<TrendChunk>(services, c.ref);
    trades.push(...chunk.trades.slice(Math.max(0, start - skipped), start + size - skipped));
    skipped += c.trades;
    if (trades.length >= size) break;
  }
  signal.throwIfAborted();
  return trades;
}

/** Skip untouched artifacts by their index; load only one page of decisions. */
export async function readContextPage(
  services: { artifacts: Pick<RuntimeServices["artifacts"], "get"> },
  result: TrendResult,
  page: number,
  size: number,
  signal: AbortSignal,
): Promise<TrendContextDecision[]> {
  let skipped = 0;
  const start = page * size,
    decisions: TrendContextDecision[] = [];
  for (const c of result.chunks) {
    signal.throwIfAborted();
    const count = c.contexts ?? 0;
    if (skipped + count <= start) {
      skipped += count;
      continue;
    }
    const chunk = await readJson<TrendChunk>(services, c.ref);
    decisions.push(
      ...(chunk.contexts ?? []).slice(Math.max(0, start - skipped), start + size - skipped),
    );
    skipped += count;
    if (decisions.length >= size) break;
  }
  signal.throwIfAborted();
  return decisions;
}
/** Write all records through OPFS; export never substitutes the bounded preview. */
export async function exportTrend(
  services: RuntimeServices,
  run: import("@bcr/quant-core/trend").TrendRun,
  result: TrendResult,
) {
  const directory = await (
    await navigator.storage.getDirectory()
  ).getDirectoryHandle("trend-exports", { create: true });
  const name = `export-${crypto.randomUUID()}.json`;
  const file = await directory.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  try {
    const header = JSON.stringify({
      version: 1,
      engine: result.engine,
      window: result.window,
      config: run.config,
      manifest: run.dataset.manifest,
      metrics: result.metrics,
    });
    await writer.write(header.slice(0, -1) + ',"chunks":[');
    for (const [i, c] of result.chunks.entries()) {
      const chunk = await readJson<TrendChunk>(services, c.ref);
      await writer.write((i ? "," : "") + JSON.stringify(chunk));
    }
    await writer.write("]}");
    await writer.close();
    const url = URL.createObjectURL(await file.getFile());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${run.dataset.manifest.symbol}-trend-${run.id.slice(0, 8)}.json`;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      void directory.removeEntry(name);
    }, 5000);
  } catch (e) {
    await writer.abort().catch(() => undefined);
    await directory.removeEntry(name).catch(() => undefined);
    throw e;
  }
}
