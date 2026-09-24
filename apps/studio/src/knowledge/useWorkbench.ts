import { useEffect, useState } from "react";
import {
  WORKBENCH_KEY,
  decodeWorkbench,
  emptyWorkbench,
  visitNote,
  type WorkbenchState,
} from "./workbench";

export function useWorkbench(activeId: string | undefined) {
  const [state, setState] = useState<WorkbenchState>(() => {
    try {
      return decodeWorkbench(localStorage.getItem(WORKBENCH_KEY));
    } catch {
      return emptyWorkbench();
    }
  });
  const [error, setError] = useState("");
  useEffect(() => {
    if (activeId) setState((current) => visitNote(current, activeId));
  }, [activeId]);
  useEffect(() => {
    try {
      localStorage.setItem(WORKBENCH_KEY, JSON.stringify({ version: 1, ...state }));
      setError("");
    } catch {
      setError("无法保存标签页与收藏，本次会话仍可使用；笔记保存状态请查看编辑区。");
    }
  }, [state]);
  return { state, setState, error };
}
