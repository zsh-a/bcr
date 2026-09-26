import { preparePwaAssets, registerPwaWorker } from "../pwa/register";
import { captureInstallPrompt } from "../pwa/install";
import { InstallControl } from "../pwa/InstallControl";
import { pwaForApp } from "../pwa/apps";
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
        <div className="notes-standalone-frame">
          <div className="notes-standalone-toolbar">
            <span>BCR 笔记</span>
            <InstallControl app={pwaForApp("knowledge")!} />
          </div>
          <div className="notes-standalone-content">
            <Outlet />
          </div>
        </div>
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

registerPwaWorker("/notes/sw.js", "/notes/");
captureInstallPrompt();

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("missing #root");

const root = createRoot(rootElement);
void preparePwaAssets()
  .then(() => {
    root.render(
      <AppUpdateProvider>
        <RouterProvider router={notesRouter} />
      </AppUpdateProvider>,
    );
  })
  .catch((reason: unknown) => {
    root.render(
      <p role="alert">
        笔记库启动失败：{reason instanceof Error ? reason.message : String(reason)}
      </p>,
    );
  });
