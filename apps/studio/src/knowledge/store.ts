import type { RuntimeMetadata, SearchIndex, SearchDocument } from "@bcr/core";
import { mergeContent } from "./merge";
import {
  contentOf,
  decodeNote,
  decodeState,
  decodeTarget,
  emptyKnowledge,
  same,
  type GitTarget,
  type KnowledgeContent,
  type KnowledgeState,
  type KnowledgeNote,
  type KnowledgeConflict,
} from "./model";

export const KNOWLEDGE_KEY = "workspace/knowledge.v1";
export class KnowledgeStore {
  private value = emptyKnowledge();
  private tail: Promise<unknown> = Promise.resolve();
  private reloadRequired = false;
  private closed = false;
  private listeners = new Set<() => void>();
  readonly ready: Promise<void>;
  syncing = false;
  constructor(private metadata: RuntimeMetadata | undefined) {
    this.ready = this.load();
    void this.ready.catch(() => undefined);
  }
  private async load() {
    if (!this.metadata) throw new Error("本地持久化不可用，笔记编辑已暂停");
    this.value = decodeState(await this.metadata.get(KNOWLEDGE_KEY));
    this.emit();
  }
  getSnapshot = (): KnowledgeState => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  async flush() {
    await this.ready;
    await this.tail.catch(() => undefined);
    if (this.reloadRequired) await this.update((state) => state);
  }
  async close() {
    this.closed = true;
    await this.ready.catch(() => undefined);
    await this.tail.catch(() => undefined);
  }
  update(change: (state: KnowledgeState) => KnowledgeState): Promise<void> {
    if (this.closed) return Promise.reject(new Error("知识库已关闭，草稿已保留"));
    const operation = this.tail
      .catch(() => undefined)
      .then(async () => {
        await this.ready;
        if (this.reloadRequired) {
          await this.load();
          this.reloadRequired = false;
        }
        const next = change(this.value);
        if (next === this.value) return;
        const raw = JSON.stringify(next);
        const validated = decodeState(raw);
        try {
          await this.metadata!.set(KNOWLEDGE_KEY, raw);
        } catch (error) {
          this.reloadRequired = true;
          throw error;
        }
        this.value = validated;
        this.emit();
      });
    this.tail = operation;
    return operation;
  }
  private withHistory(
    state: KnowledgeState,
    next: KnowledgeContent,
    reason: string,
  ): KnowledgeState {
    const revisions = Object.values(state.notes)
      .filter((note) => !same(note, next.notes[note.id]))
      .map((note) => ({ id: crypto.randomUUID(), note, at: Date.now(), reason }));
    return { ...state, ...next, history: [...revisions, ...state.history].slice(0, 100) };
  }
  /** The editor supplies its original snapshot; concurrent sync never silently replaces a draft. */
  saveNote(note: KnowledgeNote, base: KnowledgeNote | null): Promise<void> {
    const valid = decodeNote(note);
    return this.update((state) => {
      if (state.conflicts.some((c) => c.kind === "note" && c.key === note.id))
        throw new Error("请先解决这篇笔记的同步冲突，草稿已保留");
      const baseline = { notes: base ? { [base.id]: base } : {}, collections: {} };
      const local = { notes: { [valid.id]: valid }, collections: {} };
      const remote = {
        notes: state.notes[note.id] ? { [note.id]: state.notes[note.id]! } : {},
        collections: {},
      };
      const result = mergeContent(baseline, local, remote);
      if (same(result.content.notes[note.id], state.notes[note.id]) && !result.conflicts.length)
        return state;
      return {
        ...this.withHistory(
          state,
          { notes: { ...state.notes, ...result.content.notes }, collections: state.collections },
          "编辑前版本",
        ),
        conflicts: [...state.conflicts, ...result.conflicts],
      };
    });
  }
  deleteNote(id: string): Promise<void> {
    return this.update((state) => {
      if (state.conflicts.some((c) => c.key === id && c.kind === "note"))
        throw new Error("请先解决冲突");
      if (!state.notes[id]) return state;
      const notes = { ...state.notes };
      delete notes[id];
      return this.withHistory(state, { notes, collections: state.collections }, "删除前版本");
    });
  }
  saveCollection(id: string, name: string): Promise<void> {
    return this.update((s) => {
      if (s.conflicts.some((c) => c.kind === "collection" && c.key === id))
        throw new Error("请先解决这个集合的同步冲突");
      return {
        ...s,
        collections: { ...s.collections, [id]: { id, name: name.trim() || "未命名集合" } },
      };
    });
  }
  importContent(content: KnowledgeContent): Promise<void> {
    return this.update((state) => {
      const notes = { ...state.notes },
        collections = { ...state.collections, ...content.collections };
      for (const note of Object.values(content.notes)) if (!notes[note.id]) notes[note.id] = note;
      return { ...state, notes, collections };
    });
  }
  configure(target: GitTarget | null): Promise<void> {
    if (this.syncing) return Promise.reject(new Error("请等待本次同步结束"));
    return this.update((s) => {
      if (this.syncing) throw new Error("请等待本次同步结束");
      const next = target ? decodeTarget(target) : null;
      if (same(next, s.sync.target)) return s;
      if (s.conflicts.length) throw new Error("请先解决冲突，再更换同步仓库");
      return { ...s, sync: { ...emptyKnowledge().sync, target: next } };
    });
  }
  recordPending(head: string, content: KnowledgeContent): Promise<void> {
    return this.update((s) => ({ ...s, sync: { ...s.sync, pending: { head, content } } }));
  }
  integrate(remote: KnowledgeContent, head: string, base: KnowledgeContent): Promise<void> {
    return this.update((state) => {
      const merged = mergeContent(base, contentOf(state), remote);
      return {
        ...this.withHistory(state, merged.content, "同步前版本"),
        conflicts: merged.conflicts,
        sync: {
          ...state.sync,
          base: remote,
          head,
          pending: null,
          lastSyncedAt: Date.now(),
        },
      };
    });
  }
  resolve(conflict: KnowledgeConflict, choice: "local" | "remote" | "both"): Promise<void> {
    return this.update((state) => {
      const current = state.conflicts.find(
        (c) => c.kind === conflict.kind && c.key === conflict.key,
      );
      if (!current || !same(current, conflict)) throw new Error("冲突已变化，请重新打开");
      const notes = { ...state.notes },
        collections = { ...state.collections };
      const selected = choice === "remote" ? current.remote : current.local;
      const map = current.kind === "note" ? notes : collections;
      if (selected) Object.assign(map, { [current.key]: selected });
      else delete map[current.key];
      if (choice === "both" && current.remote) {
        const id = crypto.randomUUID();
        if (current.kind === "note")
          notes[id] = {
            ...(current.remote as KnowledgeNote),
            id,
            title: `${(current.remote as KnowledgeNote).title.slice(0, 494)}（远端副本）`,
            updatedAt: Date.now(),
          };
        else
          collections[id] = {
            id,
            name: `${("name" in current.remote ? current.remote.name : "集合").slice(0, 194)}（远端副本）`,
          };
      }
      const next = this.withHistory(state, { notes, collections }, "解决冲突前版本");
      // Also retain the unselected remote note in history, including delete/edit conflicts.
      if (current.kind === "note" && current.remote && !same(current.remote, selected))
        next.history = [
          {
            id: crypto.randomUUID(),
            note: current.remote as KnowledgeNote,
            at: Date.now(),
            reason: "冲突远端版本",
          },
          ...next.history,
        ].slice(0, 100);
      return { ...next, conflicts: state.conflicts.filter((c) => c !== current) };
    });
  }
  restore(note: KnowledgeNote): Promise<void> {
    return this.saveNote({ ...note, updatedAt: Date.now() }, this.value.notes[note.id] ?? null);
  }
}
const stores = new WeakMap<RuntimeMetadata, KnowledgeStore>();
export function workspaceKnowledge(metadata: RuntimeMetadata | undefined): KnowledgeStore {
  if (!metadata) return new KnowledgeStore(undefined);
  let store = stores.get(metadata);
  if (!store) {
    store = new KnowledgeStore(metadata);
    stores.set(metadata, store);
  }
  return store;
}
export async function closeKnowledge(metadata: RuntimeMetadata | undefined) {
  if (metadata) await stores.get(metadata)?.close();
}
export function publishKnowledge(search: SearchIndex, content: KnowledgeContent) {
  const documents: SearchDocument[] = Object.values(content.notes).flatMap((note) => {
    const body = note.body || note.title,
      result: SearchDocument[] = [];
    for (let offset = 0; offset < body.length || offset === 0; offset += 1680) {
      result.push({
        id: `knowledge:${note.id}:${offset}`,
        source: "knowledge",
        kind: "knowledge-note",
        title: note.title || "未命名笔记",
        body: body.slice(offset, offset + 1800),
        subtitle: note.collectionId
          ? (content.collections[note.collectionId]?.name ?? "未归类")
          : "个人笔记",
        tags: note.tags,
        route: `/knowledge?note=${encodeURIComponent(note.id)}`,
        updatedAt: note.updatedAt,
      });
      if (offset + 1800 >= body.length) break;
    }
    return result;
  });
  search.replaceSource("knowledge", documents);
}
