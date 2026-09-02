import {
  DockviewReact,
  themeAbyss,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import { useCallback } from "react";
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

const LAYOUT_KEY = "bcr.studio.layout.v1";

const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  project: () => <ProjectPanel />,
  workspace: () => <WorkspacePanel />,
  inspector: () => <InspectorPanel />,
  storage: () => <StoragePanel />,
  tasks: () => <TasksPanel />,
  console: () => <ConsolePanel />,
};

function defaultLayout(api: DockviewApi): void {
  api.addPanel({
    id: "workspace",
    component: "workspace",
    title: "Workspace",
  });
  api.addPanel({
    id: "project",
    component: "project",
    title: "项目文件",
    position: { referencePanel: "workspace", direction: "left" },
    initialWidth: 232,
  });
  api.addPanel({
    id: "inspector",
    component: "inspector",
    title: "Inspector",
    position: { referencePanel: "workspace", direction: "right" },
    initialWidth: 304,
  });
  api.addPanel({
    id: "storage",
    component: "storage",
    title: "存储",
    position: { referencePanel: "inspector", direction: "within" },
    inactive: true,
  });
  const tasks = api.addPanel({
    id: "tasks",
    component: "tasks",
    title: "任务",
    position: { referencePanel: "workspace", direction: "below" },
    initialHeight: 176,
  });
  api.addPanel({
    id: "console",
    component: "console",
    title: "控制台",
    position: { referencePanel: "tasks", direction: "within" },
  });
  tasks.api.setActive();
}

export function resetLayout(): void {
  localStorage.removeItem(LAYOUT_KEY);
  window.location.reload();
}

export function Dock() {
  const onReady = useCallback((event: DockviewReadyEvent) => {
    const { api } = event;

    let restored = false;
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved !== null) {
      try {
        api.fromJSON(JSON.parse(saved));
        restored = true;
      } catch {
        restored = false;
      }
    }
    if (!restored) defaultLayout(api);
    // 旧版用户布局可能没有 Storage tab；补 panel 时保持当前活动面板不变。
    if (api.getPanel("storage") === undefined) {
      const reference = api.getPanel("inspector") ?? api.getPanel("workspace");
      if (reference !== undefined) {
        api.addPanel({
          id: "storage",
          component: "storage",
          title: "存储",
          position: { referencePanel: reference, direction: "within" },
          inactive: true,
        });
      }
    }

    // 布局变化 → 持久化（debounce）
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disposable = api.onDidLayoutChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
      }, 400);
    });

    // 面板被全部关闭时回到默认布局
    const onRemoved = api.onDidRemovePanel(() => {
      if (api.panels.length === 0) defaultLayout(api);
    });
    void onRemoved;

    return () => disposable.dispose();
  }, []);

  return (
    <DockviewReact
      className="studio-dock"
      theme={themeAbyss}
      components={components}
      onReady={onReady}
    />
  );
}
