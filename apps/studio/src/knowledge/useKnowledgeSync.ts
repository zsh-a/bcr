import { useCallback, useEffect, useSyncExternalStore } from "react";
import { pendingCount } from "./model";
import { GitHubKnowledge } from "./github";
import { syncKnowledge } from "./sync";
import type { KnowledgeStore } from "./store";

/** Browser scheduling only; the store owns exclusive sync state and durable commits. */
export function useKnowledgeSync({
  store,
  ready,
  token,
  auto,
  active,
  flush,
  setError,
  setMessage,
  setPanel,
}: {
  store: KnowledgeStore;
  ready: boolean;
  token: string;
  auto: boolean;
  active: boolean;
  flush: () => Promise<void>;
  setError: (value: string) => void;
  setMessage: (value: string) => void;
  setPanel: (value: "sync") => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const syncing = useSyncExternalStore(store.subscribeSync, store.getSyncSnapshot);
  const pending = pendingCount(state);
  const sync = useCallback(async () => {
    if (!ready || store.syncing) return;
    const target = store.getSnapshot().sync.target;
    if (!target || !token.trim()) {
      setPanel("sync");
      setMessage("填写仓库地址与 Token 后即可连接并同步");
      return;
    }
    setError("");
    try {
      const result = await syncKnowledge(store, new GitHubKnowledge(target, token), flush);
      setMessage(
        result === "conflicts"
          ? "发现冲突，双方版本已保留"
          : pendingCount(store.getSnapshot())
            ? "本批已同步，新修改等待下一次同步"
            : "已与 GitHub 同步",
      );
      if (result === "conflicts") setPanel("sync");
    } catch (reason) {
      setError(String(reason));
    }
  }, [store, token, ready, flush, setError, setMessage, setPanel]);
  useEffect(() => {
    if (!auto || !token || !state.sync.target || !active) return;
    const trigger = () => {
      if (
        navigator.onLine &&
        document.visibilityState === "visible" &&
        !store.getSnapshot().conflicts.length
      )
        void sync();
    };
    window.addEventListener("online", trigger);
    window.addEventListener("focus", trigger);
    document.addEventListener("visibilitychange", trigger);
    const timer = setInterval(trigger, 30_000);
    trigger();
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", trigger);
      window.removeEventListener("focus", trigger);
      document.removeEventListener("visibilitychange", trigger);
    };
  }, [
    auto,
    token,
    state.sync.target?.owner,
    state.sync.target?.repo,
    state.sync.target?.branch,
    active,
    store,
    sync,
  ]);
  useEffect(() => {
    if (!auto || !token || !state.sync.target || !pending || state.conflicts.length || !active)
      return;
    const timer = setTimeout(() => {
      if (navigator.onLine && document.visibilityState === "visible") void sync();
    }, 3_000);
    return () => clearTimeout(timer);
  }, [
    state.notes,
    state.collections,
    pending,
    auto,
    token,
    active,
    sync,
    state.conflicts.length,
    state.sync.target,
  ]);
  return { sync, syncing };
}
