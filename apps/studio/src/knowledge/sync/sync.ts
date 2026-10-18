import { contentOf, same } from "../session/model";
import { mergeContent } from "./merge";
import { GitHubError, type KnowledgeRemote } from "./github";
import type { KnowledgeStore } from "../session/store";
import type { SyncPhase } from "./syncFeedback";

export interface SyncSummary {
  uploaded: number;
  downloaded: number;
}

interface SyncObserver {
  onProgress?: (phase: SyncPhase) => void;
  onComplete?: (summary: SyncSummary) => void;
}

// Feedback is observational: a detached view must not interrupt a durable sync.
function notify<T>(callback: ((value: T) => void) | undefined, value: T) {
  try {
    callback?.(value);
  } catch {
    /* The store still owns completion. */
  }
}

function changedItems(before: ReturnType<typeof contentOf>, after: ReturnType<typeof contentOf>) {
  let count = 0;
  for (const field of ["notes", "collections", "attachments"] as const) {
    const left = before[field] ?? {},
      right = after[field] ?? {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
      if (!same(left[key], right[key])) count++;
  }
  if (!same(before.folders, after.folders)) count++;
  return count;
}

/** A durable receipt closes the gap between publishing remotely and committing locally. */
export async function syncKnowledge(
  store: KnowledgeStore,
  remote: KnowledgeRemote,
  beforeSync?: () => Promise<void>,
  observer: SyncObserver = {},
): Promise<"synced" | "conflicts"> {
  return store.runSync(async () => {
    notify(observer.onProgress, "saving");
    remote.useAttachments?.(store.attachments);
    await beforeSync?.();
    await store.flush();
    if (!same(remote.target, store.getSnapshot().sync.target))
      throw new Error("同步连接已变化，请重新发起同步");
    if (store.getSnapshot().conflicts.length) throw new Error("请先解决待处理冲突");
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = store.getSnapshot(),
        captured = contentOf(state);
      notify(observer.onProgress, "reading");
      const fetched = await remote.read(state.sync.base);
      let base = state.sync.base,
        baseHead = state.sync.head;
      if (state.sync.pending && (await remote.isAncestor(state.sync.pending.head, fetched.head))) {
        base = state.sync.pending.content;
        baseHead = state.sync.pending.head;
      }
      if (baseHead && !(await remote.isAncestor(baseHead, fetched.head)))
        throw new Error("远端分支历史已重写，已停止同步。请核对仓库后重新连接");
      notify(observer.onProgress, "merging");
      const merged = mergeContent(base, captured, fetched.content);
      if (merged.conflicts.length) {
        await store.integrate(fetched.content, fetched.head, base);
        notify(observer.onComplete, {
          uploaded: 0,
          downloaded: changedItems(captured, merged.content),
        });
        return "conflicts";
      }
      notify(observer.onProgress, "uploading");
      const commit = await remote.prepare(fetched, merged.content);
      if (commit !== fetched.head) {
        await store.recordPending(commit, merged.content);
        try {
          await remote.publish(fetched.head, commit);
        } catch (error) {
          if (error instanceof GitHubError && [409, 422].includes(error.status) && attempt < 2)
            continue;
          throw error;
        }
      }
      // Rebase edits made while requests were in flight onto the published snapshot.
      notify(observer.onProgress, "confirming");
      await store.integrate(merged.content, commit, captured);
      notify(observer.onComplete, {
        uploaded: changedItems(fetched.content, merged.content),
        downloaded: changedItems(captured, merged.content),
      });
      return store.getSnapshot().conflicts.length ? "conflicts" : "synced";
    }
    throw new Error("远端持续变化，请稍后同步");
  });
}
