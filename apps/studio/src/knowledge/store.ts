import type { RuntimeMetadata } from "@bcr/core";
import { mergeContent } from "./merge";
import { noteRevision } from "./noteRevision";
import { preserveRenamedLinks } from "./renameLinks";
import { planNoteRename, planNoteMove, noteVersions, type NoteChangePlan } from "./changePlan";
import { availableCopyPath } from "./paths";
import { KnowledgePersistence } from "./persistence";
export { KNOWLEDGE_KEY } from "./persistence";
import {
  contentOf,
  decodeNote,
  decodeContent,
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

export const KNOWLEDGE_PATH_BACKUP_KEY = "workspace/knowledge.before-paths.v1";
export class KnowledgeStore {
  private plans = new WeakMap<NoteChangePlan, string>();
  async previewRename(id: string, title: string): Promise<NoteChangePlan> {
    await this.flush();
    const plan = planNoteRename(this.value.notes, id, title);
    this.plans.set(plan, JSON.stringify(plan));
    return plan;
  }
  async previewMove(moves: Readonly<Record<string, string>>): Promise<NoteChangePlan> {
    await this.flush();
    const plan = planNoteMove(this.value.notes, moves);
    this.plans.set(plan, JSON.stringify(plan));
    return plan;
  }
  /** Explicit approval applies exactly the previewed changes inside the durable queue. */
  applyChangePlan(plan: NoteChangePlan, check: () => void = () => {}): Promise<void> {
    return this.update((state) => {
      if (this.plans.get(plan) !== JSON.stringify(plan))
        throw new Error("修改计划无效或已执行，请刷新预览");
      if (!same(noteVersions(state.notes), plan.versions))
        throw new Error("预览后知识库已变化，请刷新预览后重新确认");
      check();
      if (!plan.changes.length) return state;
      const notes = { ...state.notes };
      for (const change of plan.changes) {
        this.assertNoteWritable(change.before.id);
        notes[change.after.id] = decodeNote(change.after);
      }
      return this.withHistory(
        state,
        { notes, collections: state.collections },
        plan.kind === "move" ? "移动与引用更新前版本" : "重命名与引用更新前版本",
      );
    }).then(() => {
      this.plans.delete(plan);
    });
  }
  private draftGuards = new Map<string, Set<() => boolean>>();
  registerDraft(id: string, dirty: () => boolean) {
    const guards = this.draftGuards.get(id) ?? new Set<() => boolean>();
    guards.add(dirty);
    this.draftGuards.set(id, guards);
    return () => {
      guards.delete(dirty);
      if (!guards.size) this.draftGuards.delete(id);
    };
  }
  assertNoteWritable(id: string) {
    if ([...(this.draftGuards.get(id) ?? [])].some((dirty) => dirty()))
      throw new Error("笔记有未保存草稿，请先保存或处理草稿");
    if (this.value.conflicts.some((c) => c.kind === "note" && c.key === id))
      throw new Error("请先解决笔记的同步冲突");
  }
  /** Strict compare-and-set inside the save queue; unlike editor saves, never auto-merge. */
  async saveAgentNote(
    note: KnowledgeNote,
    revision: string | null,
    check: () => void,
  ): Promise<KnowledgeNote> {
    const valid = decodeNote(note);
    let saved = valid;
    await this.update((state) => {
      check();
      this.assertNoteWritable(valid.id);
      if (valid.collectionId !== null && !Object.hasOwn(state.collections, valid.collectionId))
        throw new Error("目标集合不存在或已删除");
      const current = state.notes[valid.id];
      if (revision === null && current) {
        if (
          !same({ ...valid, createdAt: current.createdAt, updatedAt: current.updatedAt }, current)
        )
          throw new Error("创建请求已使用且内容不同，请核实原笔记，不要重复创建");
        saved = current;
        return state;
      }
      if (revision !== null && (!current || noteRevision(current) !== revision))
        throw new Error("笔记版本已变化或已删除，请重新读取并确认修改");
      return this.withHistory(
        state,
        { notes: { ...state.notes, [valid.id]: valid }, collections: state.collections },
        "Agent 编辑前版本",
      );
    });
    return saved;
  }
  private value = emptyKnowledge();
  private tail: Promise<unknown> = Promise.resolve();
  private reloadRequired = false;
  private closed = false;
  private stopping = false;
  private syncTask: Promise<unknown> | null = null;
  private syncListeners = new Set<() => void>();
  private listeners = new Set<() => void>();
  readonly ready: Promise<void>;
  private readonly persistence: KnowledgePersistence | undefined;
  get syncing() {
    return this.syncTask !== null;
  }
  getSyncSnapshot = () => this.syncing;
  subscribeSync = (listener: () => void) => {
    this.syncListeners.add(listener);
    return () => {
      this.syncListeners.delete(listener);
    };
  };
  async runSync<T>(action: () => Promise<T>): Promise<T> {
    if (this.stopping) throw new Error("知识库已关闭");
    if (this.syncTask) throw new Error("同步正在进行");
    const task = Promise.resolve().then(action);
    this.syncTask = task;
    for (const listener of this.syncListeners) listener();
    try {
      return await task;
    } finally {
      this.syncTask = null;
      for (const listener of this.syncListeners) listener();
    }
  }
  constructor(private metadata: RuntimeMetadata | undefined) {
    this.persistence = metadata ? new KnowledgePersistence(metadata) : undefined;
    this.ready = this.load();
    void this.ready.catch(() => undefined);
  }
  private async load() {
    if (!this.metadata) throw new Error("本地持久化不可用，笔记编辑已暂停");
    this.value = await this.persistence!.load();
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
    this.stopping = true;
    // An accepted sync may still need to commit its durable publication receipt.
    if (this.syncTask) await this.syncTask.catch(() => undefined);
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
        let next = change(this.value);
        if (next === this.value) return;
        if (
          next.version === 1 &&
          [
            ...Object.values(next.notes),
            ...Object.values(next.sync.base.notes),
            ...Object.values(next.sync.pending?.content.notes ?? {}),
            ...next.history.map((entry) => entry.note),
            ...next.conflicts.flatMap((conflict) => [
              conflict.base,
              conflict.local,
              conflict.remote,
            ]),
          ].some((note) => note && "path" in note && note.path !== undefined)
        )
          next = { ...next, version: 2 };
        const raw = JSON.stringify(next);
        const validated = decodeState(raw);
        try {
          if (
            this.value.version === 1 &&
            next.version === 2 &&
            (await this.metadata!.get(KNOWLEDGE_PATH_BACKUP_KEY)) === undefined
          )
            await this.metadata!.set(KNOWLEDGE_PATH_BACKUP_KEY, JSON.stringify(this.value));
          await this.persistence!.save(validated);
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
      if (
        state.notes[note.id] &&
        valid.path !== state.notes[note.id]!.path &&
        valid.path !== base?.path
      )
        throw new Error("移动笔记需要预览并确认修改计划");
      const baseline = { notes: base ? { [base.id]: base } : {}, collections: {} };
      const local = { notes: { [valid.id]: valid }, collections: {} };
      const remote = {
        notes: state.notes[note.id] ? { [note.id]: state.notes[note.id]! } : {},
        collections: {},
      };
      const result = mergeContent(baseline, local, remote);
      if (same(result.content.notes[note.id], state.notes[note.id]) && !result.conflicts.length)
        return state;
      let notes = { ...state.notes, ...result.content.notes };
      if (!result.conflicts.length) {
        notes = preserveRenamedLinks(state.notes, notes, valid.id);
        if (
          Object.values(notes).some(
            (related) => related.id !== valid.id && related.body !== state.notes[related.id]?.body,
          )
        )
          throw new Error("重命名会修改其他笔记，请预览并确认修改计划");
      }
      return {
        ...this.withHistory(state, { notes, collections: state.collections }, "编辑前版本"),
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
            ...((current.remote as KnowledgeNote).path === undefined
              ? {}
              : { path: availableCopyPath((current.remote as KnowledgeNote).path!, notes) }),
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

  restoreBackup(content: KnowledgeContent, base: KnowledgeContent): Promise<void> {
    const restored = decodeContent(content);
    return this.update((state) => {
      if (this.syncing || state.conflicts.length || state.sync.pending)
        throw new Error("请先完成同步或解决冲突，再恢复备份");
      if (!same(contentOf(state), base))
        throw new Error("预览后知识库已变化，请重新选择备份并确认");
      return this.withHistory(state, restored, "备份恢复前版本");
    });
  }
}
