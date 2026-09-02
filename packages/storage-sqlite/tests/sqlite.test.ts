import type { ArtifactRef, CacheStore, ComputeTask, TaskJournal } from "@bcr/core";
import { CacheStoreTag, TaskJournalTag } from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Effect } from "effect";
import initSqlite from "@sqlite.org/sqlite-wasm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  openSqliteDb,
  sqliteCacheStore,
  sqliteLineageStore,
  sqliteTaskJournal,
  type SqliteDb,
} from "../src";

const ref = (id: string, hash?: string): ArtifactRef => ({
  id,
  type: "test/data",
  storage: "memory",
  ...(hash !== undefined ? { hash } : {}),
});

let db: SqliteDb;
const store = new MemoryStore();

beforeEach(async () => {
  const sqlite3 = await initSqlite();
  db = await openSqliteDb({ store, path: "project/meta.db", sqlite3 });
});

describe("openSqliteDb (§8 元数据引擎)", () => {
  it("空库自动建表，persist 后按字节恢复（刷新模拟）", async () => {
    db.run("INSERT INTO kv (key, value) VALUES ('hello', 'world')");
    await db.close();

    const sqlite3 = await initSqlite();
    const reopened = await openSqliteDb({ store, path: "project/meta.db", sqlite3 });
    expect(await reopened.kvGet("hello")).toBe("world");
    expect(await reopened.kvGet("missing")).toBeUndefined();
    await reopened.close();
  });

  it("kv 读写 + 重开保留", async () => {
    await db.kvSet("dock", '{"layout":"8"}');
    await db.kvSet("dock", '{"layout":"9"}');
    expect(await db.kvGet("dock")).toBe('{"layout":"9"}');
    await db.close();

    const sqlite3 = await initSqlite();
    const reopened = await openSqliteDb({ store, path: "project/meta.db", sqlite3 });
    expect(await reopened.kvGet("dock")).toBe('{"layout":"9"}');
    await reopened.close();
  });
});

describe("sqliteCacheStore (§7)", () => {
  const run = <A>(f: (cache: CacheStore) => Effect.Effect<A>) =>
    Effect.runPromise(Effect.flatMap(CacheStoreTag, f).pipe(Effect.provide(sqliteCacheStore(db))));

  it("put / get / remove 与内存版接口一致", async () => {
    await run((cache) =>
      Effect.gen(function* () {
        expect(yield* cache.get("k1")).toBeUndefined();
        yield* cache.put("k1", [ref("out-1", "h-1")]);
        expect(yield* cache.get("k1")).toEqual([ref("out-1", "h-1")]);
        yield* cache.put("k1", [ref("out-2", "h-2")]);
        yield* cache.remove("k2");
        expect(yield* cache.get("k1")).toEqual([ref("out-2", "h-2")]);
        yield* cache.remove("k1");
        expect(yield* cache.get("k1")).toBeUndefined();
      }),
    );
  });

  it("缓存条目跨会话保留（刷新浏览器 → 不重算）", async () => {
    await run((cache) => cache.put("k1", [ref("out-1", "h-1")]));
    await db.close();

    const sqlite3 = await initSqlite();
    const reopened = await openSqliteDb({ store, path: "project/meta.db", sqlite3 });
    const hit = await Effect.runPromise(
      Effect.flatMap(CacheStoreTag, (cache) => cache.get("k1")).pipe(
        Effect.provide(sqliteCacheStore(reopened)),
      ),
    );
    expect(hit).toEqual([ref("out-1", "h-1")]);
    await reopened.close();
  });

  it("task → cache key 关联跨会话保留并支持失效", async () => {
    await run((cache) => cache.put("k-task", [ref("out-task", "h-task")], "task-1"));
    await db.close();

    const sqlite3 = await initSqlite();
    const reopened = await openSqliteDb({ store, path: "project/meta.db", sqlite3 });
    await Effect.runPromise(
      Effect.flatMap(CacheStoreTag, (cache) => cache.removeForTask("task-1")).pipe(
        Effect.provide(sqliteCacheStore(reopened)),
      ),
    );
    const missing = await Effect.runPromise(
      Effect.flatMap(CacheStoreTag, (cache) => cache.get("k-task")).pipe(
        Effect.provide(sqliteCacheStore(reopened)),
      ),
    );
    expect(missing).toBeUndefined();
    await reopened.close();
  });

  it("cache entries 可按数量生成计划并在重开后保持删除结果", async () => {
    const key = `retention-${Date.now()}`;
    await run((cache) => cache.put(key, [ref(`${key}-output`)]));
    const plan = await run((cache) =>
      Effect.gen(function* () {
        const entries = yield* cache.entries;
        expect(entries.some((entry) => entry.key === key)).toBe(true);
        return yield* cache.planPrune({ maxEntries: 0 });
      }),
    );
    expect(plan.candidates.map(({ key: candidateKey }) => candidateKey)).toContain(key);
    const result = await run((cache) => cache.reclaim(plan));
    expect(result.removed.map(({ key: removedKey }) => removedKey)).toContain(key);
    expect(await run((cache) => cache.get(key))).toBeUndefined();
  });
});

describe("sqliteLineageStore (§3/§8)", () => {
  it("产出/消费关系写穿并在重开后恢复", async () => {
    const lineage = sqliteLineageStore(db);
    await Effect.runPromise(lineage.recordProduction("tA", ["a1", "a2"]));
    await Effect.runPromise(lineage.recordConsumption("tB", ["a1"]));
    await Effect.runPromise(lineage.recordConsumption("tB", ["a1"])); // 幂等

    let snapshot = await Effect.runPromise(lineage.load);
    expect(snapshot.outputs.get("tA")).toEqual(["a1", "a2"]);
    expect(snapshot.consumers.get("a1")).toEqual(["tB"]);
    await db.close();

    const sqlite3 = await initSqlite();
    const reopened = await openSqliteDb({ store, path: "project/meta.db", sqlite3 });
    snapshot = await Effect.runPromise(sqliteLineageStore(reopened).load);
    expect(snapshot.outputs.get("tA")).toEqual(["a1", "a2"]);
    expect(snapshot.consumers.get("a1")).toEqual(["tB"]);
    await reopened.close();
  });

  it("recordProduction 覆盖同任务旧产出", async () => {
    const lineage = sqliteLineageStore(db);
    await Effect.runPromise(lineage.recordProduction("tA", ["a1"]));
    await Effect.runPromise(lineage.recordProduction("tA", ["a9"]));
    const snapshot = await Effect.runPromise(lineage.load);
    expect(snapshot.outputs.get("tA")).toEqual(["a9"]);
  });
});

describe("sqliteTaskJournal (崩溃恢复)", () => {
  const journalTask: ComputeTask = {
    id: "journal-cross-session",
    runtime: "js",
    operation: "test.recover",
    inputs: [ref("journal-input", "journal-input-hash")],
    outputs: [{ name: "result", type: "test/result" }],
  };

  const run = <A>(database: SqliteDb, f: (journal: TaskJournal) => Effect.Effect<A>) =>
    Effect.runPromise(
      Effect.flatMap(TaskJournalTag, f).pipe(Effect.provide(sqliteTaskJournal(database))),
    );

  it("任务历史只清理终态，并支持按数量限制保留最新记录", async () => {
    const id = `retention-${Date.now()}`;
    const old: ComputeTask = { ...journalTask, id: `${id}-old` };
    const newest: ComputeTask = { ...journalTask, id: `${id}-new` };
    await run(db, (journal) => journal.recordSubmitted(old));
    await run(db, (journal) => journal.recordFailed(old.id, "old failure"));
    await run(db, (journal) => journal.recordSubmitted(newest));
    await run(db, (journal) => journal.recordFailed(newest.id, "new failure"));

    const plan = await run(db, (journal) => journal.planPrune({ maxEntries: 1 }));
    expect(plan.activeEntries).toBe(0);
    expect(plan.candidates.map(({ entry }) => entry.task.id)).toContain(old.id);
    const result = await run(db, (journal) => journal.reclaim(plan));
    expect(result.removed.map(({ entry }) => entry.task.id)).toContain(old.id);
    expect(
      (await run(db, (journal) => journal.entries)).some((entry) => entry.task.id === old.id),
    ).toBe(false);
    expect(
      (await run(db, (journal) => journal.entries)).some((entry) => entry.task.id === newest.id),
    ).toBe(true);
  });

  it("running 快照跨会话保留，并可继续迁移到 completed", async () => {
    await run(db, (journal) =>
      journal
        .recordSubmitted(journalTask)
        .pipe(Effect.zipRight(journal.recordRunning(journalTask.id))),
    );
    await db.close();

    const sqlite3 = await initSqlite();
    const reopened = await openSqliteDb({ store, path: "project/meta.db", sqlite3 });
    let entry = (await run(reopened, (journal) => journal.entries)).find(
      ({ task }) => task.id === journalTask.id,
    );
    expect(entry).toMatchObject({ task: journalTask, status: "running", attempts: 1 });

    const output = ref("journal-output", "journal-output-hash");
    await run(reopened, (journal) => journal.recordCompleted(journalTask.id, [output]));
    entry = (await run(reopened, (journal) => journal.entries)).find(
      ({ task }) => task.id === journalTask.id,
    );
    expect(entry).toMatchObject({ status: "completed", attempts: 1, outputs: [output] });
    await reopened.close();
  });
});
