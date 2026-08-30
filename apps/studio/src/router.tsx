import { createRootRoute, createRoute, createRouter, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { App } from "./App";

/**
 * §12：navigational state 归 TanStack Router——选择中的文件/任务放 URL，
 * 复制链接即可恢复同一个 workspace view。
 */
export interface StudioSearch {
  file?: string | undefined;
  task?: string | undefined;
}

const rootRoute = createRootRoute({ component: App });

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>): StudioSearch => ({
    file: typeof search["file"] === "string" ? search["file"] : undefined,
    task: typeof search["task"] === "string" ? search["task"] : undefined,
  }),
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function useSelection() {
  const search = indexRoute.useSearch();
  const navigate = useNavigate();

  const select = useCallback(
    (patch: { file?: string | undefined; task?: string | undefined }) => {
      void navigate({
        to: "/",
        search: (prev: StudioSearch) => ({ ...prev, ...patch }),
        replace: true,
      });
    },
    [navigate],
  );

  return { file: search.file, task: search.task, select };
}
