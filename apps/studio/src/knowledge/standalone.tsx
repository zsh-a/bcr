import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./knowledge-entry.css";

import {
  AppUpdateProvider,
  AgentProvider,
  RuntimeActivity,
  RuntimeProvider,
  browserSettingsStorage,
  createAgentStorage,
  createBrowserCredentials,
  useRuntimeSession,
} from "@bcr/react";
import { createAgentHost } from "@bcr/agent";
import {
  createRoute,
  createRootRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { useEffect, useState, type ReactNode } from "react";
import { createRuntimeServices } from "../runtime";
import { KnowledgeApp } from "./KnowledgeApp";

/**
 * 个人知识库的独立 PWA 入口（/notes/，scope /notes/）。
 *
 * 与宿主 Studio 共享同源的 OPFS / localStorage，因此嵌入版与独立版读写同一
 * 份笔记；差别只在组合根——这里不挂 Shell / 命令面板 / 助手，只保留
 * KnowledgeApp 依赖的最小 Provider 链。SW 更新协议与 Reader 完全一致
 * （__bcrUpdateReady / bcr-update-ready / bcr-apply-update），AppUpdateProvider
 * 原样复用。
 *
 * KnowledgeApp 内部把选择硬编码导航到 `/knowledge`，路由树必须保留这个
 * path；basepath /notes 让它与宿主的 /knowledge 嵌入路由在 URL 上互不相扰。
 */

const UPDATE_READY_EVENT = "bcr-update-ready";
const APPLY_UPDATE_EVENT = "bcr-apply-update";
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1_000;
const UPDATE_CHECK_THROTTLE_MS = 60 * 1_000;

type NotesPwaWindow = Window & {
  __bcrUpdateReady?: boolean;
};

function registerNotesServiceWorker(): void {
  const viteEnv = (import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }).env;
  if (viteEnv?.PROD !== true || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker
    .register("/notes/sw.js", { scope: "/notes/", updateViaCache: "none" })
    .then((registration) => {
      const pwaWindow = window as NotesPwaWindow;
      let announcedWorker: ServiceWorker | null = null;
      let updateRequested = false;
      let reloadStarted = false;
      let lastUpdateCheck = 0;

      const activateWaitingWorker = () => {
        const waiting = registration.waiting;
        if (waiting === null) {
          if (pwaWindow.__bcrUpdateReady === true && !reloadStarted) {
            reloadStarted = true;
            window.location.reload();
          }
          return;
        }
        pwaWindow.__bcrUpdateReady = false;
        waiting.postMessage({ type: "SKIP_WAITING" });
      };

      const announceUpdate = (worker: ServiceWorker) => {
        if (worker === announcedWorker) return;
        announcedWorker = worker;
        pwaWindow.__bcrUpdateReady = true;
        window.dispatchEvent(new Event(UPDATE_READY_EVENT));
        if (updateRequested) activateWaitingWorker();
      };

      const watchInstallingWorker = (worker: ServiceWorker) => {
        const handleState = () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller !== null) {
            announceUpdate(worker);
          }
        };
        worker.addEventListener("statechange", handleState);
        handleState();
      };

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (worker !== null) watchInstallingWorker(worker);
      });
      if (registration.installing !== null) watchInstallingWorker(registration.installing);
      if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
        announceUpdate(registration.waiting);
      }

      window.addEventListener(APPLY_UPDATE_EVENT, () => {
        updateRequested = true;
        activateWaitingWorker();
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!updateRequested || reloadStarted) return;
        reloadStarted = true;
        window.location.reload();
      });

      const checkForUpdate = (force = false) => {
        if (document.visibilityState !== "visible" || navigator.onLine === false) return;
        const now = Date.now();
        if (!force && now - lastUpdateCheck < UPDATE_CHECK_THROTTLE_MS) return;
        lastUpdateCheck = now;
        void registration.update().catch(() => undefined);
      };
      window.addEventListener("online", () => checkForUpdate(true));
      document.addEventListener("visibilitychange", () => checkForUpdate());
      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      if (registration.installing === null && registration.waiting === null) {
        checkForUpdate(true);
      }
    })
    .catch(() => undefined);
}

function NotesRuntime({ children }: { children: ReactNode }) {
  const { services, error } = useRuntimeSession(createRuntimeServices);
  if (error !== null) {
    return (
      <div role="alert" className="bcr-bootstrap-error">
        笔记库启动失败：{error}
      </div>
    );
  }
  if (services === null) {
    return (
      <div className="knowledge-boot">
        <p className="font-mono text-xs text-faint">
          笔记库初始化中…（scheduler · worker pool · opfs）
        </p>
      </div>
    );
  }
  return (
    <RuntimeProvider services={services}>
      <RuntimeActivity active>{children}</RuntimeActivity>
    </RuntimeProvider>
  );
}

function NotesRoot() {
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
    <AgentProvider host={agent}>
      <NotesRuntime>
        <Outlet />
      </NotesRuntime>
    </AgentProvider>
  );
}

const rootRoute = createRootRoute({ component: NotesRoot });

const knowledgeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/knowledge",
  component: KnowledgeApp,
});

const notesRouter = createRouter({
  routeTree: rootRoute.addChildren([knowledgeRoute]),
  basepath: "/notes",
});

registerNotesServiceWorker();

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("missing #root");

createRoot(rootElement).render(
  <AppUpdateProvider>
    <RouterProvider router={notesRouter} />
  </AppUpdateProvider>,
);
