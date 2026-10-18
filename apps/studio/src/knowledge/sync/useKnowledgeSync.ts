import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { contentOf, pendingCount, same } from "../session/model";
import { GitHubKnowledge } from "./github";
import { syncKnowledge, type SyncSummary } from "./sync";
import {
  completedSyncFeedback,
  syncFailure,
  syncRetryDelay,
  type SyncFeedback,
  type SyncPhase,
} from "./syncFeedback";
import type { KnowledgeStore } from "../session/store";

/** Scheduling and feedback only; the store owns exclusive sync and durable receipts. */
export function useKnowledgeSync({
  store,
  ready,
  token,
  auto,
  active,
  paused = false,
  flush,
  setMessage,
  setPanel,
}: {
  store: KnowledgeStore;
  ready: boolean;
  token: string;
  auto: boolean;
  active: boolean;
  paused?: boolean;
  flush: () => Promise<void>;
  setMessage: (value: string) => void;
  setPanel: (value: "sync") => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const syncing = useSyncExternalStore(store.subscribeSync, store.getSyncSnapshot);
  const targetKey = state.sync.target
    ? `${state.sync.target.owner}/${state.sync.target.repo}:${state.sync.target.branch}`
    : "";
  const latest = useRef({
    ready,
    token,
    auto,
    active,
    paused,
    flush,
    setMessage,
    setPanel,
    targetKey,
  });
  latest.current = { ready, token, auto, active, paused, flush, setMessage, setPanel, targetKey };
  const gate = useRef({ attempts: 0, retryAt: 0, blocked: false, lastStartedAt: 0 });
  const [feedback, setFeedback] = useState<SyncFeedback>({
    online: navigator.onLine,
    phase: null,
    failure: null,
    retryAt: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    lastResult: null,
  });
  const onProgress = useCallback((phase: SyncPhase) => {
    setFeedback((previous) => ({ ...previous, phase }));
  }, []);
  const onConnected = useCallback(
    (summary: SyncSummary = { uploaded: 0, downloaded: 0 }) => {
      gate.current = { attempts: 0, retryAt: 0, blocked: false, lastStartedAt: Date.now() };
      setFeedback((previous) =>
        completedSyncFeedback(previous, summary, store.getSnapshot().conflicts.length),
      );
    },
    [store],
  );
  const onSyncFailure = useCallback((reason: unknown) => {
    const failure = syncFailure(reason);
    const retryAt = failure.retryable
      ? Date.now() + syncRetryDelay(gate.current.attempts++, failure.retryAfterMs)
      : null;
    gate.current.blocked = !failure.retryable;
    gate.current.retryAt = retryAt ?? 0;
    setFeedback((previous) => ({ ...previous, phase: null, failure, retryAt }));
  }, []);
  useEffect(() => {
    gate.current = { attempts: 0, retryAt: 0, blocked: false, lastStartedAt: 0 };
    setFeedback((previous) => ({
      ...previous,
      phase: null,
      failure: null,
      retryAt: null,
    }));
  }, [token, targetKey]);
  useEffect(() => {
    setFeedback((previous) => ({
      ...previous,
      lastCheckedAt: null,
      lastChangedAt: null,
      lastResult: null,
    }));
  }, [targetKey]);

  const execute = useCallback(
    async (manual: boolean) => {
      const config = latest.current;
      if (
        !manual &&
        (!config.auto || !config.active || config.paused || document.visibilityState !== "visible")
      )
        return;
      if (store.syncing || !config.ready) {
        if (manual)
          config.setMessage(
            store.syncing ? "同步正在进行，完成后状态会自动刷新" : "知识库仍在加载，请稍候再同步",
          );
        return;
      }
      const snapshot = store.getSnapshot(),
        target = snapshot.sync.target;
      if (!target || !config.token.trim()) {
        if (manual) config.setPanel("sync");
        return;
      }
      if (!navigator.onLine) {
        setFeedback((previous) => ({ ...previous, online: false }));
        if (manual) config.setMessage("已保存到本机，恢复联网后可继续同步");
        return;
      }
      if (snapshot.conflicts.length) {
        if (manual) config.setPanel("sync");
        return;
      }
      if (
        !manual &&
        (gate.current.blocked ||
          Date.now() < gate.current.retryAt ||
          Date.now() - gate.current.lastStartedAt < 2_000)
      )
        return;
      if (manual) gate.current = { attempts: 0, retryAt: 0, blocked: false, lastStartedAt: 0 };
      gate.current.lastStartedAt = Date.now();
      const current = () =>
        latest.current.token === config.token && latest.current.targetKey === config.targetKey;
      setFeedback((previous) => ({ ...previous, phase: "saving", failure: null, retryAt: null }));
      let summary: SyncSummary = { uploaded: 0, downloaded: 0 };
      try {
        const result = await syncKnowledge(
          store,
          new GitHubKnowledge(target, config.token),
          config.flush,
          {
            onProgress: (phase) => {
              if (current()) onProgress(phase);
            },
            onComplete: (value) => {
              summary = value;
            },
          },
        );
        if (!current()) return;
        onConnected(summary);
        if (manual) {
          config.setMessage(
            result === "conflicts"
              ? "发现冲突，双方版本已保留"
              : pendingCount(store.getSnapshot())
                ? "本批已同步，新修改等待下一次同步"
                : summary.uploaded || summary.downloaded
                  ? `已与 GitHub 同步 · 上传 ${summary.uploaded} 项，接收 ${summary.downloaded} 项`
                  : "已经是最新内容",
          );
          if (result === "conflicts") config.setPanel("sync");
        }
      } catch (reason) {
        if (current()) onSyncFailure(reason);
      } finally {
        if (current()) setFeedback((previous) => ({ ...previous, phase: null }));
      }
    },
    [store, onProgress, onConnected, onSyncFailure],
  );

  // Stable event handlers use current configuration without restarting on feedback renders.
  useEffect(() => {
    const trigger = () => {
      void execute(false);
    };
    const network = () => {
      setFeedback((previous) => ({ ...previous, online: navigator.onLine }));
      if (navigator.onLine) trigger();
    };
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    window.addEventListener("focus", trigger);
    document.addEventListener("visibilitychange", trigger);
    const timer = setInterval(trigger, 30_000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      window.removeEventListener("focus", trigger);
      document.removeEventListener("visibilitychange", trigger);
    };
  }, [execute]);
  useEffect(() => {
    void execute(false);
  }, [auto, active, paused, ready, token, targetKey, execute]);
  useEffect(() => {
    if (
      !auto ||
      !active ||
      paused ||
      syncing ||
      !token ||
      !state.sync.target ||
      same(contentOf(state), state.sync.base)
    )
      return;
    const timer = setTimeout(() => {
      void execute(false);
    }, 3_000);
    return () => clearTimeout(timer);
  }, [
    state.notes,
    state.collections,
    state.folders,
    state.attachments,
    state.sync.base,
    state.sync.target,
    auto,
    active,
    paused,
    token,
    syncing,
    execute,
  ]);
  useEffect(() => {
    if (!auto || !active || paused || feedback.retryAt === null) return;
    const timer = setTimeout(
      () => {
        void execute(false);
      },
      Math.max(0, feedback.retryAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [auto, active, paused, feedback.retryAt, execute]);

  const sync = useCallback(() => execute(true), [execute]);
  return {
    sync,
    syncing,
    syncFeedback: feedback,
    onConnected,
    onSyncFailure,
    onSyncProgress: onProgress,
  };
}
