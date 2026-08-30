import { Context, Effect, Layer } from "effect";
import type { ArtifactRef } from "./schema";

/**
 * 架构文档 §7：缓存条目。命中后直接得到任务输出 ArtifactRef 列表。
 * SQLite 持久化版本（cache_entries 表）留待 Phase 1 后续，
 * 接口保持一致，UI 不感知 SQL（§8）。
 */
export interface CacheStore {
  readonly get: (key: string) => Effect.Effect<ReadonlyArray<ArtifactRef> | undefined>;
  readonly put: (key: string, outputs: ReadonlyArray<ArtifactRef>) => Effect.Effect<void>;
  readonly remove: (key: string) => Effect.Effect<void>;
}

export class CacheStoreTag extends Context.Tag("bcr/CacheStore")<CacheStoreTag, CacheStore>() {}

export function memoryCacheStore(): Layer.Layer<CacheStoreTag> {
  return Layer.sync(CacheStoreTag, () => {
    const entries = new Map<string, ReadonlyArray<ArtifactRef>>();
    return {
      get: (key) => Effect.sync(() => entries.get(key)),
      put: (key, outputs) => Effect.sync(() => void entries.set(key, outputs)),
      remove: (key) => Effect.sync(() => void entries.delete(key)),
    };
  });
}
