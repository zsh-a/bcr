import { CacheStoreTag, type CacheStore, type ArtifactRef } from "@bcr/core";
import { Effect, Layer } from "effect";
import type { SqliteDb } from "./db";

/**
 * SQLite 版 CacheStore（§7 Content-Addressed Cache 的持久化半边）。
 *
 * 与 memoryCacheStore 接口一致，UI / Scheduler 不感知 SQL（§8）：
 * 刷新浏览器 / 重开项目后缓存条目仍在，命中即不重算。
 */
export function sqliteCacheStore(db: SqliteDb): Layer.Layer<CacheStoreTag> {
  return Layer.succeed(CacheStoreTag, {
    get: (key) =>
      Effect.sync(() => {
        try {
          const outputs = db.value<string>("SELECT outputs FROM cache_entries WHERE key = ?", [
            key,
          ]);
          return outputs === undefined ? undefined : (JSON.parse(outputs) as ArtifactRef[]);
        } catch {
          // 条目损坏按未命中处理，不阻塞任务执行
          return undefined;
        }
      }),
    put: (key, outputs) =>
      Effect.promise(async () => {
        db.run("INSERT OR REPLACE INTO cache_entries (key, outputs, created_at) VALUES (?, ?, ?)", [
          key,
          JSON.stringify(outputs),
          Date.now(),
        ]);
        await db.persist();
      }),
    remove: (key) =>
      Effect.promise(async () => {
        db.run("DELETE FROM cache_entries WHERE key = ?", [key]);
        await db.persist();
      }),
  } satisfies CacheStore);
}
