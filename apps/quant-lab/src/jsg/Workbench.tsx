import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button, Dialog, Select, Spinner, useRuntime } from "@bcr/react";
import {
  CalendarDays,
  ChevronDown,
  Database,
  Download,
  History,
  MoreHorizontal,
  Play,
  SlidersHorizontal,
  Square,
  Upload,
  Trash2,
  HardDrive,
  X,
} from "lucide-react";
import { ConnectionSettings, DateRangeSettings } from "./DataSource";
import { Parameters, configErrors } from "./Parameters";
import { ResultExplorer } from "./ResultExplorer";
import { Quality } from "./Quality";
import { useResearch } from "./useResearch";
import { useDataSource } from "./useDataSource";
import { dateText, DEFAULT_CONFIG } from "./model";
import { configKey, isDraftChanged, readRun, type SelectedRun } from "./session";
import { exportResearchResult } from "./data";
import { demoResearch } from "./demo";
import { StorageSettings } from "./StorageSettings";
import { withResearchFiles } from "./file-lease";
import { money, percent } from "./Orders";
import "./styles.css";

const ResearchChart = lazy(() => import("./ResearchChart"));
const timeLabel = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const sourceUrl = (value: string) => {
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
};
export function JsgWorkbench({ onBusy }: { onBusy?: (busy: boolean) => void }) {
  const services = useRuntime();
  const research = useResearch(services);
  const { state } = research;
  const source = useDataSource(services, state.dataset);
  const root = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [compact, setCompact] = useState(false),
    [parametersOpen, setParametersOpen] = useState(true);
  const [parametersSheet, setParametersSheet] = useState(false),
    [connectionOpen, setConnectionOpen] = useState(false),
    [rangeOpen, setRangeOpen] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [storageOpen, setStorageOpen] = useState(false),
    [storageBusy, setStorageBusy] = useState(false);
  const [exporting, setExporting] = useState(false),
    [comparison, setComparison] = useState<SelectedRun | null>(null),
    [comparing, setComparing] = useState(false);
  const comparisonRequest = useRef(0);
  const actionMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (
        actionMenu.current?.open &&
        event.target instanceof Node &&
        !actionMenu.current.contains(event.target)
      )
        actionMenu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        actionMenu.current?.open &&
        !document.querySelector("dialog[open]")
      ) {
        actionMenu.current.open = false;
        actionMenu.current.querySelector<HTMLElement>("summary")?.focus();
      }
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
      comparisonRequest.current++;
    };
  }, []);
  const busy = state.operation !== null || storageBusy;
  const ready =
    state.ready &&
    source.restored &&
    (source.kind === "clickhouse" ? source.dateError() === null : state.dataset !== null);
  const invalid = Object.keys(configErrors(state.draft)).length > 0;
  const selected = state.selected;
  const changed =
    isDraftChanged(state) ||
    (selected !== null &&
      source.kind === "clickhouse" &&
      (source.range.start !== dateText(selected.run.startDate) ||
        source.range.end !== dateText(selected.run.endDate) ||
        !selected.dataset.manifest.source.includes(
          `ClickHouse ${sourceUrl(source.connection.url)} / ${source.connection.database}`,
        )));
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver((entries) =>
      setCompact((entries[0]?.contentRect.width ?? 0) < 880),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    comparisonRequest.current++;
    setComparing(false);
    setComparison((value) =>
      value &&
      selected &&
      value.run.id !== selected.run.id &&
      value.run.startDate === selected.run.startDate &&
      value.run.endDate === selected.run.endDate
        ? value
        : null,
    );
  }, [selected?.run.id]);
  const execute = async () => {
    if (!ready || busy || invalid) return;
    setParametersSheet(false);
    if (source.kind === "clickhouse") {
      try {
        await source.persist();
        await research.connectAndRun(source.connection, source.range);
      } catch (error) {
        research.notice(error instanceof Error ? error.message : String(error));
      }
    } else await research.run();
  };
  const executeRef = useRef(execute);
  executeRef.current = execute;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "Enter" &&
        root.current?.getClientRects().length &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        void executeRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const exportResult = async () => {
    if (!selected || exporting) return;
    const snapshot = selected;
    if (actionMenu.current) actionMenu.current.open = false;
    setExporting(true);
    try {
      const exported = await withResearchFiles("shared", () =>
        exportResearchResult(
          services,
          snapshot.run.config,
          snapshot.dataset.manifest,
          snapshot.result,
        ),
      );
      const url = URL.createObjectURL(exported.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "jsg-research.json";
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        void exported.cleanup().catch(() => undefined);
      }, 60_000);
      research.notice(null, "已导出所选运行的完整结果");
    } catch (error) {
      research.notice(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };
  const compare = async (id: string) => {
    const request = ++comparisonRequest.current;
    if (!id) {
      setComparison(null);
      setComparing(false);
      return;
    }
    const run = state.runs.find((item) => item.id === id);
    if (!run) return;
    setComparing(true);
    try {
      const value = await readRun(services, run);
      if (comparisonRequest.current === request) setComparison(value);
    } catch (error) {
      if (comparisonRequest.current === request)
        research.notice(error instanceof Error ? error.message : String(error));
    } finally {
      if (comparisonRequest.current === request) setComparing(false);
    }
  };
  const parameterContent = (
    <Parameters
      config={state.draft}
      manifest={state.dataset?.manifest}
      onChange={research.change}
      onReset={() => research.reset(DEFAULT_CONFIG)}
      onRun={() => void execute()}
      busy={busy}
      ready={ready}
    />
  );
  const compatible = selected
    ? state.runs.filter(
        (run) =>
          run.id !== selected.run.id &&
          run.startDate === selected.run.startDate &&
          run.endDate === selected.run.endDate,
      )
    : [];
  return (
    <div ref={root} className="jsg-workspace" data-busy={busy} data-draft-changed={changed}>
      <header className="research-header">
        <div className="research-brand">
          <span className="research-eyebrow">策略研究 / JSG</span>
          <h1>行业宽度轮动</h1>
        </div>
        <div className="research-actions">
          <Button
            variant="ghost"
            aria-label="运行历史"
            disabled={state.runs.length === 0}
            onClick={() => setHistoryOpen(true)}
          >
            <History size={16} />
            <span>历史</span>
            <small>{state.runs.length || ""}</small>
          </Button>
          <Button
            variant="ghost"
            aria-label="策略参数"
            aria-expanded={compact ? parametersSheet : parametersOpen}
            onClick={() =>
              compact ? setParametersSheet(true) : setParametersOpen((value) => !value)
            }
          >
            <SlidersHorizontal size={16} />
            <span>参数</span>
          </Button>
          <details ref={actionMenu} className="research-action-menu">
            <summary aria-label="更多研究操作">
              <MoreHorizontal size={19} />
            </summary>
            <div>
              <Button
                variant="ghost"
                disabled={busy || !state.ready}
                onClick={() => {
                  if (actionMenu.current) actionMenu.current.open = false;
                  input.current?.click();
                }}
              >
                <Upload size={15} />
                导入研究数据
              </Button>
              <Button
                variant="ghost"
                disabled={!selected || exporting}
                onClick={() => void exportResult()}
              >
                {exporting ? <Spinner size="sm" /> : <Download size={15} />}导出结果
              </Button>
              <Button
                variant="ghost"
                disabled={!state.ready || busy || exporting}
                onClick={() => {
                  if (actionMenu.current) actionMenu.current.open = false;
                  setStorageOpen(true);
                }}
              >
                <HardDrive size={15} />
                数据与存储
              </Button>
            </div>
          </details>
          <Button
            className="research-run-button"
            variant="primary"
            disabled={!ready || busy || invalid}
            title="运行回测 · Ctrl / ⌘ Enter"
            onClick={() => void execute()}
          >
            <Play size={15} />
            运行回测
          </Button>
        </div>
      </header>
      <div className="research-sourcebar">
        <span className="research-eyebrow">下一次运行</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="设置研究数据"
          onClick={() => setConnectionOpen(true)}
        >
          <Database size={14} />
          <span>
            {source.kind === "clickhouse"
              ? `ClickHouse · ${source.connection.database}`
              : (state.dataset?.manifest.name ?? "选择数据源")}
          </span>
          <ChevronDown size={12} />
        </Button>
        {source.kind === "clickhouse" ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label="设置回测区间"
            onClick={() => setRangeOpen(true)}
          >
            <CalendarDays size={14} />
            <span>
              {source.range.start && source.range.end
                ? `${source.range.start} — ${source.range.end}`
                : "选择回测区间"}
            </span>
            <ChevronDown size={12} />
          </Button>
        ) : (
          <span className="research-local-range">
            <CalendarDays size={14} />
            {state.dataset
              ? `${dateText(state.dataset.manifest.startDate)} — ${dateText(state.dataset.manifest.endDate)}`
              : "尚无快照"}
          </span>
        )}
        {source.kind === "clickhouse" && source.range.refresh && (
          <span className="research-source-hint">重新获取</span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept=".json,.arrow"
        aria-label="导入 JSG 研究数据"
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length) {
            void source.useLocal().catch((error) => research.notice(String(error)));
            void research.importFiles(files);
          }
        }}
      />
      {state.error && (
        <div className="research-error-banner" role="alert">
          <span>{state.error}</span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="关闭错误提示"
            onClick={() => research.notice(null)}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      <div className="research-body" data-parameters={parametersOpen && !compact}>
        {!compact && parametersOpen && (
          <aside className="research-parameter-rail" aria-label="策略参数编辑">
            {parameterContent}
          </aside>
        )}
        <main className="research-results" aria-busy={research.selecting}>
          {selected ? (
            <div className="research-run-result" data-run-id={selected.run.id}>
              <div className="research-result-heading">
                <div>
                  <span className="research-eyebrow">
                    所选运行 · {timeLabel(selected.run.createdAt)}
                  </span>
                  <h2>{selected.run.name}</h2>
                  <p>
                    {dateText(selected.run.startDate)} — {dateText(selected.run.endDate)}
                    <span>
                      目标 {selected.run.config.stockCount} 只 · 本金 ¥
                      {money(selected.run.config.initialCapital)}
                    </span>
                  </p>
                </div>
                <div className="research-result-context">
                  <Quality manifest={selected.dataset.manifest} result={selected.result} />
                  {research.selecting && <Spinner size="sm" />}
                  {changed && <span className="research-draft-badge">待运行的修改</span>}
                </div>
              </div>
              <dl className="research-metrics" aria-label="所选运行核心指标">
                {[
                  [
                    "总收益",
                    percent(selected.result.metrics.totalReturn),
                    selected.result.metrics.totalReturn >= 0 ? "positive" : "negative",
                  ],
                  ["最大回撤", percent(selected.result.metrics.maxDrawdown), "neutral"],
                  ["Sharpe", selected.result.metrics.sharpe.toFixed(2), "neutral"],
                  ["期末资产", `¥${money(selected.result.metrics.finalEquity)}`, "neutral"],
                ].map(([label, value, tone]) => (
                  <div key={label} data-tone={tone}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="research-result-tools">
                <label>
                  对照
                  <Select
                    aria-label="选择对照运行"
                    disabled={compatible.length === 0 || comparing}
                    value={comparison?.run.id ?? ""}
                    onChange={(event) => void compare(event.currentTarget.value)}
                  >
                    <option value="">
                      {compatible.length ? "选择相同区间的运行" : "同区间再次运行后可比较"}
                    </option>
                    {compatible.toReversed().map((run) => (
                      <option key={run.id} value={run.id}>
                        {timeLabel(run.createdAt)} · 目标 {run.config.stockCount} 只 ·{" "}
                        {percent(run.metrics.totalReturn)}
                      </option>
                    ))}
                  </Select>
                </label>
                {comparing && <Spinner size="sm" />}
                {configKey(state.draft) !== configKey(selected.run.config) && (
                  <Button variant="ghost" size="sm" onClick={research.useRunConfig}>
                    使用所选运行参数
                  </Button>
                )}
              </div>
              <Suspense
                fallback={
                  <div className="research-chart-loading">
                    <Spinner />
                    正在载入图表…
                  </div>
                }
              >
                <ResearchChart
                  key={selected.run.id}
                  services={services}
                  selected={selected}
                  comparison={comparison}
                />
              </Suspense>
              <ResultExplorer
                key={selected.run.id}
                services={services}
                selected={selected}
                comparison={comparison}
              />
            </div>
          ) : (
            <div className="research-empty">
              <span className="research-eyebrow">从一次回测开始</span>
              <div className="research-empty-mark" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <h2>
                让策略的每一次调整
                <br />
                都有结果可对照。
              </h2>
              <p>
                选择数据和区间，调整目标股票数，然后运行回测。
                <br />
                净值、成交与调仓记录会保存为独立的运行。
              </p>
              <div>
                <Button
                  variant="primary"
                  disabled={!ready || busy || invalid}
                  onClick={() => void execute()}
                >
                  <Play size={15} />
                  运行首次回测
                </Button>
                <Button variant="ghost" onClick={() => setConnectionOpen(true)}>
                  选择数据源
                </Button>
              </div>
              {state.dataset && <Quality manifest={state.dataset.manifest} />}
            </div>
          )}
        </main>
      </div>
      <footer className="research-taskbar">
        <div>
          <span className="research-task-dot" data-active={busy} />
          <span role="status">
            {state.operation?.label ?? (storageBusy ? "正在整理本地数据…" : state.status)}
          </span>
        </div>
        {state.operation ? (
          <div>
            <progress
              max={1}
              value={state.operation?.progress ?? undefined}
              aria-label="研究任务进度"
            />
            <Button variant="ghost" size="sm" aria-label="取消研究任务" onClick={research.cancel}>
              <Square size={12} />
              取消
            </Button>
          </div>
        ) : (
          <span>
            {selected?.run.cached
              ? "已复用结果"
              : selected?.run.durationMs !== null && selected?.run.durationMs !== undefined
                ? `${(selected.run.durationMs / 1000).toFixed(2)} 秒`
                : "本地运行"}
            <kbd>⌘ / Ctrl ↵</kbd>
          </span>
        )}
      </footer>
      <ConnectionSettings
        source={source}
        open={connectionOpen}
        onClose={() => setConnectionOpen(false)}
        onImport={() => input.current?.click()}
        onDemo={() => void research.importFiles(demoResearch().files)}
      />
      <DateRangeSettings source={source} open={rangeOpen} onClose={() => setRangeOpen(false)} />
      <StorageSettings
        services={services}
        research={research}
        open={storageOpen}
        busy={state.operation !== null || exporting}
        onClose={() => setStorageOpen(false)}
        onWorking={setStorageBusy}
        onUse={async (dataset) => {
          await research.useDataset(dataset);
          await source.useLocal();
          setStorageOpen(false);
        }}
      />
      <Dialog
        open={parametersSheet && compact}
        onClose={() => setParametersSheet(false)}
        title="编辑策略参数"
        placement="sheet"
        className="research-parameter-sheet"
      >
        {compact && parameterContent}
      </Dialog>
      <Dialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="运行历史"
        placement="sheet"
        className="research-history-dialog"
      >
        <p className="research-dialog-lead">
          保留最近 20 次运行。选择历史只切换结果，下一次运行的参数保持当前编辑值。
        </p>
        <div className="research-history-list">
          {state.runs.toReversed().map((run) => (
            <div key={run.id} className="research-history-row">
              <button
                type="button"
                aria-pressed={selected?.run.id === run.id}
                onClick={() => {
                  setHistoryOpen(false);
                  void research.selectRun(run.id);
                }}
              >
                <span>
                  <b>{timeLabel(run.createdAt)}</b>
                  <small>
                    {dateText(run.startDate)} — {dateText(run.endDate)}
                  </small>
                  <small>
                    目标 {run.config.stockCount} 只 · 佣金 {run.config.commissionBps / 100}% · 滑点{" "}
                    {run.config.slippageBps} bps
                  </small>
                </span>
                <span>
                  <strong>{percent(run.metrics.totalReturn)}</strong>
                  <small>回撤 {percent(run.metrics.maxDrawdown)}</small>
                  {selected?.run.id === run.id && <small>当前查看</small>}
                </span>
              </button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`移除运行 ${timeLabel(run.createdAt)}`}
                disabled={busy || exporting}
                onClick={() => research.forgetRun(run.id)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
