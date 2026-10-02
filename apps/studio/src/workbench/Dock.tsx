import { ActionMenu, Drawer, Select, WorkspaceTrigger, useMediaQuery } from "@bcr/react";
import {
  DockviewReact,
  themeAbyss,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewHeaderActionsProps,
} from "dockview-react";
import { PanelLeft } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSelection } from "./useSelection";
import { useStudio } from "../useStudio";
import { ConsolePanel } from "./ConsolePanel";
import { InspectorPanel } from "./InspectorPanel";
import { ProjectPanel } from "./ProjectPanel";
import { StoragePanel } from "./StoragePanel";
import { TasksPanel } from "./TasksPanel";
import { WorkspacePanel } from "./WorkspacePanel";

/**
 * Dockview 工作台（§12 Workspace Layout）：
 * dock / tabs / split / drag / floating / popout 全部交给 dockview，
 * 布局 JSON 持久化到 localStorage（SQLite 持久化留待 storage-sqlite 包）。
 */

const LAYOUT_KEY = "bcr.studio.layout.v2";

/** 面板最小宽高（dockview 约束）：窄容器下不塌缩，放不下的内容以溢出滚动让位。
 *  取值贴着默认布局的 initial 尺寸之下，不改变默认形态。 */
const MIN_SIZES: Record<string, { minimumWidth?: number; minimumHeight?: number }> = {
  workspace: { minimumWidth: 320, minimumHeight: 200 },
  project: { minimumWidth: 200 },
  inspector: { minimumWidth: 240 },
  storage: { minimumWidth: 240 },
  tasks: { minimumHeight: 120 },
  console: { minimumHeight: 120 },
};

const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  project: () => <ProjectPanel />,
  workspace: () => <WorkspacePanel />,
  inspector: () => <InspectorPanel />,
  storage: () => <StoragePanel />,
  tasks: () => <TasksPanel />,
  console: () => <ConsolePanel />,
};

type MobilePanel = "project" | "inspector" | "tasks" | "storage" | "console";

function defaultLayout(api: DockviewApi): void {
  api.addPanel({
    id: "workspace",
    component: "workspace",
    title: "Workspace",
    ...MIN_SIZES.workspace,
  });
  api.addPanel({
    id: "project",
    component: "project",
    title: "项目文件",
    position: { referencePanel: "workspace", direction: "left" },
    initialWidth: 232,
    ...MIN_SIZES.project,
  });
}

const PANEL_TITLES = {
  workspace: "Workspace",
  project: "项目文件",
  inspector: "详情",
  storage: "存储",
  tasks: "任务",
  console: "控制台",
};
type OptionalPanel = keyof typeof PANEL_TITLES;
const MobilePanelContext = createContext<(panel: MobilePanel) => void>(() => {});

function showPanel(api: DockviewApi, id: OptionalPanel, activate = true) {
  const existing = api.getPanel(id);
  if (existing) {
    if (activate) existing.api.setActive();
    return;
  }
  const bottom = id === "tasks" || id === "console";
  const reference =
    api.getPanel(bottom ? "tasks" : "inspector") ?? api.getPanel("workspace") ?? api.panels[0];
  if (!reference) return;
  const panel = api.addPanel({
    id,
    component: id,
    title: PANEL_TITLES[id],
    ...MIN_SIZES[id],
    position: {
      referencePanel: reference,
      direction:
        reference?.id === "workspace"
          ? bottom
            ? "below"
            : id === "project"
              ? "left"
              : "right"
          : id === "workspace"
            ? "right"
            : "within",
    },
    initialWidth: id === "project" ? 232 : 304,
    ...(bottom ? { initialHeight: 176 } : {}),
    inactive: !activate,
  });
  if (activate) panel.api.setActive();
}

function WorkspaceHeader({ panels, containerApi }: IDockviewHeaderActionsProps) {
  const openMobilePanel = useContext(MobilePanelContext);
  const [, refresh] = useState(0);
  useEffect(() => {
    const added = containerApi.onDidAddPanel(() => refresh((version) => version + 1));
    const removed = containerApi.onDidRemovePanel(() => refresh((version) => version + 1));
    return () => {
      added.dispose();
      removed.dispose();
    };
  }, [containerApi]);
  const navigationPanel = containerApi.getPanel("workspace") ?? containerApi.panels[0];
  if (!panels.some((panel) => panel === navigationPanel)) return null;
  return (
    <div className="studio-workspace-controls">
      <WorkspaceTrigger />
      <button
        type="button"
        className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg studio-panel-toggle"
        aria-label="打开工作区面板"
        onClick={() => openMobilePanel("project")}
      >
        <PanelLeft className="size-4" />
      </button>
      <ActionMenu label="工作区面板" className="studio-panel-menu">
        {Object.entries(PANEL_TITLES).map(([id, title]) => (
          <button
            type="button"
            className="ui-btn ui-btn-ghost"
            key={id}
            onClick={() => showPanel(containerApi, id as OptionalPanel)}
          >
            {title}
          </button>
        ))}
      </ActionMenu>
    </div>
  );
}

/** 持久化布局回灌前补上面板最小宽高：dockview 只在面板创建时取约束（旧布局没有这些字段）。 */
function withMinSizes<T>(layout: T): T {
  if (layout && typeof layout === "object" && "panels" in layout) {
    const panels: unknown = layout.panels;
    if (panels && typeof panels === "object")
      for (const [id, panel] of Object.entries(panels)) {
        const min = MIN_SIZES[id];
        if (min && panel && typeof panel === "object") Object.assign(panel, min);
      }
  }
  return layout;
}

export function resetLayout(): void {
  localStorage.removeItem(LAYOUT_KEY);
  window.location.reload();
}

export function Dock() {
  const [dockApi, setDockApi] = useState<DockviewApi | null>(null);
  const selection = useSelection();
  const taskCount = useStudio((state) => state.tasks.length);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null);
  const compact = useMediaQuery("(max-width: 720px)");

  const onReady = useCallback((event: DockviewReadyEvent) => {
    const { api } = event;

    let restored = false;
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved !== null) {
      try {
        api.fromJSON(withMinSizes(JSON.parse(saved)));
        restored = true;
      } catch {
        restored = false;
      }
    }
    if (!restored) defaultLayout(api);
    setDockApi(api);
  }, []);

  useEffect(() => {
    if (!dockApi) return;
    if (selection.file || selection.task) showPanel(dockApi, "inspector", false);
    if (taskCount) showPanel(dockApi, "tasks", false);
  }, [dockApi, selection.file, selection.task, taskCount]);
  useEffect(() => {
    if (!dockApi) return;
    let timer: number | undefined;
    const layout = dockApi.onDidLayoutChange(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => localStorage.setItem(LAYOUT_KEY, JSON.stringify(dockApi.toJSON())),
        400,
      );
    });
    const removed = dockApi.onDidRemovePanel(() => {
      if (!dockApi.panels.length) defaultLayout(dockApi);
    });
    return () => {
      clearTimeout(timer);
      layout.dispose();
      removed.dispose();
    };
  }, [dockApi]);
  const open = compact && mobilePanel !== null;

  return (
    <div className="studio-dock-shell">
      <MobilePanelContext value={setMobilePanel}>
        <DockviewReact
          className="studio-dock"
          theme={themeAbyss}
          prefixHeaderActionsComponent={WorkspaceHeader}
          components={components}
          onReady={onReady}
        />
      </MobilePanelContext>

      <Drawer
        open={open}
        title="工作区面板"
        onClose={() => setMobilePanel(null)}
        closeLabel="关闭工作区面板"
        className="studio-mobile-panel-surface"
      >
        <div className="studio-mobile-panel-selector">
          <Select
            aria-label="面板类型"
            value={mobilePanel ?? "project"}
            onChange={(event) => setMobilePanel(event.target.value as MobilePanel)}
          >
            {Object.entries(PANEL_TITLES)
              .filter(([id]) => id !== "workspace")
              .map(([id, title]) => (
                <option value={id} key={id}>
                  {title}
                </option>
              ))}
          </Select>
        </div>
        {open && (
          <div className="studio-mobile-panel-content">
            {mobilePanel === "project" && <ProjectPanel />}
            {mobilePanel === "inspector" && <InspectorPanel />}
            {mobilePanel === "tasks" && <TasksPanel />}
            {mobilePanel === "storage" && <StoragePanel />}
            {mobilePanel === "console" && <ConsolePanel />}
          </div>
        )}
      </Drawer>
    </div>
  );
}
