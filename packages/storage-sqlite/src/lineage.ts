import type { LineageStore, LineageSnapshot } from "@bcr/core";
import { Effect } from "effect";
import type { SqliteDb } from "./db";

/**
 * SQLite 版血缘持久化（§3 血缘 / §8 Journal 语义）。
 *
 * 内存血缘（artifactStore 工作集）在每次 mutation 时写穿到 SQLite；
 * 重开项目时 load() 恢复，cancel descendants / 下游失效跨会话成立。
 */
export function sqliteLineageStore(db: SqliteDb): LineageStore {
  return {
    load: Effect.sync(() => {
      const outputs = new Map<string, string[]>();
      for (const row of db.all(
        "SELECT task_id, artifact_id FROM task_outputs ORDER BY task_id, seq",
      )) {
        const taskId = row["task_id"] as string;
        const artifactId = row["artifact_id"] as string;
        const list = outputs.get(taskId) ?? [];
        list.push(artifactId);
        outputs.set(taskId, list);
      }

      const consumers = new Map<string, string[]>();
      for (const row of db.all("SELECT task_id, input_artifact FROM dependencies")) {
        const artifactId = row["input_artifact"] as string;
        const taskId = row["task_id"] as string;
        const list = consumers.get(artifactId) ?? [];
        list.push(taskId);
        consumers.set(artifactId, list);
      }

      return { outputs, consumers } satisfies LineageSnapshot;
    }),

    recordConsumption: (taskId, inputArtifactIds) =>
      Effect.promise(async () => {
        for (const artifactId of inputArtifactIds) {
          db.run("INSERT OR IGNORE INTO dependencies (task_id, input_artifact) VALUES (?, ?)", [
            taskId,
            artifactId,
          ]);
        }
        await db.persist();
      }),

    recordProduction: (taskId, outputArtifactIds) =>
      Effect.promise(async () => {
        try {
          db.run("BEGIN");
          db.run("DELETE FROM task_outputs WHERE task_id = ?", [taskId]);
          outputArtifactIds.forEach((artifactId, seq) => {
            db.run("INSERT INTO task_outputs (task_id, artifact_id, seq) VALUES (?, ?, ?)", [
              taskId,
              artifactId,
              seq,
            ]);
          });
          db.run("COMMIT");
        } catch (error) {
          db.run("ROLLBACK");
          throw error;
        }
        await db.persist();
      }),
  };
}
