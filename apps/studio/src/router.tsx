import { currentPwa, pwaRewrite } from "./pwa/routing";
import { createRootRoute, redirect, createRoute, createRouter } from "@tanstack/react-router";
import { Shell } from "./shell/Shell";
import { MANIFESTS } from "./shell/registry";

/**
 * §12：navigational state 归 TanStack Router——选择中的文件/任务放 URL，
 * 复制链接即可恢复同一个 workspace view。
 *
 * 路由由 `shell/registry.ts` 的各 app manifest 生成：`path` 与
 * `validateSearch` 都由 app 自己声明，新增 app 不再需要改本文件。
 * App 组件不由 Outlet 渲染，而由 Shell 的 keep-alive 容器常驻挂载（切走仅隐藏）。
 */
const rootRoute = createRootRoute({
  component: Shell,
  beforeLoad: ({ location }) => {
    if (
      currentPwa &&
      currentPwa.key !== "workspace" &&
      location.pathname.replace(/\/$/u, "") !== currentPwa.path
    ) {
      // A different tool belongs to the browser workspace, not this installed app.
      throw redirect({
        href: `${location.pathname}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
        reloadDocument: true,
      });
    }
  },
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
});

const appRoutes = MANIFESTS.map((app) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: app.path,
    ...(app.validateSearch === undefined ? {} : { validateSearch: app.validateSearch }),
    component: () => null,
  }),
);

// Compatibility URL only; the assistant is a global panel, not a workspace.
const assistantAlias = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assistant",
  component: () => null,
});
export const router = createRouter({
  ...(currentPwa ? { rewrite: pwaRewrite(currentPwa) } : {}),
  routeTree: rootRoute.addChildren([homeRoute, assistantAlias, ...appRoutes]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
