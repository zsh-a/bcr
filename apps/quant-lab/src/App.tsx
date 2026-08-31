import { RuntimeProvider, useRuntime, type RuntimeServices } from "@bcr/react";
import { Activity, Database, Download, Play, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EquityChart, MarketChart } from "./components/Charts";
import { TradeBlotter } from "./components/TradeBlotter";
import { cancelStrategy, runStrategy } from "./pipeline";
import {
  createRuntimeServices,
  importCsvDataset,
  loadDemoDataset,
  persistProject,
  restoreProject,
} from "./runtime";
import { quant, useQuantLab } from "./store";
import "./styles.css";

export function App() {
  const [services, setServices] = useState<RuntimeServices | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void createRuntimeServices()
      .then(async (runtime) => {
        if (cancelled) return;
        setServices(runtime);
        const restored = await restoreProject(runtime);
        if (!restored) await loadDemoDataset(runtime);
        if (quant.getSnapshot().result === null) void runStrategy(runtime);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return <div className="ql-boot-error">QUANT RUNTIME OFFLINE · {error}</div>;
  }
  if (services === null) {
    return (
      <div className="ql-boot">
        <span>QL/02</span>
        <b>ASSEMBLING QUANT RUNTIME</b>
        <i />
      </div>
    );
  }
  return (
    <RuntimeProvider services={services}>
      <Workbench />
    </RuntimeProvider>
  );
}

function percent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function Workbench() {
  const services = useRuntime();
  const state = useQuantLab((snapshot) => snapshot);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => void persistProject(services), 600);
    return () => window.clearTimeout(timer);
  }, [services, state.config]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void runStrategy(services);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [services]);

  const metrics = state.result?.metrics;
  const bars = state.dataset?.bars ?? [];
  const dateRange = bars.length > 0 ? `${bars[0]?.date} — ${bars.at(-1)?.date}` : "NO DATA";

  const importFile = async (file: File): Promise<void> => {
    try {
      await importCsvDataset(services, file);
      await persistProject(services);
      void runStrategy(services);
    } catch (error) {
      quant.log("error", `import · ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const exportTrades = (): void => {
    const trades = state.result?.trades ?? [];
    const csv = [
      "entry_date,entry_price,exit_date,exit_price,return,pnl",
      ...trades.map((trade) =>
        [
          trade.entryDate,
          trade.entryPrice,
          trade.exitDate ?? "",
          trade.exitPrice ?? "",
          trade.returnPct,
          trade.pnl,
        ].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "quant-lab-trades.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    quant.log("ok", `export · ${trades.length} trades`);
  };

  return (
    <div className="quant-lab">
      <header className="ql-header">
        <div className="ql-brand">
          <span>QL/02</span>
          <div>
            <b>BCR QUANT LAB</b>
            <small>STRATEGY WORKBENCH · LOCAL EXECUTION</small>
          </div>
        </div>
        <div className="ql-market-status">
          <i />
          REPLAY ONLINE
          <span>{state.dataset?.name ?? "NO DATASET"}</span>
        </div>
        <div className="ql-actions">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void importFile(file);
              event.target.value = "";
            }}
          />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={state.running}>
            <Upload /> IMPORT CSV
          </button>
          <button type="button" onClick={exportTrades} disabled={state.result === null}>
            <Download /> EXPORT
          </button>
          {state.running ? (
            <button type="button" className="danger" onClick={() => void cancelStrategy()}>
              <Square /> CANCEL
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => void runStrategy(services)}>
              <Play /> RUN BACKTEST
            </button>
          )}
        </div>
      </header>

      <div className="ql-tape" aria-label="核心指标">
        <Metric
          label="TOTAL RETURN"
          value={metrics === undefined ? "—" : percent(metrics.totalReturn)}
          tone={metrics?.totalReturn}
        />
        <Metric
          label="CAGR"
          value={metrics === undefined ? "—" : percent(metrics.annualizedReturn)}
          tone={metrics?.annualizedReturn}
        />
        <Metric label="SHARPE" value={metrics?.sharpe.toFixed(2) ?? "—"} tone={metrics?.sharpe} />
        <Metric
          label="MAX DRAWDOWN"
          value={metrics === undefined ? "—" : percent(metrics.maxDrawdown)}
          tone={metrics?.maxDrawdown}
        />
        <Metric
          label="WIN RATE"
          value={metrics === undefined ? "—" : percent(metrics.winRate)}
          tone={metrics?.winRate === undefined ? undefined : metrics.winRate - 0.5}
        />
        <Metric
          label="BUY & HOLD"
          value={metrics === undefined ? "—" : percent(metrics.buyHoldReturn)}
          tone={metrics?.buyHoldReturn}
        />
      </div>

      <main className="ql-layout">
        <aside className="ql-control-rail">
          <div className="ql-rail-title">
            <Activity /> STRATEGY SPEC
          </div>
          <label>
            <span>FAST WINDOW</span>
            <input
              aria-label="Fast window"
              type="number"
              min="2"
              max="250"
              value={state.config.fastPeriod}
              disabled={state.running}
              onChange={(event) => quant.setConfig({ fastPeriod: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>SLOW WINDOW</span>
            <input
              aria-label="Slow window"
              type="number"
              min="3"
              max="500"
              value={state.config.slowPeriod}
              disabled={state.running}
              onChange={(event) => quant.setConfig({ slowPeriod: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>INITIAL CAPITAL</span>
            <input
              aria-label="Initial capital"
              type="number"
              min="1000"
              step="1000"
              value={state.config.initialCapital}
              disabled={state.running}
              onChange={(event) => quant.setConfig({ initialCapital: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>FEE / BPS</span>
            <input
              aria-label="Fee bps"
              type="number"
              min="0"
              max="100"
              value={state.config.feeBps}
              disabled={state.running}
              onChange={(event) => quant.setConfig({ feeBps: Number(event.target.value) })}
            />
          </label>

          <div className="ql-dataset-block">
            <div>
              <Database /> DATASET
            </div>
            <b>{state.dataset?.name ?? "—"}</b>
            <span>{bars.length.toLocaleString()} DAILY BARS</span>
            <small>{dateRange}</small>
            <small>{state.dataset?.ref.hash?.slice(0, 16) ?? "NO CONTENT HASH"}</small>
          </div>

          <div className="ql-pipeline-map">
            <PipelineNode id="01" name="SMA SIGNAL" run={state.nodes["signal"]} />
            <i />
            <PipelineNode id="02" name="LONG-ONLY BT" run={state.nodes["backtest"]} />
          </div>
        </aside>

        <div className="ql-workspace">
          <MarketChart bars={bars} signals={state.signals} />
          <EquityChart result={state.result} />
        </div>

        <TradeBlotter trades={state.result?.trades ?? []} />
      </main>

      <footer className="ql-footer">
        <span>{state.running ? "COMPUTE ACTIVE" : "SYSTEM READY"}</span>
        <div className="ql-log-stream">
          {state.logs.slice(-3).map((log) => (
            <span key={`${log.ts}-${log.message}`} className={log.level}>
              {new Date(log.ts).toLocaleTimeString("en-GB", { hour12: false })} {log.message}
            </span>
          ))}
        </div>
        <strong>{state.runDurationMs === null ? "—" : `${state.runDurationMs}ms`}</strong>
      </footer>
    </div>
  );
}

function Metric(props: { label: string; value: string; tone?: number | undefined }) {
  const tone = props.tone === undefined ? "neutral" : props.tone >= 0 ? "positive" : "negative";
  return (
    <div className={`ql-metric ${tone}`}>
      <span>{props.label}</span>
      <b>{props.value}</b>
    </div>
  );
}

function PipelineNode(props: {
  id: string;
  name: string;
  run: ReturnType<typeof quant.getSnapshot>["nodes"][string] | undefined;
}) {
  const status = props.run?.status ?? "pending";
  return (
    <div className={`ql-pipeline-node ${status}`}>
      <span>{props.id}</span>
      <div>
        <b>{props.name}</b>
        <small>{status.toUpperCase()}</small>
      </div>
      <em style={{ width: `${Math.round((props.run?.progress ?? 0) * 100)}%` }} />
    </div>
  );
}
