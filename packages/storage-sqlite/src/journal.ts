import {
  TaskJournalEntry as TaskJournalEntrySchema,
  TaskJournalTag,
  planTaskJournalPrune,
  reclaimTaskJournalPrune,
  type ArtifactRef,
  type TaskJournal,
  type TaskJournalEntry,
  type TaskJournalPruneOptions,
} from "@bcr/core";
import { Effect, Layer, Schema } from "effect";
import type { SqliteDb } from "./db";

const decodeEntry = Schema.decodeUnknownSync(TaskJournalEntrySchema);

/** SQLite 写穿版 TaskJournal：每次状态迁移都持久化，刷新后可安全恢复。 */
export function sqliteTaskJournal(db: SqliteDb): Layer.Layer<TaskJournalTag> {
  const persist = (mutation: () => void): Effect.Effect<void> =>
    Effect.promise(async () => {
      mutation();
      await db.persist();
    });

  const snapshot = (): ReadonlyArray<TaskJournalEntry> => {
    const entries = [];
    for (const row of db.all(
      `SELECT task_json, status, created_at, updated_at, attempts, outputs, error
       FROM task_journal
       ORDER BY created_at, task_id`,
    )) {
      try {
        const outputs = row["outputs"];
        const error = row["error"];
        entries.push(
          decodeEntry({
            task: JSON.parse(row["task_json"] as string) as unknown,
            status: row["status"],
            createdAt: row["created_at"],
            updatedAt: row["updated_at"],
            attempts: row["attempts"],
            ...(typeof outputs === "string"
              ? { outputs: JSON.parse(outputs) as ReadonlyArray<ArtifactRef> }
              : {}),
            ...(typeof error === "string" ? { error } : {}),
          }),
        );
      } catch {
        // 单条日志损坏不阻断项目打开或其余任务恢复。
      }
    }
    return entries;
  };

  const remove = (taskId: string): Effect.Effect<void> =>
    persist(() => {
      db.run("DELETE FROM task_journal WHERE task_id = ?", [taskId]);
    });

  return Layer.succeed(TaskJournalTag, {
    recordSubmitted: (task) =>
      persist(() => {
        const now = Date.now();
        db.run(
          `INSERT INTO task_journal
             (task_id, task_json, status, created_at, updated_at, attempts, outputs, error)
           VALUES (?, ?, 'queued', ?, ?, 0, NULL, NULL)
           ON CONFLICT(task_id) DO UPDATE SET
             task_json = excluded.task_json,
             status = 'queued',
             updated_at = excluded.updated_at,
             outputs = NULL,
             error = NULL`,
          [task.id, JSON.stringify(task), now, now],
        );
      }),
    recordRunning: (taskId) =>
      persist(() => {
        db.run(
          `UPDATE task_journal
           SET status = 'running', updated_at = ?, attempts = attempts + 1,
               outputs = NULL, error = NULL
           WHERE task_id = ?`,
          [Date.now(), taskId],
        );
      }),
    recordCompleted: (taskId, outputs) =>
      persist(() => {
        db.run(
          `UPDATE task_journal
           SET status = 'completed', updated_at = ?, outputs = ?, error = NULL
           WHERE task_id = ?`,
          [Date.now(), JSON.stringify(outputs), taskId],
        );
      }),
    recordFailed: (taskId, error) =>
      persist(() => {
        db.run(
          `UPDATE task_journal
           SET status = 'failed', updated_at = ?, outputs = NULL, error = ?
           WHERE task_id = ?`,
          [Date.now(), error, taskId],
        );
      }),
    recordCancelled: (taskId) =>
      persist(() => {
        db.run(
          `UPDATE task_journal
           SET status = 'cancelled', updated_at = ?, outputs = NULL, error = 'cancelled'
           WHERE task_id = ?`,
          [Date.now(), taskId],
        );
      }),
    recordBlocked: (taskId, reason) =>
      persist(() => {
        db.run(
          `UPDATE task_journal
           SET status = 'blocked', updated_at = ?, outputs = NULL, error = ?
           WHERE task_id = ?`,
          [Date.now(), reason, taskId],
        );
      }),
    entries: Effect.sync(snapshot),
    planPrune: (options?: TaskJournalPruneOptions) =>
      Effect.map(Effect.sync(snapshot), (items) => planTaskJournalPrune(items, options)),
    reclaim: (plan, options) =>
      Effect.flatMap(Effect.sync(snapshot), (items) =>
        reclaimTaskJournalPrune(plan, items, remove, options),
      ),
  } satisfies TaskJournal);
}
