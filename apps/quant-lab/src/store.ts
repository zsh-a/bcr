import { useSyncExternalStore } from "react";
import type {
  BacktestResult,
  Dataset,
  NodeRun,
  QuantOutputRefs,
  SignalPoint,
  StrategyConfig,
} from "./model";

export interface QuantLog {
  readonly ts: number;
  readonly level: "info" | "ok" | "warn" | "error";
  readonly message: string;
}

export interface QuantState {
  readonly dataset: Dataset | null;
  readonly config: StrategyConfig;
  readonly signals: ReadonlyArray<SignalPoint>;
  readonly result: BacktestResult | null;
  readonly outputRefs: QuantOutputRefs | null;
  readonly nodes: Readonly<Record<string, NodeRun>>;
  readonly running: boolean;
  readonly runId: string | null;
  readonly runDurationMs: number | null;
  readonly logs: ReadonlyArray<QuantLog>;
}

const DEFAULT_CONFIG: StrategyConfig = {
  fastPeriod: 20,
  slowPeriod: 80,
  initialCapital: 100_000,
  feeBps: 8,
};

class QuantStore {
  private state: QuantState = {
    dataset: null,
    config: DEFAULT_CONFIG,
    signals: [],
    result: null,
    outputRefs: null,
    nodes: {},
    running: false,
    runId: null,
    runDurationMs: null,
    logs: [],
  };
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): QuantState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<QuantState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  setDataset(dataset: Dataset): void {
    this.set({ dataset, signals: [], result: null, outputRefs: null, runDurationMs: null });
  }

  setConfig(patch: Partial<StrategyConfig>): void {
    const config = { ...this.state.config, ...patch };
    if (
      config.fastPeriod === this.state.config.fastPeriod &&
      config.slowPeriod === this.state.config.slowPeriod &&
      config.initialCapital === this.state.config.initialCapital &&
      config.feeBps === this.state.config.feeBps
    ) {
      return;
    }
    // 参数已经进入 cache key；改参后旧结果不再代表当前策略，避免跨刷新恢复错配。
    this.set({ config, signals: [], result: null, outputRefs: null, runDurationMs: null });
  }

  startRun(runId: string): void {
    this.set({
      running: true,
      runId,
      runDurationMs: null,
      nodes: {
        signal: { status: "pending", progress: 0 },
        backtest: { status: "pending", progress: 0 },
      },
    });
  }

  patchNode(id: string, patch: Partial<NodeRun>): void {
    const current = this.state.nodes[id] ?? { status: "pending", progress: 0 };
    this.set({ nodes: { ...this.state.nodes, [id]: { ...current, ...patch } } });
  }

  complete(
    signals: ReadonlyArray<SignalPoint>,
    result: BacktestResult,
    outputRefs: QuantOutputRefs,
    runDurationMs: number,
  ): void {
    this.set({
      signals,
      result,
      outputRefs,
      running: false,
      runDurationMs,
      nodes: {
        signal: { status: "completed", progress: 1 },
        backtest: { status: "completed", progress: 1 },
      },
    });
  }

  fail(message: string): void {
    const nodes: Record<string, NodeRun> = Object.fromEntries(
      Object.entries(this.state.nodes).map(([id, node]) => [
        id,
        node.status === "completed"
          ? node
          : ({ ...node, status: "failed", error: message } satisfies NodeRun),
      ]),
    );
    this.set({ running: false, nodes });
    this.log(message === "cancelled" ? "warn" : "error", `pipeline · ${message}`);
  }

  restoreResult(
    signals: ReadonlyArray<SignalPoint>,
    result: BacktestResult,
    outputRefs: QuantOutputRefs,
  ): void {
    this.set({ signals, result, outputRefs, runDurationMs: 0 });
  }

  log(level: QuantLog["level"], message: string): void {
    this.set({
      logs: [...this.state.logs, { ts: Date.now(), level, message }].slice(-300),
    });
  }
}

export const quant = new QuantStore();

export function useQuantLab<T>(selector: (state: QuantState) => T): T {
  return useSyncExternalStore(quant.subscribe, () => selector(quant.getSnapshot()));
}
