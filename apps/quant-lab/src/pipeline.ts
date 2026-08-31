import type { ArtifactRef, PipelineHandle, PipelineNode } from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { Effect, Stream } from "effect";
import type {
  BacktestMetrics,
  BacktestResult,
  EquityPoint,
  QuantOutputRefs,
  SignalPoint,
  Trade,
} from "./model";
import { persistProject } from "./runtime";
import { quant } from "./store";

let active: PipelineHandle | null = null;
const decoder = new TextDecoder();

async function readJson<T>(services: RuntimeServices, ref: ArtifactRef): Promise<T> {
  const bytes = await Effect.runPromise(services.artifacts.get(ref));
  return JSON.parse(decoder.decode(bytes)) as T;
}

function output(outputs: ReadonlyArray<ArtifactRef>, port: string, type: string): ArtifactRef {
  const ref =
    outputs.find((item) => item.port === port) ?? outputs.find((item) => item.type === type);
  if (ref === undefined) throw new Error(`missing output ${port}`);
  return ref;
}

export async function runStrategy(services: RuntimeServices): Promise<void> {
  const state = quant.getSnapshot();
  if (state.dataset === null || state.running) return;
  const runId = `quant-${Date.now().toString(36)}`;
  const startedAt = Date.now();
  const source = { ...state.dataset.ref, port: "market" };
  const nodes: ReadonlyArray<PipelineNode> = [
    {
      id: "signal",
      runtime: "js",
      operation: "quant.signal.sma-cross",
      inputs: [source],
      outputs: [{ name: "signals", type: "quant/signals", storage: "opfs" }],
      resources: { memoryMB: 96, threads: 1 },
      cache: { enabled: true },
      config: {
        fastPeriod: state.config.fastPeriod,
        slowPeriod: state.config.slowPeriod,
      },
    },
    {
      id: "backtest",
      runtime: "wasm",
      operation: "quant.backtest.long-only",
      inputs: [source],
      bindings: [{ from: "signal", output: "signals", input: "signals" }],
      outputs: [
        { name: "equity", type: "quant/equity", storage: "opfs" },
        { name: "trades", type: "quant/trades", storage: "opfs" },
        { name: "metrics", type: "quant/metrics", storage: "opfs" },
      ],
      resources: { memoryMB: 128, threads: 1 },
      cache: { enabled: true },
      config: {
        initialCapital: state.config.initialCapital,
        feeBps: state.config.feeBps,
      },
    },
  ];

  quant.startRun(runId);
  quant.log(
    "info",
    `pipeline · ${runId} · SMA(${state.config.fastPeriod}, ${state.config.slowPeriod})`,
  );
  try {
    const handle = await Effect.runPromise(services.scheduler.submitPipeline(runId, nodes));
    active = handle;
    Effect.runFork(
      Stream.runForEach(handle.events, (event) =>
        Effect.sync(() => {
          if (!event.taskId.startsWith(`${runId}/`)) return;
          const nodeId = event.taskId.slice(runId.length + 1);
          if (event.type === "progress") {
            quant.patchNode(nodeId, { status: "running", progress: event.value });
          } else if (event.type === "completed") {
            quant.patchNode(nodeId, { status: "completed", progress: 1 });
          } else if (event.type === "failed") {
            quant.patchNode(nodeId, { status: "failed", error: event.error });
          }
        }),
      ),
    );

    const results = await Effect.runPromise(handle.await);
    const signalOutputs = results.get("signal") ?? [];
    const backtestOutputs = results.get("backtest") ?? [];
    const refs: QuantOutputRefs = {
      signals: output(signalOutputs, "signals", "quant/signals"),
      equity: output(backtestOutputs, "equity", "quant/equity"),
      trades: output(backtestOutputs, "trades", "quant/trades"),
      metrics: output(backtestOutputs, "metrics", "quant/metrics"),
    };
    const [signals, equity, trades, metrics] = await Promise.all([
      readJson<ReadonlyArray<SignalPoint>>(services, refs.signals),
      readJson<ReadonlyArray<EquityPoint>>(services, refs.equity),
      readJson<ReadonlyArray<Trade>>(services, refs.trades),
      readJson<BacktestMetrics>(services, refs.metrics),
    ]);
    const result: BacktestResult = { equity, trades, metrics };
    quant.complete(signals, result, refs, Date.now() - startedAt);
    quant.log(
      "ok",
      `pipeline · completed · ${metrics.engine ?? "legacy"} · ${(metrics.totalReturn * 100).toFixed(2)}% · ${metrics.tradeCount} trades`,
    );
    await persistProject(services);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    quant.fail(message.includes("interrupted") ? "cancelled" : message);
  } finally {
    active = null;
  }
}

export async function cancelStrategy(): Promise<void> {
  if (active === null) return;
  await Effect.runPromise(active.cancel);
  quant.fail("cancelled");
  active = null;
}
