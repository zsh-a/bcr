import {
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback } from "react";
import { Shell } from "./shell/Shell";

/**
 * §12：navigational state 归 TanStack Router——选择中的文件/任务放 URL，
 * 复制链接即可恢复同一个 workspace view。
 *
 * 路由只做 URL/search 状态机：`/` 启动台 · `/studio` · `/media` · `/quant`。
 * App 组件不由 Outlet 渲染，而由 Shell 的 keep-alive 容器常驻挂载（切走仅隐藏）。
 */
export interface StudioSearch {
  file?: string | undefined;
  task?: string | undefined;
}

const rootRoute = createRootRoute({ component: Shell });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
});

const studioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio",
  validateSearch: (search: Record<string, unknown>): StudioSearch => ({
    file: typeof search["file"] === "string" ? search["file"] : undefined,
    task: typeof search["task"] === "string" ? search["task"] : undefined,
  }),
  component: () => null,
});

const mediaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/media",
  component: () => null,
});

const quantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/quant",
  component: () => null,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, studioRoute, mediaRoute, quantRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function useSelection() {
  // 宽松读取 location.search：命令面板在任何路由下都可用，未匹配 /studio 时无选中项
  const search = useRouterState({ select: (s) => s.location.search }) as StudioSearch;
  const navigate = useNavigate();

  const select = useCallback(
    (patch: { file?: string | undefined; task?: string | undefined }) => {
      void navigate({
        to: "/studio",
        search: (prev: StudioSearch) => ({ ...prev, ...patch }),
        replace: true,
      });
    },
    [navigate],
  );

  return { file: search.file, task: search.task, select };
}
