import { Context, Effect, Layer } from "effect";
import type { ArtifactRef } from "./schema";

/**
 * 架构文档 §7：缓存条目。命中后直接得到任务输出 ArtifactRef 列表。
 * SQLite 持久化版本（cache_entries 表）留待 Phase 1 后续，
 * 接口保持一致，UI 不感知 SQL（§8）。
 */
export interface CacheStore {
  readonly get: (key: string) => Effect.Effect<ReadonlyArray<ArtifactRef> | undefined>;
  readonly put: (
    key: string,
    outputs: ReadonlyArray<ArtifactRef>,
    taskId?: string,
  ) => Effect.Effect<void>;
  /** 缓存命中时把本次任务实例关联到已有 key，供跨会话 DAG 失效使用。 */
  readonly associate: (key: string, taskId: string) => Effect.Effect<void>;
  readonly remove: (key: string) => Effect.Effect<void>;
  /** 按历史任务实例删除对应缓存；任务到 key 的关联必须可持久化。 */
  readonly removeForTask: (taskId: string) => Effect.Effect<void>;
}

export class CacheStoreTag extends Context.Tag("bcr/CacheStore")<CacheStoreTag, CacheStore>() {}

export function memoryCacheStore(): Layer.Layer<CacheStoreTag> {
  return Layer.sync(CacheStoreTag, () => {
    const entries = new Map<string, ReadonlyArray<ArtifactRef>>();
    const keyByTask = new Map<string, string>();

    const removeKey = (key: string): void => {
      entries.delete(key);
      for (const [taskId, taskKey] of keyByTask) {
        if (taskKey === key) keyByTask.delete(taskId);
      }
    };

    return {
      get: (key) => Effect.sync(() => entries.get(key)),
      put: (key, outputs, taskId) =>
        Effect.sync(() => {
          entries.set(key, outputs);
          if (taskId !== undefined) keyByTask.set(taskId, key);
        }),
      associate: (key, taskId) => Effect.sync(() => void keyByTask.set(taskId, key)),
      remove: (key) => Effect.sync(() => removeKey(key)),
      removeForTask: (taskId) =>
        Effect.sync(() => {
          const key = keyByTask.get(taskId);
          if (key !== undefined) removeKey(key);
          else keyByTask.delete(taskId);
        }),
    };
  });
}
