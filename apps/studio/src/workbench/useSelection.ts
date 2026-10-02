import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";
import { STUDIO_MANIFEST } from "../shell/host-manifests";

export interface StudioSearch {
  file?: string | undefined;
  task?: string | undefined;
}

export function useSelection() {
  // 宽松读取 location.search：命令面板在任何路由下都可用，未匹配 /studio 时无选中项
  const search = useRouterState({ select: (s) => s.location.search }) as StudioSearch;
  const navigate = useNavigate();

  const select = useCallback(
    (patch: { file?: string | undefined; task?: string | undefined }) => {
      void navigate({
        to: STUDIO_MANIFEST.path,
        search: (prev: StudioSearch) => ({ ...prev, ...patch }),
        replace: true,
      });
    },
    [navigate],
  );

  return { file: search.file, task: search.task, select };
}
