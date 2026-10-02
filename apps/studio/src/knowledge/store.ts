import type { RuntimeMetadata, RuntimeServices } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";
import { KnowledgeAttachments } from "./attachments";
import { mergeAttachments } from "./attachmentModel";
import { mergeContent } from "./merge";
import { noteRevision } from "./noteRevision";
import { preserveRenamedLinks } from "./renameLinks";
import {
  folderMoves,
  planNoteRename,
  planNoteMove,
  noteVersions,
  type NoteChangePlan,
} from "./changePlan";
import { countRewrittenLinks } from "./moveSummary";
import {
  assertUniquePaths,
  availableCopyPath,
  normalizeFolderPath,
  notePath,
  pathKey,
} from "./paths";
import { KnowledgePersistence } from "./persistence";
export { KNOWLEDGE_KEY } from "./persistence";
import {
  contentOf,
  copyName,
  decodeNote,
  decodeContent,
  decodeStateChanges,
  decodeTarget,
  emptyKnowledge,
  same,
  COLLECTION_NAME_MAX,
  NOTE_TITLE_MAX,
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
    const plan = planNoteMove(this.value.notes, moves, this.value.folders);
    this.plans.set(plan, JSON.stringify(plan));
    return plan;
  }
  /** 拖放/右键/对话框共用的即时移动：计划校验、原子落地、撤销入口。 */
  async moveNotes(moves: Readonly<Record<string, string>>): Promise<{
    plan: NoteChangePlan | null;
    links: number;
    undo: () => Promise<void>;
  }> {
    const notes = this.value.notes;
    const originals = Object.fromEntries(
      Object.keys(moves).map((id) => [id, notePath(notes[id] ?? { id })]),
    );
    if (!Object.keys(moves).length)
      return { plan: null, links: 0, undo: async () => Promise.resolve() };
    const plan = await this.previewMove(moves);
    await this.applyChangePlan(plan);
    return {
      plan,
      links: countRewrittenLinks(plan.changes),
      undo: async () => {
        const back = await this.previewMove(originals);
        await this.applyChangePlan(back);
      },
    };
  }
  /** 登记显式目录（含空目录）；重复登记是无操作。 */
  saveFolder(path: string): Promise<void> {
    const folder = normalizeFolderPath(path);
    return this.update((state) => {
      if (state.folders.some((item) => pathKey(item) === pathKey(folder))) return state;
      const folders = [...state.folders, folder].sort();
      assertUniquePaths(state.notes, folders);
      return { ...state, folders };
    });
  }
  /** 删除显式目录登记（含子目录）；目录里的笔记不受影响，仍由路径推导存在。 */
  removeFolders(paths: readonly string[]): Promise<void> {
    return this.update((state) => {
      const keys = paths.map((path) => pathKey(path));
      const folders = state.folders.filter((folder) => {
        const key = pathKey(folder);
        return !keys.some((prefix) => key === prefix || key.startsWith(`${prefix}/`));
      });
      if (folders.length === state.folders.length) return state;
      return { ...state, folders };
    });
  }
  /** 目录级移动：整棵目录（含显式子目录登记）改换前缀，引用随移动改写。 */
  async moveFolder(
    source: string,
    destination: string,
  ): Promise<{ plan: NoteChangePlan | null; links: number; undo: () => Promise<void> }> {
    const entries = this.folderEntries(source);
    const renamed = entries.map((entry) => `${destination}${entry.slice(source.length)}`);
    const moved = await this.moveNotes(folderMoves(this.value.notes, source, destination));
    await this.removeFolders([source]);
    for (const entry of renamed) await this.saveFolder(entry);
    return {
      ...moved,
      undo: async () => {
        await moved.undo();
        await this.removeFolders(renamed);
        for (const entry of entries) await this.saveFolder(entry);
      },
    };
  }
  /** 删除目录：目录名连同子目录名不再保留，其中笔记平铺到库根（引用随移动改写）。 */
  async deleteFolder(
    source: string,
  ): Promise<{ plan: NoteChangePlan | null; links: number; undo: () => Promise<void> }> {
    const entries = this.folderEntries(source);
    const prefix = `${pathKey(source)}/`;
    const moves = Object.fromEntries(
      Object.values(this.value.notes)
        .filter((note) => pathKey(notePath(note)).startsWith(prefix))
        .map((note) => [note.id, notePath(note).split("/").at(-1)!]),
    );
    const removed = await this.moveNotes(moves);
    await this.removeFolders([source]);
    return {
      ...removed,
      undo: async () => {
        await removed.undo();
        for (const entry of entries) await this.saveFolder(entry);
      },
    };
  }
  private folderEntries(source: string) {
    const key = pathKey(source);
    return this.value.folders.filter(
      (entry) => pathKey(entry) === key || pathKey(entry).startsWith(`${key}/`),
    );
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
        { notes, collections: state.collections, folders: state.folders },
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
        {
          notes: { ...state.notes, [valid.id]: valid },
          collections: state.collections,
          folders: state.folders,
        },
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
  ready: Promise<void>;
  private loaded = false;
  private retrying: Promise<void> | undefined;
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
  readonly attachments: KnowledgeAttachments;
  async importAttachment(file: File, signal?: AbortSignal) {
    await this.ready;
    const incoming = await this.attachments.import(file, signal);
    let record = incoming;
    await this.update((state) => {
      signal?.throwIfAborted();
      record =
        Object.values(state.attachments ?? {}).find(
          (asset) => asset.hash === incoming.hash && asset.mime === incoming.mime,
        ) ?? incoming;
      if (state.attachments?.[record.id]) return state;
      return { ...state, attachments: { ...state.attachments, [record.id]: record } };
    });
    return record;
  }
  constructor(
    private metadata: RuntimeMetadata | undefined,
    readonly binary?: BinaryStore,
    readonly compute?: Pick<RuntimeServices, "scheduler" | "artifacts">,
  ) {
    this.attachments = new KnowledgeAttachments(binary);
    this.persistence = metadata ? new KnowledgePersistence(metadata) : undefined;
    this.ready = this.load();
    void this.ready.catch(() => undefined);
  }
  private async load() {
    if (!this.metadata) throw new Error("本地持久化不可用，笔记编辑已暂停");
    this.value = await this.persistence!.load();
    this.loaded = true;
    this.emit();
  }
  /** Retry the owned service in place so search, Agent and views retain their subscriptions. */
  retryInitialization(): Promise<void> {
    if (this.stopping || this.closed) return Promise.reject(new Error("知识库已关闭"));
    if (this.loaded) return Promise.resolve();
    if (this.retrying) return this.retrying;
    const previous = this.ready;
    const pending = this.tail;
    this.ready = this.retrying = previous
      .catch(() => undefined)
      .then(() => pending.catch(() => undefined))
      .then(() => this.load())
      .finally(() => {
        this.retrying = undefined;
      });
    void this.ready.catch(() => undefined);
    return this.ready;
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
    const ready = this.ready;
    const operation = this.tail
      .catch(() => undefined)
      .then(async () => {
        await ready;
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
        const validated = decodeStateChanges(next, this.value);
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
      const baseline = {
        notes: base ? { [base.id]: base } : {},
        collections: {},
        folders: [],
      };
      const local = { notes: { [valid.id]: valid }, collections: {}, folders: [] };
      const remote = {
        notes: state.notes[note.id] ? { [note.id]: state.notes[note.id]! } : {},
        collections: {},
        folders: [],
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
        ...this.withHistory(
          state,
          { notes, collections: state.collections, folders: state.folders },
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
      return this.withHistory(
        state,
        { notes, collections: state.collections, folders: state.folders },
        "删除前版本",
      );
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
      return {
        ...state,
        notes,
        collections,
        folders: [...new Set([...state.folders, ...content.folders])].sort(),
        attachments: mergeAttachments(state.attachments, content.attachments),
      };
    });
  }
  configure(target: GitTarget | null): Promise<void> {
    if (this.syncing) return Promise.reject(new Error("请等待本次同步结束"));
    return this.update((s) => {
      if (this.syncing) throw new Error("请等待本次同步结束");
      const next = target ? decodeTarget(target) : null;
      if (same(next, s.sync.target)) return s;
      if (s.conflicts.length) throw new Error("请先解决冲突，再更换同步仓库");
      if (s.sync.pending) throw new Error("请先同步并核对上次提交，再更换或断开仓库");
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
  /** 解决冲突：取本机 / 取远端 / 保留双方（远端另存为副本，注意与恢复的 RestoreMode 各表其事）。 */
  resolve(conflict: KnowledgeConflict, choice: "local" | "remote" | "keep-both"): Promise<void> {
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
      if (choice === "keep-both" && current.remote) {
        const id = crypto.randomUUID();
        if (current.kind === "note")
          notes[id] = {
            ...(current.remote as KnowledgeNote),
            id,
            title: copyName(
              (current.remote as KnowledgeNote).title,
              NOTE_TITLE_MAX,
              "（远端副本）",
            ),
            ...((current.remote as KnowledgeNote).path === undefined
              ? {}
              : { path: availableCopyPath((current.remote as KnowledgeNote).path!, notes) }),
            updatedAt: Date.now(),
          };
        else
          collections[id] = {
            id,
            name: copyName(
              "name" in current.remote ? current.remote.name : "集合",
              COLLECTION_NAME_MAX,
              "（远端副本）",
            ),
          };
      }
      const next = this.withHistory(
        state,
        { notes, collections, folders: state.folders },
        "解决冲突前版本",
      );
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
