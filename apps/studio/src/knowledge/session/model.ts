import { decodeResearch, type ResearchExcerpt } from "../../research";
import { normalizeFolderPath, normalizeNotePath, assertUniquePaths } from "../notes/paths";
import { decodeAttachments, type AttachmentRecords } from "../attachments/attachmentModel";

/** 领域字段上限：decode 校验与副本命名共用，副本后缀的长度要算进上限（copyName）。 */
export const NOTE_TITLE_MAX = 500;
export const COLLECTION_NAME_MAX = 200;

/** 副本命名：留出后缀长度再截断；「保留双方」与「恢复双份」两处副本共用一套规则。 */
export function copyName(name: string, max: number, suffix: string): string {
  return `${name.slice(0, max - suffix.length)}${suffix}`;
}

export interface KnowledgeNote {
  id: string;
  title: string;
  /** Absent on legacy notes: logical path defaults to <id>.md. */
  path?: string;
  body: string;
  tags: string[];
  collectionId: string | null;
  createdAt: number;
  updatedAt: number;
  citations: ResearchExcerpt[];
}
export interface KnowledgeCollection {
  id: string;
  name: string;
}
export interface KnowledgeContent {
  notes: Record<string, KnowledgeNote>;
  collections: Record<string, KnowledgeCollection>;
  /** 显式目录（含空目录）；其余目录仍由笔记路径推导。 */
  folders: string[];
  /** Small immutable records only; file bytes live in the binary store. */
  attachments?: AttachmentRecords | undefined;
}
export interface GitTarget {
  owner: string;
  repo: string;
  branch: string;
}
export interface KnowledgeConflict {
  key: string;
  kind: "note" | "collection";
  base: KnowledgeNote | KnowledgeCollection | null;
  local: KnowledgeNote | KnowledgeCollection | null;
  remote: KnowledgeNote | KnowledgeCollection | null;
}
export interface NoteRevision {
  id: string;
  note: KnowledgeNote;
  at: number;
  reason: string;
}
export interface KnowledgeState extends KnowledgeContent {
  version: 1 | 2;
  history: NoteRevision[];
  conflicts: KnowledgeConflict[];
  sync: {
    target: GitTarget | null;
    head: string | null;
    base: KnowledgeContent;
    pending: { head: string; content: KnowledgeContent } | null;
    lastSyncedAt: number | null;
  };
}
export const emptyContent = (): KnowledgeContent => ({ notes: {}, collections: {}, folders: [] });
export const emptyKnowledge = (): KnowledgeState => ({
  version: 1,
  ...emptyContent(),
  history: [],
  conflicts: [],
  sync: { target: null, head: null, base: emptyContent(), pending: null, lastSyncedAt: null },
});
export const contentOf = (value: KnowledgeContent): KnowledgeContent => ({
  notes: value.notes,
  collections: value.collections,
  folders: [...value.folders],
  ...(value.attachments ? { attachments: value.attachments } : {}),
});
export const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/u.test(value) &&
  !Object.hasOwn(Object.prototype, value) &&
  value !== "prototype";
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("知识库数据格式无效");
  return value as Record<string, unknown>;
}
function string(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max)
    throw new Error("知识库文本无效或超过长度限制");
  return value;
}
function time(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("知识库时间无效");
  return value;
}
export function decodeNote(value: unknown): KnowledgeNote {
  const n = object(value);
  if (
    !validId(n.id) ||
    !(n.collectionId === null || validId(n.collectionId)) ||
    !Array.isArray(n.tags) ||
    n.tags.length > 100 ||
    !Array.isArray(n.citations) ||
    n.citations.length > 500
  )
    throw new Error("笔记元数据无效");
  // Reuse the existing citation validator, including local route and version checks.
  const citations = decodeResearch(
    JSON.stringify({
      version: 1,
      collections: [{ id: "knowledge", name: "引用", excerpts: n.citations }],
    }),
  ).collections[0]!.excerpts;
  return {
    id: n.id,
    title: string(n.title, NOTE_TITLE_MAX),
    ...(n.path === undefined ? {} : { path: normalizeNotePath(n.path) }),
    body: string(n.body, 500_000),
    tags: n.tags.map((tag) => string(tag, 100)),
    collectionId: n.collectionId,
    createdAt: time(n.createdAt),
    updatedAt: time(n.updatedAt),
    citations: [...citations],
  };
}
export function decodeCollection(value: unknown): KnowledgeCollection {
  const c = object(value);
  if (!validId(c.id)) throw new Error("集合身份无效");
  return { id: c.id, name: string(c.name, COLLECTION_NAME_MAX) };
}
export function decodeContent(value: unknown): KnowledgeContent {
  const v = object(value);
  const notes: KnowledgeContent["notes"] = {},
    collections: KnowledgeContent["collections"] = {};
  const entries = Object.entries(object(v.notes));
  if (entries.length > 5_000 || Object.keys(object(v.collections)).length > 1_000)
    throw new Error("知识库超过首期容量限制");
  for (const [id, raw] of entries) {
    const note = decodeNote(raw);
    if (id !== note.id) throw new Error("笔记身份不一致");
    notes[id] = note;
  }
  for (const [id, raw] of Object.entries(object(v.collections))) {
    const collection = decodeCollection(raw);
    if (id !== collection.id) throw new Error("集合身份不一致");
    collections[id] = collection;
  }
  const rawFolders = v.folders === undefined ? [] : v.folders;
  if (!Array.isArray(rawFolders) || rawFolders.length > 2_000)
    throw new Error("知识库目录清单无效");
  const folders = [...new Set(rawFolders.map((folder) => normalizeFolderPath(folder)))];
  assertUniquePaths(notes, folders);
  const attachments = decodeAttachments(v.attachments);
  return { notes, collections, folders, ...(attachments ? { attachments } : {}) };
}
export function decodeTarget(value: unknown): GitTarget {
  const t = object(value);
  const owner = string(t.owner, 100).trim(),
    repo = string(t.repo, 100).trim(),
    branch = string(t.branch, 200).trim();
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/u.test(repo) ||
    [".", ".."].includes(repo) ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch) ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))
  )
    throw new Error("请填写有效的 GitHub 用户、仓库和分支");
  return { owner: owner.toLowerCase(), repo: repo.toLowerCase(), branch };
}
export function decodeState(raw: string | undefined): KnowledgeState {
  if (raw === undefined) return emptyKnowledge();
  if (new TextEncoder().encode(raw).length > 32 * 1024 * 1024)
    throw new Error("本地知识库超过 32 MiB 限制");
  const s = object(JSON.parse(raw)),
    sync = object(s.sync);
  if (
    (s.version !== 1 && s.version !== 2) ||
    !Array.isArray(s.history) ||
    !Array.isArray(s.conflicts)
  )
    throw new Error("知识库版本不支持，原数据已保留");
  const history = s.history.map((entry) => {
    const h = object(entry);
    return {
      id: string(h.id, 100),
      note: decodeNote(h.note),
      at: time(h.at),
      reason: string(h.reason, 200),
    };
  });
  const conflicts = s.conflicts.map((entry): KnowledgeConflict => {
    const c = object(entry);
    if (!validId(c.key) || (c.kind !== "note" && c.kind !== "collection"))
      throw new Error("冲突记录无效");
    const decode = (v: unknown) => {
      if (v === null) return null;
      const entity = c.kind === "note" ? decodeNote(v) : decodeCollection(v);
      if (entity.id !== c.key) throw new Error("冲突身份不一致");
      return entity;
    };
    return {
      key: c.key,
      kind: c.kind,
      base: decode(c.base),
      local: decode(c.local),
      remote: decode(c.remote),
    };
  });
  const pending = sync.pending === null ? null : object(sync.pending);
  if (pending && decodeSha(pending.head) === null) throw new Error("待确认提交无效");
  return {
    version: s.version,
    ...decodeContent(s),
    history,
    conflicts,
    sync: {
      target: sync.target === null ? null : decodeTarget(sync.target),
      head: decodeSha(sync.head),
      base: decodeContent(sync.base),
      pending: pending
        ? { head: decodeSha(pending.head)!, content: decodeContent(pending.content) }
        : null,
      lastSyncedAt: sync.lastSyncedAt === null ? null : time(sync.lastSyncedAt),
    },
  };
}

function decodeSha(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) throw new Error("同步版本无效");
  return value;
}

/**
 * 保存路径的增量校验：只对引用变化的记录做 decodeState 级深解码，未变记录沿用
 * 上一份已校验对象——更新器一律不可变更新（引用即变更信号；React 快照语义
 * 同样依赖这条约定），于是保存不再 O(库大小) 全量重扫。
 * 输出与 `decodeState(JSON.stringify(next))` 同语义（有单测锁住）。
 */
export function decodeStateChanges(next: KnowledgeState, previous: KnowledgeState): KnowledgeState {
  if (next.version !== 1 && next.version !== 2) throw new Error("知识库版本不支持，原数据已保留");
  const pending = next.sync.pending;
  if (pending && decodeSha(pending.head) === null) throw new Error("待确认提交无效");
  return {
    version: next.version,
    ...decodeContentChanges(next, previous),
    // 历史 ≤100 条、冲突有界，照旧全量解码，换取与 decodeState 完全一致的校验面。
    history: next.history.map((entry) => ({
      id: string(entry.id, 100),
      note: decodeNote(entry.note),
      at: time(entry.at),
      reason: string(entry.reason, 200),
    })),
    conflicts: next.conflicts.map((entry): KnowledgeConflict => {
      if (!validId(entry.key) || (entry.kind !== "note" && entry.kind !== "collection"))
        throw new Error("冲突记录无效");
      const decode = (value: KnowledgeNote | KnowledgeCollection | null) => {
        if (value === null) return null;
        const entity = entry.kind === "note" ? decodeNote(value) : decodeCollection(value);
        if (entity.id !== entry.key) throw new Error("冲突身份不一致");
        return entity;
      };
      return {
        key: entry.key,
        kind: entry.kind,
        base: decode(entry.base),
        local: decode(entry.local),
        remote: decode(entry.remote),
      };
    }),
    sync: {
      target: next.sync.target === null ? null : decodeTarget(next.sync.target),
      head: decodeSha(next.sync.head),
      base: decodeContentChanges(next.sync.base, previous.sync.base),
      pending: pending
        ? {
            head: decodeSha(pending.head)!,
            content: decodeContentChanges(pending.content, previous.sync.pending?.content),
          }
        : null,
      lastSyncedAt: next.sync.lastSyncedAt === null ? null : time(next.sync.lastSyncedAt),
    },
  };
}

function decodeContentChanges(
  next: KnowledgeContent,
  previous: KnowledgeContent | undefined,
): KnowledgeContent {
  const notes: KnowledgeContent["notes"] = {},
    collections: KnowledgeContent["collections"] = {};
  if (Object.keys(next.notes).length > 5_000 || Object.keys(next.collections).length > 1_000)
    throw new Error("知识库超过首期容量限制");
  for (const [id, note] of Object.entries(next.notes)) {
    if (previous?.notes[id] === note) {
      notes[id] = note;
      continue;
    }
    const decoded = decodeNote(note);
    if (decoded.id !== id) throw new Error("笔记身份不一致");
    notes[id] = decoded;
  }
  for (const [id, collection] of Object.entries(next.collections)) {
    if (previous?.collections[id] === collection) {
      collections[id] = collection;
      continue;
    }
    const decoded = decodeCollection(collection);
    if (decoded.id !== id) throw new Error("集合身份不一致");
    collections[id] = decoded;
  }
  if (next.folders.length > 2_000) throw new Error("知识库目录清单无效");
  const folders = [...new Set(next.folders.map((folder) => normalizeFolderPath(folder)))];
  assertUniquePaths(notes, folders);
  const attachments =
    next.attachments === previous?.attachments
      ? next.attachments
      : decodeAttachments(next.attachments);
  return { notes, collections, folders, ...(attachments ? { attachments } : {}) };
}
export function newNote(title = "未命名笔记", collectionId: string | null = null): KnowledgeNote {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    body: "",
    tags: [],
    collectionId,
    createdAt: now,
    updatedAt: now,
    citations: [],
  };
}
export function pendingCount(state: KnowledgeState): number {
  let count = 0;
  for (const field of ["notes", "collections"] as const) {
    const ids = new Set([...Object.keys(state[field]), ...Object.keys(state.sync.base[field])]);
    for (const id of ids) if (!same(state[field][id], state.sync.base[field][id])) count++;
  }
  return count;
}
