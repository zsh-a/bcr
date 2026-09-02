import type { RuntimeServices } from "@bcr/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { CommandPalette } from "../components/CommandPalette";
import { TopBar } from "../components/TopBar";
import { createRuntimeServices } from "../runtime";
import { ServicesContext } from "../services";
import { studio } from "../store";
import { APPS, appIdFromPath } from "./apps";
import { Home } from "./Home";

/**
 * OS 式 Shell 根布局（§12：URL 即状态）：
 * - `/` 启动台、`/studio`、`/media`、`/quant`、`/markets`、`/manga`、`/documents`；浏览器前进/后退天然可用。
 * - Keep-alive：进入过的 App 常驻挂载，切走仅 display:none——
 *   worker 内任务、视频播放、字幕编辑状态全部保留。
 * - Shell 启动时初始化共享 Runtime（scheduler / worker pool / OPFS），
 *   ServicesContext 全局可用；media 的 runtime 在其 App 内首次挂载时自建。
 */
export function Shell() {
  const [services, setServices] = useState<RuntimeServices | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const active = appIdFromPath(useRouterState({ select: (s) => s.location.pathname }));
  const [visited, setVisited] = useState<ReadonlyArray<string>>(active === "home" ? [] : [active]);

  useEffect(() => {
    void createRuntimeServices().then((s) => {
      setServices(s);
      studio.log("info", "runtime ready · scheduler/worker-pool/opfs online");
    });
  }, []);

  useEffect(() => {
    if (active !== "home") {
      setVisited((list) => (list.includes(active) ? list : [...list, active]));
    }
  }, [active]);

  // ⌘K 命令面板；Alt+0 主页 / Alt+数字 切 App（⌘+数字被浏览器标签页占用）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.altKey && event.code === "Digit0") {
        event.preventDefault();
        void navigate({ to: "/" });
        return;
      }
      if (event.altKey && /^Digit[1-9]$/.test(event.code)) {
        const app = APPS[Number(event.code.slice(5)) - 1];
        if (app !== undefined) {
          event.preventDefault();
          void navigate({ to: app.path });
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

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
    <ServicesContext.Provider value={services}>
      <div className="flex h-full flex-col">
        <TopBar active={active} onOpenPalette={() => setPaletteOpen(true)} />
        <div className="min-h-0 flex-1">
          {active === "home" && <Home />}
          {APPS.filter((app) => visited.includes(app.id)).map((app) => (
            <div key={app.id} className={app.id === active ? "h-full min-h-0" : "hidden"}>
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <p className="font-mono text-[11px] text-faint">{app.title} 加载中…</p>
                  </div>
                }
              >
                <app.component />
              </Suspense>
            </div>
          ))}
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </ServicesContext.Provider>
  );
}
