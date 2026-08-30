import type { ArtifactRef, CacheStore } from "@bcr/core";
import { CacheStoreTag } from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Effect } from "effect";
import initSqlite from "@sqlite.org/sqlite-wasm";
import { beforeEach, describe, expect, it } from "vitest";
import { openSqliteDb, sqliteCacheStore, sqliteLineageStore, type SqliteDb } from "../src";

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
