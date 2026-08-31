import { artifactPath, contentHash, type ArtifactRef, type ComputeTask } from "@bcr/core";
import { defineWorker, type WorkerContext } from "@bcr/runtime-worker";
import { OpfsStore } from "@bcr/storage-opfs";
import initWasm from "../../../../crates/kernels/pkg/bcr_kernels.js";
import { decodeMarketArrow } from "../arrow";
import { computeSmaSignals, runBacktest, validateMarketBars } from "../engine";
import type { BacktestResult, MarketBar, SignalPoint, StrategyConfig } from "../model";
import { runWasmBacktest } from "../wasm-backtest";

const opfs = new OpfsStore("quant");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let wasmReady: Promise<unknown> | undefined;

function initializeWasm(): Promise<unknown> {
  wasmReady ??= initWasm();
  return wasmReady;
}

function pickInput(task: ComputeTask, port: string, type: string): ArtifactRef {
  const input =
    task.inputs.find((ref) => ref.port === port) ?? task.inputs.find((ref) => ref.type === type);
  if (input === undefined) throw new Error(`${task.operation} requires ${port}`);
  return input;
}

async function readJson<T>(ref: ArtifactRef): Promise<T> {
  const bytes = await readBytes(ref);
  return JSON.parse(decoder.decode(bytes)) as T;
}

async function readBytes(ref: ArtifactRef): Promise<Uint8Array> {
  const bytes = await opfs.get(artifactPath(ref));
  if (bytes === undefined) throw new Error(`artifact not found: ${ref.id}`);
  return bytes;
}

async function readMarket(ref: ArtifactRef): Promise<ReadonlyArray<MarketBar>> {
  const bytes = await readBytes(ref);
  return ref.format === "json"
    ? (JSON.parse(decoder.decode(bytes)) as ReadonlyArray<MarketBar>)
    : decodeMarketArrow(bytes, 1);
}

async function readMarketInputs(task: ComputeTask): Promise<ReadonlyArray<MarketBar>> {
  const refs = task.inputs
    .filter((ref) => ref.type === "market/ohlcv+arrow" || ref.port?.startsWith("market-") === true)
    .sort((left, right) => (left.port ?? left.id).localeCompare(right.port ?? right.id));
  if (refs.length === 0) throw new Error(`${task.operation} requires market partitions`);
  const partitions = await Promise.all(refs.map(readMarket));
  return validateMarketBars(partitions.flat());
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

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}

function assertBacktestParity(wasm: BacktestResult, reference: BacktestResult): void {
  if (
    wasm.equity.length !== reference.equity.length ||
    wasm.trades.length !== reference.trades.length ||
    wasm.metrics.tradeCount !== reference.metrics.tradeCount
  ) {
    throw new Error("Rust/WASM parity length mismatch");
  }
  for (let index = 0; index < wasm.equity.length; index += 1) {
    const actual = wasm.equity[index];
    const expected = reference.equity[index];
    if (
      actual === undefined ||
      expected === undefined ||
      !closeEnough(actual.equity, expected.equity) ||
      !closeEnough(actual.drawdown, expected.drawdown)
    ) {
      throw new Error(`Rust/WASM parity mismatch at equity row ${index}`);
    }
  }
  const metrics = [
    "totalReturn",
    "annualizedReturn",
    "buyHoldReturn",
    "sharpe",
    "maxDrawdown",
    "winRate",
    "exposure",
    "finalEquity",
  ] as const;
  for (const metric of metrics) {
    if (!closeEnough(wasm.metrics[metric], reference.metrics[metric])) {
      throw new Error(`Rust/WASM parity mismatch at ${metric}`);
    }
  }
}

async function verifiedWasmBacktest(
  bars: ReadonlyArray<MarketBar>,
  signals: ReadonlyArray<SignalPoint>,
  config: Pick<StrategyConfig, "initialCapital" | "feeBps">,
): Promise<BacktestResult> {
  let reference: BacktestResult | undefined;
  try {
    await initializeWasm();
    const wasm = runWasmBacktest(bars, signals, config);
    reference = runBacktest(bars, signals, config);
    assertBacktestParity(wasm, reference);
    return wasm;
  } catch (error) {
    console.warn("[quant] Rust/WASM backtester unavailable, using TypeScript reference", error);
    reference ??= runBacktest(bars, signals, config);
    return { ...reference, metrics: { ...reference.metrics, engine: "typescript-fallback" } };
  }
}

async function signalTask(
  task: ComputeTask,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  ctx.progress(0.08);
  const bars = await readMarketInputs(task);
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
    readMarketInputs(task),
    readJson<ReadonlyArray<SignalPoint>>(pickInput(task, "signals", "quant/signals")),
  ]);
  if (ctx.signal.aborted) throw new Error("cancelled");
  ctx.progress(0.36);
  const result = await verifiedWasmBacktest(bars, signals, {
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
