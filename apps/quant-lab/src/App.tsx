import { RuntimeProvider, useRuntime, type RuntimeServices } from "@bcr/react";
import { Activity, Database, Download, Play, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EquityChart, MarketChart } from "./components/Charts";
import { TradeBlotter } from "./components/TradeBlotter";
import { cancelStrategy, runStrategy } from "./pipeline";
import {
  createRuntimeServices,
  importMarketDataset,
  loadDemoDataset,
  persistProject,
  readDatasetParquet,
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
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
      await importMarketDataset(services, file);
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
    downloadFile(new Blob([csv], { type: "text/csv" }), "quant-lab-trades.csv");
    quant.log("ok", `export · ${trades.length} trades`);
  };

  const exportParquet = async (): Promise<void> => {
    try {
      const bytes = await readDatasetParquet(services);
      const baseName = (state.dataset?.name ?? "quant-market").replace(/\.(csv|parquet)$/i, "");
      downloadFile(
        new Blob([bytes.slice().buffer], { type: "application/vnd.apache.parquet" }),
        `${baseName}.parquet`,
      );
      quant.log("ok", `export · Parquet · ${formatBytes(bytes.byteLength)}`);
    } catch (error) {
      quant.log("error", `export · ${error instanceof Error ? error.message : String(error)}`);
    }
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
            accept=".csv,.parquet,text/csv,application/vnd.apache.parquet"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void importFile(file);
              event.target.value = "";
            }}
          />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={state.running}>
            <Upload /> IMPORT DATA
          </button>
          <button
            type="button"
            onClick={() => void exportParquet()}
            disabled={state.dataset?.parquetRef == null}
          >
            <Database /> PARQUET
          </button>
          <button type="button" onClick={exportTrades} disabled={state.result === null}>
            <Download /> TRADES CSV
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
            <span>{state.dataset?.columnar.rowCount.toLocaleString() ?? 0} DAILY BARS</span>
            <small>{dateRange}</small>
            <div className="ql-columnar-formats" data-columnar="ready">
              <em>ARROW {formatBytes(state.dataset?.columnar.arrowBytes ?? 0)}</em>
              <em>PARQUET {formatBytes(state.dataset?.columnar.parquetBytes ?? 0)}</em>
            </div>
            <small>{state.dataset?.columnar.engine ?? "COLUMNAR ENGINE OFFLINE"}</small>
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
