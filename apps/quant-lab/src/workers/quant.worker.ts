import { artifactPath, contentHash, type ArtifactRef, type ComputeTask } from "@bcr/core";
import { defineWorker, type WorkerContext } from "@bcr/runtime-worker";
import { OpfsStore } from "@bcr/storage-opfs";
import { computeSmaSignals, runBacktest } from "../engine";
import type { MarketBar, SignalPoint } from "../model";

const opfs = new OpfsStore("quant");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function pickInput(task: ComputeTask, port: string, type: string): ArtifactRef {
  const input =
    task.inputs.find((ref) => ref.port === port) ?? task.inputs.find((ref) => ref.type === type);
  if (input === undefined) throw new Error(`${task.operation} requires ${port}`);
  return input;
}

async function readJson<T>(ref: ArtifactRef): Promise<T> {
  const bytes = await opfs.get(artifactPath(ref));
  if (bytes === undefined) throw new Error(`artifact not found: ${ref.id}`);
  return JSON.parse(decoder.decode(bytes)) as T;
}

async function persistJson(prefix: string, type: string, value: unknown): Promise<ArtifactRef> {
  const bytes = encoder.encode(JSON.stringify(value));
  const hash = contentHash(bytes);
  const ref: ArtifactRef = {
    id: `${prefix}/${hash}`,
    type,
    storage: "opfs",
    format: "json",
    hash,
  };
  await opfs.put(artifactPath(ref), bytes);
  return ref;
}

function numberConfig(task: ComputeTask, key: string, fallback: number): number {
  const value = task.config?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function signalTask(
  task: ComputeTask,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  ctx.progress(0.08);
  const bars = await readJson<ReadonlyArray<MarketBar>>(pickInput(task, "market", "market/ohlcv"));
  if (ctx.signal.aborted) throw new Error("cancelled");
  ctx.progress(0.42);
  const signals = computeSmaSignals(
    bars,
    numberConfig(task, "fastPeriod", 20),
    numberConfig(task, "slowPeriod", 80),
  );
  ctx.progress(0.76);
  const output = await persistJson("signals", "quant/signals", signals);
  ctx.progress(1);
  return [output];
}

async function backtestTask(
  task: ComputeTask,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  ctx.progress(0.06);
  const [bars, signals] = await Promise.all([
    readJson<ReadonlyArray<MarketBar>>(pickInput(task, "market", "market/ohlcv")),
    readJson<ReadonlyArray<SignalPoint>>(pickInput(task, "signals", "quant/signals")),
  ]);
  if (ctx.signal.aborted) throw new Error("cancelled");
  ctx.progress(0.36);
  const result = runBacktest(bars, signals, {
    initialCapital: numberConfig(task, "initialCapital", 100_000),
    feeBps: numberConfig(task, "feeBps", 8),
  });
  ctx.progress(0.68);
  const [equity, trades, metrics] = await Promise.all([
    persistJson("equity", "quant/equity", result.equity),
    persistJson("trades", "quant/trades", result.trades),
    persistJson("metrics", "quant/metrics", result.metrics),
  ]);
  ctx.progress(1);
  return [equity, trades, metrics];
}

defineWorker({
  "quant.signal.sma-cross": signalTask,
  "quant.backtest.long-only": backtestTask,
});
