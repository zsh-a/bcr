import { readMarketSnapshot } from "@bcr/market-data/research/catalog";
import { EMPTY_DISPLAY_NAMES } from "@bcr/market-data/research/display-names";
import { withResearchFiles } from "@bcr/market-data/research/file-lease";
import type { JsgConfig } from "@bcr/quant-core";
import { DEFAULT_CONFIG } from "@bcr/quant-core";
import {
  Button,
  useLocationSearch,
  useNavigation,
  useRuntime,
  useRuntimeActivity,
} from "@bcr/react";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useResearchNames } from "../data/ResearchNames";
import { StorageSettings } from "../data/StorageSettings";
import { demoResearch } from "../data/demo";
import { exportResearchResult } from "../data/io";
import { useDataSource } from "../data/useDataSource";
import { GridResults, GridSettings } from "../experiments/GridExperiment";
import { ResearchLibrary } from "../experiments/ResearchLibrary";
import { ValidationResults, ValidationSettings } from "../experiments/ValidationStudy";
import type { GridAxis } from "../experiments/grid";
import { disposeResultReader } from "../results/client";
import { useResearch } from "../session/useResearch";
import { ComparisonPicker } from "./ComparisonPicker";
import { EmptyResearch } from "./EmptyResearch";
import { RunHistory } from "./RunHistory";
import { RunSettings } from "./RunSettings";
import { SelectedRunResult } from "./SelectedRunResult";
import { WorkbenchToolbar } from "./WorkbenchToolbar";
import { draftChanges } from "./draft";
import { configErrors } from "./parameter-errors";
import { useRunComparisons } from "./useRunComparisons";
import { useWorkbenchPanels } from "./useWorkbenchPanels";

export function QuantWorkbench({ onBusy }: { onBusy?: (busy: boolean) => void }) {
  const services = useRuntime();
  const research = useResearch(services);
  const { state } = research;
  const source = useDataSource(services, state.dataset);
  const active = useRuntimeActivity();
  const query = new URLSearchParams(useLocationSearch()),
    navigation = useNavigation();
  const incomingSnapshot = query.get("snapshot"),
    importedSnapshot = useRef<string | null>(null);
  const incomingDate = query.get("date");
  useEffect(() => {
    if (!incomingSnapshot) {
      importedSnapshot.current = null;
      return;
    }
    if (
      !active ||
      !state.ready ||
      !source.restored ||
      !incomingSnapshot ||
      importedSnapshot.current === incomingSnapshot
    )
      return;
    importedSnapshot.current = incomingSnapshot;
    let disposed = false;
    void readMarketSnapshot(incomingSnapshot)
      .then(async (dataset) => {
        if (disposed) return;
        await research.useDataset(dataset);
        if (disposed) return;
        await source.useLocal();
        if (disposed) return;
        await research.flush();
        if (disposed) return;
        research.notice(null, "已载入 Market 冻结快照，可调整参数后运行回测");
        navigation.navigate(
          `/quant${incomingDate && /^\d{4}-\d{2}-\d{2}$/u.test(incomingDate) ? `?date=${incomingDate}` : ""}`,
          true,
        );
      })
      .catch((error) => {
        if (!disposed) research.notice(String(error));
      });
    return () => {
      disposed = true;
    };
  }, [active, state.ready, source.restored, incomingSnapshot]);
  const root = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const panels = useWorkbenchPanels(root);
  const {
    libraryOpen,
    setLibraryOpen,
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    historyOpen,
    setHistoryOpen,
    comparisonOpen,
    setComparisonOpen,
    storageOpen,
    setStorageOpen,
    gridOpen,
    setGridOpen,
    studyOpen,
    setStudyOpen,
    openSettings,
  } = panels;
  const [storageBusy, setStorageBusy] = useState(false);
  const gridExpanded = state.view === "grid",
    studyExpanded = state.view === "study";
  const [exporting, setExporting] = useState(false);
  const comparison = useRunComparisons(research);
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
  const namedDataset = selected?.dataset ?? state.dataset;
  const names = useResearchNames(
    services,
    namedDataset,
    source.restored ? source.connection : undefined,
  );
  const draftNames =
    state.dataset?.manifestRef.id === namedDataset?.manifestRef.id
      ? names.names
      : (state.dataset?.manifest.displayNames ?? EMPTY_DISPLAY_NAMES);
  const changes = draftChanges(state, source);
  const changed = changes.length > 0;
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
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
          { ...snapshot.dataset.manifest, displayNames: names.names },
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
  return (
    <div
      ref={root}
      className="jsg-workspace"
      data-busy={busy}
      data-draft-changed={changed}
      data-library-open={libraryOpen}
    >
      <WorkbenchToolbar
        research={research}
        panels={panels}
        actionMenu={actionMenu}
        changeCount={changes.length}
        ready={!!ready}
        busy={busy}
        invalid={invalid}
        exporting={exporting}
        onImport={() => input.current?.click()}
        onExport={() => void exportResult()}
        onRun={() => void execute()}
      />
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
        {libraryOpen && (
          <button
            type="button"
            className="research-library-backdrop"
            aria-label="关闭研究目录"
            onClick={() => setLibraryOpen(false)}
          />
        )}
        {libraryOpen && (
          <ResearchLibrary
            research={research}
            busy={busy || exporting}
            onClose={() => setLibraryOpen(false)}
          />
        )}
        <main className="research-results" aria-busy={research.selecting}>
          {state.grid && state.view === "grid" && (
            <GridResults
              key={state.grid.run.id}
              grid={state.grid}
              busy={busy}
              expanded={gridExpanded}
              onExpand={() => {
                research.setView(gridExpanded ? "run" : "grid");
              }}
              onForget={research.forgetGrid}
              onUse={research.reset}
              onView={(index) => {
                void (async () => {
                  const before = research.getSession().selected?.run.id;
                  await research.viewGridResult(index);
                  if (research.getSession().selected?.run.id !== before) research.setView("run");
                })();
              }}
            />
          )}
          {state.study && state.view === "study" && (
            <ValidationResults
              services={services}
              onWorking={setEvaluationBusy}
              key={state.study.run.id}
              study={state.study}
              busy={busy}
              expanded={studyExpanded}
              onExpand={() => {
                research.setView(studyExpanded ? "run" : "study");
              }}
              onForget={research.forgetStudy}
            />
          )}
          {selected ? (
            <SelectedRunResult
              research={research}
              selected={selected}
              names={names}
              connection={source.connection}
              comparison={comparison}
              busy={busy}
              onHistory={() => setHistoryOpen(true)}
              onComparison={() => setComparisonOpen(true)}
              onDataSettings={() => openSettings("data")}
              onWorking={setEvaluationBusy}
            />
          ) : state.view !== "run" ? null : (
            <EmptyResearch
              dataset={state.dataset}
              canRun={!!ready && !busy && !invalid}
              onRun={() => void execute()}
              onDataSettings={() => openSettings("data")}
            />
          )}
        </main>
      </div>
      <RunSettings
        names={draftNames}
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
      <ComparisonPicker
        open={comparisonOpen}
        onClose={() => setComparisonOpen(false)}
        comparison={comparison}
      />
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
      <ValidationSettings
        key={`${studyOpen}-${state.dataset?.manifestRef.id}`}
        open={studyOpen}
        onClose={() => setStudyOpen(false)}
        base={state.draft}
        dataset={state.dataset}
        busy={busy}
        onRun={(request) => {
          setStudyOpen(false);
          void research.runValidation(request);
        }}
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
      <RunHistory
        research={research}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        busy={busy || exporting}
      />
    </div>
  );
}
