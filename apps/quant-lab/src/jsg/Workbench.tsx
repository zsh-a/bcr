import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Dialog, Select, Spinner, useRuntime } from "@bcr/react";
import {
  Download,
  History,
  MoreHorizontal,
  Play,
  SlidersHorizontal,
  Square,
  Upload,
  Trash2,
  HardDrive,
  FlaskConical,
  X,
} from "lucide-react";
import { RunSettings } from "./RunSettings";
import { draftChanges } from "./draft";
import { configErrors } from "./Parameters";
import { ResultExplorer } from "./ResultExplorer";
import { Quality } from "./Quality";
import { useResearch } from "./useResearch";
import { useDataSource } from "./useDataSource";
import { dateText, DEFAULT_CONFIG } from "./model";
import { readRun, type SelectedRun } from "./session";
import { exportResearchResult } from "./data";
import { demoResearch } from "./demo";
import { disposeResultReader } from "./result-reader";
import { StorageSettings } from "./StorageSettings";
import { GridSettings, GridResults } from "./GridExperiment";
import type { GridAxis } from "./grid";
import type { JsgConfig } from "./model";
import { withResearchFiles } from "./file-lease";
import { money, percent } from "./Orders";
import "./styles.css";

const timeLabel = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const compactMoney = (value: number) =>
  value >= 10000 ? `${money(value / 10000)} 万元` : `${money(value)} 元`;
export function JsgWorkbench({
  onBusy,
  strategyControl,
}: {
  onBusy?: (busy: boolean) => void;
  strategyControl?: ReactNode;
}) {
  const services = useRuntime();
  const research = useResearch(services);
  const { state } = research;
  const source = useDataSource(services, state.dataset);
  const root = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [settingsTab, setSettingsTab] = useState<"parameters" | "data" | "changes">("parameters"),
    [historyOpen, setHistoryOpen] = useState(false),
    [comparisonOpen, setComparisonOpen] = useState(false),
    [storageOpen, setStorageOpen] = useState(false),
    [storageBusy, setStorageBusy] = useState(false);
  const openSettings = (tab: "parameters" | "data" | "changes" = "parameters") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  const [gridOpen, setGridOpen] = useState(false),
    [gridExpanded, setGridExpanded] = useState(true);
  useEffect(() => {
    setGridExpanded(true);
  }, [state.grid?.run.id]);
  useEffect(() => {
    setGridExpanded(false);
  }, [state.selected?.run.id]);
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
      disposeResultReader();
    };
  }, []);
  const [evaluationBusy, setEvaluationBusy] = useState(false);
  const busy = state.operation !== null || storageBusy || evaluationBusy || source.testing;
  const ready =
    state.ready &&
    source.restored &&
    (source.kind === "clickhouse" ? source.dateError() === null : state.dataset !== null);
  const invalid = Object.keys(configErrors(state.draft)).length > 0;
  const selected = state.selected;
  const changes = draftChanges(state, source);
  const changed = changes.length > 0;
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
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
    setSettingsOpen(false);
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
  const executeGrid = async (configs: JsgConfig[], axes: GridAxis[]) => {
    if (!ready || busy) return;
    setGridOpen(false);
    try {
      if (source.kind === "clickhouse") {
        await source.persist();
        await research.runGrid(configs, axes, {
          connection: source.connection,
          range: source.range,
        });
      } else await research.runGrid(configs, axes);
    } catch (error) {
      research.notice(error instanceof Error ? error.message : String(error));
    }
  };
  executeRef.current = execute;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const dialog = document.querySelector("dialog[open]");
      const allowed =
        !dialog ||
        (dialog.matches(".research-settings-drawer") &&
          dialog.querySelector(".research-settings-footer button:not(:disabled)"));
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "Enter" &&
        root.current?.getClientRects().length &&
        allowed
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
          snapshot.dataset.snapshot,
          snapshot.run,
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
  const closeSettings = () => {
    source.cancelInspect();
    setSettingsOpen(false);
    if (source.dateError() === null)
      void source.persist().catch((error) => research.notice(String(error)));
  };
  const restoreSettings = async () => {
    if (!selected) return;
    await research.useDataset(selected.dataset);
    research.reset(selected.run.config);
    const request = selected.dataset.snapshot?.request;
    if (request) {
      const sameServer =
        source.connection.url === request.url && source.connection.user === request.user;
      source.choose("clickhouse");
      source.updateConnection({
        url: request.url,
        database: request.database,
        user: request.user,
        password: sameServer ? source.connection.password : "",
      });
      source.updateRange({
        start: request.start,
        end: request.end,
        strictPit: request.strictPit,
        refresh: false,
      });
      await source.persist();
    } else await source.useLocal();
  };
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
          <h1 className="sr-only">行业宽度轮动</h1>
          {strategyControl ?? <span>行业宽度轮动</span>}
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
            className="research-settings-trigger"
            aria-label="运行设置"
            aria-expanded={settingsOpen}
            onClick={() => openSettings()}
          >
            <SlidersHorizontal size={16} />
            <span>运行设置</span>
            {changed && <small className="research-change-count">{changes.length}</small>}
          </Button>
          <details ref={actionMenu} className="research-action-menu">
            <summary aria-label="更多研究操作">
              <MoreHorizontal size={19} />
            </summary>
            <div>
              <Button
                className="research-menu-history"
                variant="ghost"
                disabled={!state.runs.length}
                onClick={() => {
                  if (actionMenu.current) actionMenu.current.open = false;
                  setHistoryOpen(true);
                }}
              >
                <History size={15} />
                运行历史
              </Button>
              <Button
                variant="ghost"
                disabled={!ready || busy || invalid}
                onClick={() => {
                  if (actionMenu.current) actionMenu.current.open = false;
                  setGridOpen(true);
                }}
              >
                <FlaskConical size={15} />
                参数实验
              </Button>
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
          {state.operation ? (
            <Button
              key="cancel"
              className="research-run-button"
              variant="default"
              aria-label="取消研究任务"
              onClick={research.cancel}
            >
              <Square size={14} />
              <span>取消</span>
            </Button>
          ) : (
            <Button
              key="run"
              className="research-run-button"
              aria-label="运行回测"
              variant="primary"
              disabled={!ready || busy || invalid}
              title="运行回测 · Ctrl / ⌘ Enter"
              onClick={() => void execute()}
            >
              <Play size={14} />
              <span>运行回测</span>
            </Button>
          )}
        </div>
      </header>
      <div className="research-status" role="status" aria-live="polite" data-active={busy}>
        <span className="research-task-dot" data-active={busy} />
        <span>
          {state.operation?.label ??
            (source.testing
              ? "正在测试数据连接…"
              : storageBusy
                ? "正在整理本地数据…"
                : state.status)}
        </span>
        {state.operation && (
          <progress
            max={1}
            value={state.operation.progress ?? undefined}
            aria-label="研究任务进度"
          />
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
      <div className="research-body">
        <main className="research-results" aria-busy={research.selecting}>
          {state.grid && (
            <GridResults
              key={state.grid.run.id}
              grid={state.grid}
              busy={busy}
              expanded={gridExpanded}
              onExpand={() => setGridExpanded((value) => !value)}
              onForget={research.forgetGrid}
              onUse={research.reset}
              onView={(index) => {
                void (async () => {
                  const before = research.getSession().selected?.run.id;
                  await research.viewGridResult(index);
                  if (research.getSession().selected?.run.id !== before) setGridExpanded(false);
                })();
              }}
            />
          )}
          {selected ? (
            <div
              className="research-run-result"
              data-run-id={selected.run.id}
              hidden={!!state.grid && gridExpanded}
            >
              <div className="research-result-heading">
                <div>
                  <button
                    className="research-run-selector"
                    aria-label="选择历史运行"
                    onClick={() => setHistoryOpen(true)}
                  >
                    运行{" "}
                    {String(state.runs.findIndex((run) => run.id === selected.run.id) + 1).padStart(
                      2,
                      "0",
                    )}{" "}
                    <History size={13} />
                  </button>
                  <p>
                    {dateText(selected.run.startDate)} — {dateText(selected.run.endDate)}
                    <span>
                      {selected.run.config.stockCount} 只 ·{" "}
                      {compactMoney(selected.run.config.initialCapital)}
                    </span>
                    {selected.dataset.snapshot && (
                      <span
                        title={`获取于 ${selected.dataset.snapshot.createdAt}；源覆盖至 ${selected.dataset.snapshot.sourceLastDate ?? dateText(selected.run.endDate)}`}
                      >
                        {timeLabel(selected.run.createdAt)} ·{" "}
                        {selected.run.cached
                          ? "缓存"
                          : `${((selected.run.durationMs ?? 0) / 1000).toFixed(2)} 秒`}
                      </span>
                    )}
                  </p>
                </div>
                <div className="research-result-context">
                  <Quality manifest={selected.dataset.manifest} result={selected.result} />
                  {research.selecting && <Spinner size="sm" />}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="添加对照"
                    onClick={() => setComparisonOpen(true)}
                  >
                    {comparison ? "对照已开启" : "添加对照"}
                  </Button>
                </div>
              </div>
              <dl className="research-metrics" aria-label="所选运行核心指标">
                {[
                  [
                    "总收益",
                    percent(selected.result.metrics.totalReturn),
                    selected.result.metrics.totalReturn >= 0 ? "positive" : "negative",
                  ],
                  ["年化收益", percent(selected.result.metrics.annualizedReturn), "neutral"],
                  ["最大回撤", percent(selected.result.metrics.maxDrawdown), "neutral"],
                  ["Sharpe", selected.result.metrics.sharpe.toFixed(2), "neutral"],
                ].map(([label, value, tone]) => (
                  <div key={label} data-tone={tone}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <ResultExplorer
                services={services}
                selected={selected}
                comparison={comparison}
                connection={source.connection}
                busy={busy}
                onBenchmark={research.attachBenchmark}
                onWorking={setEvaluationBusy}
              />
            </div>
          ) : state.grid ? null : (
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
                <Button variant="ghost" onClick={() => openSettings("data")}>
                  选择数据源
                </Button>
              </div>
              {state.dataset && <Quality manifest={state.dataset.manifest} />}
            </div>
          )}
        </main>
      </div>
      <RunSettings
        open={settingsOpen}
        tab={settingsTab}
        onTab={setSettingsTab}
        onClose={closeSettings}
        source={source}
        state={state}
        changes={changes}
        busy={busy}
        ready={!!ready && !invalid}
        onChange={research.change}
        onReset={() => research.reset(DEFAULT_CONFIG)}
        onRestore={restoreSettings}
        onRun={() => void execute()}
        onImport={() => {
          setSettingsOpen(false);
          input.current?.click();
        }}
        onDemo={() => {
          setSettingsOpen(false);
          void source.useLocal().then(() => research.importFiles(demoResearch().files));
        }}
      />
      <Dialog
        open={comparisonOpen}
        onClose={() => setComparisonOpen(false)}
        title="对照运行"
        className="research-comparison-dialog"
      >
        <p className="research-dialog-lead">选择相同回测区间的运行，对比参数调整前后的表现。</p>
        <Select
          aria-label="选择对照运行"
          disabled={!compatible.length || comparing}
          value={comparison?.run.id ?? ""}
          onChange={(event) => {
            void compare(event.currentTarget.value);
            setComparisonOpen(false);
          }}
        >
          <option value="">{compatible.length ? "不使用对照" : "此区间尚无其他运行"}</option>
          {compatible.toReversed().map((run) => (
            <option key={run.id} value={run.id}>
              {timeLabel(run.createdAt)} · {run.config.stockCount} 只 ·{" "}
              {percent(run.metrics.totalReturn)}
            </option>
          ))}
        </Select>
        {!compatible.length && (
          <p className="research-help">调整参数并运行一次后，可在这里选择之前的结果。</p>
        )}
      </Dialog>
      <GridSettings
        open={gridOpen}
        base={state.draft}
        busy={busy}
        onClose={() => setGridOpen(false)}
        source={
          source.kind === "clickhouse"
            ? `ClickHouse · ${source.connection.database} · ${source.range.start} — ${source.range.end}`
            : (state.dataset?.manifest.name ?? "本地快照")
        }
        onRun={(configs, axes) => void executeGrid(configs, axes)}
      />
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
