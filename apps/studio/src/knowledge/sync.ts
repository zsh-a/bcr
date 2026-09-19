import { contentOf, same } from "./model";
import { mergeContent } from "./merge";
import { GitHubError, type KnowledgeRemote } from "./github";
import type { KnowledgeStore } from "./store";

/** A durable receipt closes the gap between publishing remotely and committing locally. */
export async function syncKnowledge(
  store: KnowledgeStore,
  remote: KnowledgeRemote,
): Promise<"synced" | "conflicts"> {
  if (store.syncing) throw new Error("同步正在进行");
  store.syncing = true;
  try {
    await store.flush();
    if (!same(remote.target, store.getSnapshot().sync.target))
      throw new Error("同步连接已变化，请重新发起同步");
    if (store.getSnapshot().conflicts.length) throw new Error("请先解决待处理冲突");
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = store.getSnapshot(),
        captured = contentOf(state);
      const fetched = await remote.read(state.sync.base);
      let base = state.sync.base,
        baseHead = state.sync.head;
      if (state.sync.pending && (await remote.isAncestor(state.sync.pending.head, fetched.head))) {
        base = state.sync.pending.content;
        baseHead = state.sync.pending.head;
      }
      if (baseHead && !(await remote.isAncestor(baseHead, fetched.head)))
        throw new Error("远端分支历史已重写，已停止同步。请核对仓库后重新连接");
      const merged = mergeContent(base, captured, fetched.content);
      if (merged.conflicts.length) {
        await store.integrate(fetched.content, fetched.head, base);
        return "conflicts";
      }
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
      await store.integrate(merged.content, commit, captured);
      return store.getSnapshot().conflicts.length ? "conflicts" : "synced";
    }
    throw new Error("远端持续变化，请稍后同步");
  } finally {
    store.syncing = false;
  }
}
