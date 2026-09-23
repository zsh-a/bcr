import type { SearchDocument } from "@bcr/core";
import { NavigationBridge } from "./NavigationBridge";
import {
  AgentProvider,
  useAgentHost,
  useNavigation,
  RuntimeActivity,
  RuntimeProvider,
  useRuntimeSession,
} from "@bcr/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Suspense, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { CommandPalette } from "../components/CommandPalette";
import { SearchPanel } from "../components/SearchPanel";
import { TopBar } from "../components/TopBar";
import { createRuntimeServices } from "../runtime";
import { SearchBridge } from "../search-bridge";
import { appIdFromPath, LAUNCH_PAD_APPS, MANIFESTS } from "./registry";
import { Home } from "./Home";
import { ResearchCaptureBridge } from "../research/CaptureBridge";
import { PluginHost } from "./PluginHost";
import { AssistantWindow, type AssistantVisibility } from "../assistant/AssistantWindow";
import { createAgentHost } from "@bcr/agent";
import { createAgentStorage, createBrowserCredentials, browserSettingsStorage } from "@bcr/react";

/**
 * OS 式 Shell 根布局（§12：URL 即状态）：
 * - `/` 启动台，其余路由由 `MANIFESTS` 注册表定义（见 `shell/registry.ts`），
 *   浏览器前进/后退天然可用。
 * - Keep-alive：进入过的 App 常驻挂载，切走仅 display:none——
 *   worker 内任务、视频播放、字幕编辑状态全部保留。
 * - Shell 启动时初始化共享 Runtime（scheduler / worker pool / OPFS），
 *   领域计算会话继承 Host 预算；应用激活状态与计算生命周期独立。
 */
export function Shell() {
  const [agent] = useState(() =>
    createAgentHost({
      storage: createAgentStorage(),
      credentials: createBrowserCredentials(),
      settingsStorage: browserSettingsStorage("localStorage"),
    }),
  );
  useEffect(() => {
    const flush = () => {
      void agent.conversations.flush();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      agent.conversations.dispose();
    };
  }, [agent]);
  return (
    <NavigationBridge>
      <AgentProvider host={agent}>
        <ShellContent />
      </AgentProvider>
    </NavigationBridge>
  );
}

function ShellContent() {
  const { conversations } = useAgentHost();
  const navigation = useNavigation();
  const { services, error } = useRuntimeSession(createRuntimeServices);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [assistantVisibility, setAssistantVisibility] = useState<AssistantVisibility>("closed");
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = appIdFromPath(pathname);
  useLayoutEffect(() => {
    conversations.setOptions({
      workspaceId: active,
      workspaceLabel: MANIFESTS.find((app) => app.id === active)?.title ?? "工作台",
    });
  }, [active, conversations]);
  const openPanel = useCallback((id: string) => {
    if (id === "assistant") setAssistantVisibility("open");
  }, []);
  const [visited, setVisited] = useState<ReadonlyArray<string>>(active === "home" ? [] : [active]);

  useEffect(() => {
    if (active !== "home") {
      setVisited((list) => (list.includes(active) ? list : [...list, active]));
    }
  }, [active]);

  useEffect(() => {
    if (pathname !== "/assistant") return;
    openPanel("assistant");
    void navigate({ to: "/", replace: true });
  }, [pathname, navigate, openPanel]);

  // ⌘K 命令面板；Alt+0 主页 / Alt+数字 切 App（⌘+数字被浏览器标签页占用）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setAssistantVisibility((value) => (value === "open" ? "minimized" : "open"));
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen((open) => !open);
        return;
      }
      if (event.altKey && event.code === "Digit0") {
        event.preventDefault();
        void navigate({ to: "/" });
        return;
      }
      if (event.altKey && /^Digit[1-9]$/.test(event.code)) {
        // Index the launch pad, not the full registry: what the pad numbers is
        // what the shortcut opens.
        const app = LAUNCH_PAD_APPS[Number(event.code.slice(5)) - 1];
        if (app !== undefined) {
          event.preventDefault();
          if (app.kind === "panel") openPanel(app.id);
          else void navigate({ to: app.path });
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, openPanel]);

  const openSearchDocument = (document: SearchDocument): void => {
    const route = document.route;
    if (route === undefined || route.length === 0) return;
    navigation.navigate(route);
  };

  if (error !== null) return <div role="alert">Runtime 启动失败：{error}</div>;

  if (services === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-[11px] text-faint">
          runtime 初始化中…（scheduler · worker pool · opfs）
        </p>
      </div>
    );
  }

  return (
    <RuntimeProvider services={services}>
      <ResearchCaptureBridge>
        <SearchBridge services={services} />
        <PluginHost />
        <div
          className={`studio-shell-frame flex h-full flex-col ${active === "reader" ? "reader-active" : ""}`}
        >
          <TopBar
            active={active}
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenAgent={() => openPanel("assistant")}
          />
          <div className="min-h-0 flex-1">
            {active === "home" && <Home onOpenPanel={openPanel} />}
            {MANIFESTS.filter((app) => visited.includes(app.id)).map((app) => (
              <div
                key={app.id}
                className={app.id === active ? "relative isolate h-full min-h-0" : "hidden"}
              >
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <p className="font-mono text-[11px] text-faint">{app.title} 加载中…</p>
                    </div>
                  }
                >
                  <RuntimeActivity active={app.id === active}>
                    <app.component />
                  </RuntimeActivity>
                </Suspense>
              </div>
            ))}
          </div>
        </div>
        <AssistantWindow
          visibility={assistantVisibility}
          onVisibilityChange={setAssistantVisibility}
        />
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenPanel={openPanel} />
        <SearchPanel
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onNavigate={openSearchDocument}
        />
      </ResearchCaptureBridge>
    </RuntimeProvider>
  );
}
