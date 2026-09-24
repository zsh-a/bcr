import type { RuntimeMetadata } from "@bcr/core";
import { decodeState, object, validId, type KnowledgeState, type KnowledgeContent } from "./model";

export const KNOWLEDGE_KEY = "workspace/knowledge.v1";
export const KNOWLEDGE_RECORD_BACKUP_KEY = "workspace/knowledge.before-records.v1";
const PREFIX = "workspace/knowledge.records/";
const FORMAT = "bcr-knowledge-records";
const LIMIT = 32 * 1024 * 1024;
const recordKey = (section: string, id: string) => `${PREFIX}${section}/${encodeURIComponent(id)}`;
const bytes = (value: string) => new TextEncoder().encode(value).length;

/** Persisted layout is independent of the domain state and Git/ZIP formats. */
function partition(state: KnowledgeState) {
  const records = new Map<string, string>();
  const counts = new Map<string, number>();
  function put(section: string, id: string, value: unknown) {
    const count = (counts.get(section) ?? 0) + 1;
    if (count > 12000) throw new Error("知识库记录数量超过限制，未写入数据");
    counts.set(section, count);
    const key = recordKey(section, id),
      raw = JSON.stringify(value);
    if (records.has(key)) throw new Error("知识库记录身份重复，未写入数据");
    records.set(key, raw);
    return id;
  }
  function content(value: KnowledgeContent, prefix: string) {
    return {
      notes: Object.values(value.notes).map((note) => put(`${prefix}notes`, note.id, note)),
      collections: Object.values(value.collections).map((collection) =>
        put(`${prefix}collections`, collection.id, collection),
      ),
    };
  }
  const manifest = JSON.stringify({
    format: FORMAT,
    version: 3,
    commit: crypto.randomUUID(),
    state: {
      version: state.version,
      ...content(state, ""),
      history: state.history.map((entry) => put("history", entry.id, entry)),
      conflicts: state.conflicts.map((entry, index) => put("conflicts", String(index), entry)),
      sync: {
        ...state.sync,
        base: content(state.sync.base, "base/"),
        pending: state.sync.pending
          ? {
              head: state.sync.pending.head,
              content: content(state.sync.pending.content, "pending/"),
            }
          : null,
      },
    },
  });
  if (bytes(manifest) + [...records.values()].reduce((total, raw) => total + bytes(raw), 0) > LIMIT)
    throw new Error("本地知识库超过 32 MiB 限制");
  return { records, manifest };
}

/** Only atomic-capable adapters migrate. Legacy adapters retain the single-key format. */
export class KnowledgePersistence {
  private records = new Map<string, string>();
  private root: string | undefined;
  private partitioned = false;
  constructor(private readonly metadata: RuntimeMetadata) {}

  async load(): Promise<KnowledgeState> {
    const raw = await this.metadata.get(KNOWLEDGE_KEY);
    if (raw !== undefined && bytes(raw) > LIMIT) throw new Error("本地知识库超过 32 MiB 限制");
    const manifest = raw === undefined ? null : object(JSON.parse(raw));
    if (manifest?.version !== 3) {
      const state = decodeState(raw);
      this.root = raw;
      this.records = new Map();
      this.partitioned = false;
      return state;
    }
    if (manifest.format !== FORMAT || !validId(manifest.commit))
      throw new Error("知识库分记录格式不支持，原数据已保留");
    if (!this.metadata.batch)
      throw new Error("当前存储不支持知识库原子批量写入，请使用新版运行环境");
    const shape = object(manifest.state),
      sync = object(shape.sync);
    const records = new Map<string, string>();
    let total = bytes(raw!);
    function ids(value: unknown, strict: boolean): string[] {
      if (
        !Array.isArray(value) ||
        value.length > 12000 ||
        value.some((id) => typeof id !== "string" || id.length > 100 || (strict && !validId(id))) ||
        new Set(value).size !== value.length
      )
        throw new Error("知识库记录清单无效，原数据已保留");
      return value as string[];
    }
    const read = async (section: string, id: string) => {
      const key = recordKey(section, id),
        value = await this.metadata.get(key);
      if (value === undefined)
        throw new Error(`知识库记录缺失：${section}/${id}；已停止加载，未覆盖数据`);
      total += bytes(value);
      if (total > LIMIT) throw new Error("本地知识库超过 32 MiB 限制");
      records.set(key, value);
      return object(JSON.parse(value));
    };
    const content = async (value: unknown, prefix: string) => {
      const c = object(value),
        result = { notes: {}, collections: {} } as Record<
          "notes" | "collections",
          Record<string, unknown>
        >;
      for (const field of ["notes", "collections"] as const) {
        for (const id of ids(c[field], true)) {
          const entity = await read(`${prefix}${field}`, id);
          if (entity.id !== id) throw new Error("知识库记录身份不一致");
          result[field][id] = entity;
        }
      }
      return result;
    };
    const history = [];
    for (const id of ids(shape.history, false)) {
      const entry = await read("history", id);
      if (entry.id !== id) throw new Error("知识库历史身份不一致");
      history.push(entry);
    }
    const conflicts = [];
    for (const id of ids(shape.conflicts, false)) {
      if (!/^\d+$/u.test(id)) throw new Error("知识库冲突记录无效");
      conflicts.push(await read("conflicts", id));
    }
    const pending = sync.pending === null ? null : object(sync.pending);
    const state = decodeState(
      JSON.stringify({
        version: shape.version,
        ...(await content(shape, "")),
        history,
        conflicts,
        sync: {
          ...sync,
          base: await content(sync.base, "base/"),
          pending: pending
            ? { head: pending.head, content: await content(pending.content, "pending/") }
            : null,
        },
      }),
    );
    if ((await this.metadata.get(KNOWLEDGE_KEY)) !== raw)
      throw new Error("读取期间知识库已变化，请重新加载，未覆盖数据");
    this.root = raw;
    this.records = records;
    this.partitioned = true;
    return state;
  }

  async save(state: KnowledgeState): Promise<void> {
    if (!this.metadata.batch) {
      const raw = JSON.stringify(state);
      await this.metadata.set(KNOWLEDGE_KEY, raw);
      this.root = raw;
      return;
    }
    // Detect a competing Store before constructing its write set. The application
    // owns one Store per runtime; this is a stale-writer guard, not cross-tab CAS.
    if ((await this.metadata.get(KNOWLEDGE_KEY)) !== this.root)
      throw new Error("知识库持久化状态已变化，请重新加载后重试");
    const { records, manifest } = partition(state);
    const writes: [string, string | undefined][] = [];
    if (
      !this.partitioned &&
      this.root !== undefined &&
      (await this.metadata.get(KNOWLEDGE_RECORD_BACKUP_KEY)) === undefined
    )
      writes.push([KNOWLEDGE_RECORD_BACKUP_KEY, this.root]);
    for (const [key, raw] of records) if (this.records.get(key) !== raw) writes.push([key, raw]);
    for (const key of this.records.keys()) if (!records.has(key)) writes.push([key, undefined]);
    // The marker prevents older clients from writing stale aggregate data.
    writes.push([KNOWLEDGE_KEY, manifest]);
    await this.metadata.batch(writes);
    this.root = manifest;
    this.records = records;
    this.partitioned = true;
  }
}
