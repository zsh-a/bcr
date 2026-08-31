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
    put: (key, outputs, taskId) =>
      Effect.promise(async () => {
        try {
          db.run("BEGIN");
          db.run(
            "INSERT OR REPLACE INTO cache_entries (key, outputs, created_at) VALUES (?, ?, ?)",
            [key, JSON.stringify(outputs), Date.now()],
          );
          if (taskId !== undefined) {
            db.run("INSERT OR REPLACE INTO cache_tasks (task_id, cache_key) VALUES (?, ?)", [
              taskId,
              key,
            ]);
          }
          db.run("COMMIT");
        } catch (error) {
          db.run("ROLLBACK");
          throw error;
        }
        await db.persist();
      }),
    associate: (key, taskId) =>
      Effect.promise(async () => {
        db.run("INSERT OR REPLACE INTO cache_tasks (task_id, cache_key) VALUES (?, ?)", [
          taskId,
          key,
        ]);
        await db.persist();
      }),
    remove: (key) =>
      Effect.promise(async () => {
        try {
          db.run("BEGIN");
          db.run("DELETE FROM cache_entries WHERE key = ?", [key]);
          db.run("DELETE FROM cache_tasks WHERE cache_key = ?", [key]);
          db.run("COMMIT");
        } catch (error) {
          db.run("ROLLBACK");
          throw error;
        }
        await db.persist();
      }),
    removeForTask: (taskId) =>
      Effect.promise(async () => {
        const key = db.value<string>("SELECT cache_key FROM cache_tasks WHERE task_id = ?", [
          taskId,
        ]);
        try {
          db.run("BEGIN");
          if (key !== undefined) {
            db.run("DELETE FROM cache_entries WHERE key = ?", [key]);
            db.run("DELETE FROM cache_tasks WHERE cache_key = ?", [key]);
          } else {
            db.run("DELETE FROM cache_tasks WHERE task_id = ?", [taskId]);
          }
          db.run("COMMIT");
        } catch (error) {
          db.run("ROLLBACK");
          throw error;
        }
        await db.persist();
      }),
  } satisfies CacheStore);
}
