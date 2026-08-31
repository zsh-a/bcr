import type { BinaryStore } from "@bcr/storage-opfs";

/**
 * 注入的 SQLite WASM 模块（§8 Local Project Engine 的元数据引擎）。
 *
 * 只声明本包用到的最小结构面：浏览器 / Node / 测试各自初始化
 * `@sqlite.org/sqlite-wasm` 后传入，本包不绑定其打包与加载方式。
 */
export interface RawDb {
  /** sqlite3* 句柄（oo1.DB 初始化后必存在；官方类型标记为可选，此处收窄）。 */
  readonly pointer?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec(...args: ReadonlyArray<unknown>): any;
  close(): void;
}

/** sqlite-wasm 模块的最小结构面（真实 DB 构造器签名较宽，这里只约束用法）。 */
export interface SqliteModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly oo1: { readonly DB: new (...args: any) => RawDb };
  readonly capi: {
    readonly sqlite3_deserialize: (
      db: number,
      schema: string,
      data: number,
      sizeBytes: number,
      bufferSize: number,
      flags: number,
    ) => number;
    readonly sqlite3_js_db_export: (db: number) => Uint8Array;
  };
  readonly wasm: { readonly allocFromTypedArray: (source: Uint8Array) => number };
}

/**
 * SQLite 元数据库句柄。
 *
 * 数据库本体始终是内存库；持久化 = 整库字节导出 → BinaryStore.put。
 * 元数据量级（KB～MB），整库导出开销可忽略，换来与存储层解耦——
 * 同一实现可落 OPFS、Memory 或未来的任何 BinaryStore。
 */
export interface SqliteDb {
  /** 执行写语句（INSERT / UPDATE / DDL）。 */
  readonly run: (sql: string, bind?: ReadonlyArray<unknown>) => void;
  /** 查询多行，每行为 { 列名: 值 }。 */
  readonly all: (
    sql: string,
    bind?: ReadonlyArray<unknown>,
  ) => ReadonlyArray<Record<string, unknown>>;
  /** 查询单值（首行首列），无行时 undefined。 */
  readonly value: <T = unknown>(sql: string, bind?: ReadonlyArray<unknown>) => T | undefined;
  /** 立即把整库字节写回 BinaryStore。 */
  readonly persist: () => Promise<void>;
  /** persist 后关闭连接。 */
  readonly close: () => Promise<void>;
  /** 应用级小状态（§8 settings 语义）：字符串键值。 */
  readonly kvGet: (key: string) => Promise<string | undefined>;
  readonly kvSet: (key: string, value: string) => Promise<void>;
}

export interface OpenSqliteDbOptions {
  /** 元数据库字节的存放处（浏览器传 OpfsStore，测试传 MemoryStore）。 */
  readonly store: BinaryStore;
  /** 数据库文件路径，如 "project/meta.db"。 */
  readonly path: string;
  readonly sqlite3: SqliteModule;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cache_entries (
  key        TEXT PRIMARY KEY,
  outputs    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cache_tasks (
  task_id   TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cache_tasks_key_idx ON cache_tasks(cache_key);
CREATE TABLE IF NOT EXISTS task_outputs (
  task_id     TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  PRIMARY KEY (task_id, artifact_id)
);
CREATE TABLE IF NOT EXISTS dependencies (
  task_id        TEXT NOT NULL,
  input_artifact TEXT NOT NULL,
  PRIMARY KEY (task_id, input_artifact)
);
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE */
const DESERIALIZE_FLAGS = 1 | 2;

/** 打开元数据库：已有字节则 deserialize 恢复，否则空库并建表。 */
export async function openSqliteDb(options: OpenSqliteDbOptions): Promise<SqliteDb> {
  const { store, path, sqlite3 } = options;
  const db = new sqlite3.oo1.DB(":memory:");
  const dbPointer = db.pointer;
  if (dbPointer === undefined) {
    throw new Error("sqlite3.oo1.DB not initialized (missing pointer)");
  }

  const bytes = await store.get(path);
  if (bytes !== undefined && bytes.length > 0) {
    const p = sqlite3.wasm.allocFromTypedArray(bytes);
    const rc = sqlite3.capi.sqlite3_deserialize(
      dbPointer,
      "main",
      p,
      bytes.length,
      bytes.length,
      DESERIALIZE_FLAGS,
    );
    if (rc !== 0) {
      db.close();
      throw new Error(`cannot load metadata database ${path}: sqlite3_deserialize rc=${rc}`);
    }
  }

  db.exec(SCHEMA);

  const persist = async (): Promise<void> => {
    const out = sqlite3.capi.sqlite3_js_db_export(dbPointer);
    await store.put(path, out);
  };

  return {
    run: (sql, bind) => {
      if (bind === undefined) {
        db.exec(sql);
      } else {
        db.exec({ sql, bind: [...bind] });
      }
    },
    all: (sql, bind) => {
      const rows = db.exec({
        sql,
        bind: bind === undefined ? undefined : [...bind],
        rowMode: "object",
        returnValue: "resultRows",
      });
      return (rows ?? []) as ReadonlyArray<Record<string, unknown>>;
    },
    value: <T>(sql: string, bind?: ReadonlyArray<unknown>): T | undefined => {
      const row = db.exec({
        sql,
        bind: bind === undefined ? undefined : [...bind],
        rowMode: "object",
        returnValue: "resultRows",
      }) as ReadonlyArray<Record<string, unknown>> | undefined;
      const first = row?.[0];
      if (first === undefined) return undefined;
      const column = Object.keys(first)[0];
      if (column === undefined) return undefined;
      return first[column] as T | undefined;
    },
    persist,
    close: async () => {
      await persist();
      db.close();
    },
    kvGet: async (key) => {
      const row = db.exec({
        sql: "SELECT value FROM kv WHERE key = ?",
        bind: [key],
        rowMode: "object",
        returnValue: "resultRows",
      }) as ReadonlyArray<Record<string, unknown>> | undefined;
      return row?.[0]?.["value"] as string | undefined;
    },
    kvSet: async (key, value) => {
      db.exec({
        sql: "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
        bind: [key, value],
      });
      await persist();
    },
  };
}
