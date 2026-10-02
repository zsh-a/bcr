import { Button, Spinner, WorkspaceTrigger } from "@bcr/react";
import {
  Download,
  FlaskConical,
  HardDrive,
  History,
  MoreHorizontal,
  PanelLeft,
  Play,
  SlidersHorizontal,
  Square,
  Upload,
} from "lucide-react";
import type { RefObject } from "react";
import type { ResearchController } from "../session/service";
import type { WorkbenchPanels } from "./useWorkbenchPanels";
import { StrategyPicker } from "./StrategyPicker";

export function WorkbenchToolbar({
  research,
  panels,
  actionMenu,
  changeCount,
  ready,
  busy,
  invalid,
  exporting,
  onImport,
  onExport,
  onRun,
}: {
  research: ResearchController;
  panels: WorkbenchPanels;
  actionMenu: RefObject<HTMLDetailsElement | null>;
  changeCount: number;
  ready: boolean;
  busy: boolean;
  invalid: boolean;
  exporting: boolean;
  onImport: () => void;
  onExport: () => void;
  onRun: () => void;
}) {
  const { state } = research;
  const {
    libraryOpen,
    setLibraryOpen,
    settingsOpen,
    openSettings,
    setHistoryOpen,
    setGridOpen,
    setStudyOpen,
    setStorageOpen,
  } = panels;
  const experiment = state.experiments.find((e) => e.id === state.experimentId)!;
  const project = state.projects.find((p) => p.id === experiment.projectId)!;
  const changed = changeCount > 0;
  const selected = state.selected;
  return (
    <header className="research-header">
      <WorkspaceTrigger />
      <Button
        variant="ghost"
        size="sm"
        aria-label="研究目录"
        aria-expanded={libraryOpen}
        onClick={() => setLibraryOpen((value) => !value)}
      >
        <PanelLeft size={16} />
      </Button>
      <div className="research-brand">
        <h1>Quant Lab</h1>
        <button
          type="button"
          className="research-experiment-location"
          title={`${project.name} / ${experiment.name}`}
          onClick={() => setLibraryOpen(true)}
        >
          {project.name}
          <span>/</span>
          {experiment.name}
        </button>
      </div>
      <div className="research-actions">
        <StrategyPicker value="portfolio" disabled={busy} />
        <Button
          variant="ghost"
          aria-label="运行历史"
          className="research-history-trigger"
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
          {changed && <small className="research-change-count">{changeCount}</small>}
        </Button>
        <details ref={actionMenu} className="research-action-menu">
          <summary
            aria-label="更多研究操作"
            onClick={() => {
              if (window.matchMedia("(max-width: 1100px)").matches) setLibraryOpen(false);
            }}
          >
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
              disabled={!state.dataset || busy || invalid}
              onClick={() => {
                if (actionMenu.current) actionMenu.current.open = false;
                setStudyOpen(true);
              }}
            >
              <FlaskConical size={15} />
              稳健性验证
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !state.ready}
              onClick={() => {
                if (actionMenu.current) actionMenu.current.open = false;
                onImport();
              }}
            >
              <Upload size={15} />
              导入研究数据
            </Button>
            <Button variant="ghost" disabled={!selected || exporting} onClick={() => onExport()}>
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
            onClick={() => onRun()}
          >
            <Play size={14} />
            <span>运行回测</span>
          </Button>
        )}
      </div>
    </header>
  );
}
