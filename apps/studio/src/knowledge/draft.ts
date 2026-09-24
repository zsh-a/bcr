import { decodeNote, same, type KnowledgeNote } from "./model";
import type { KnowledgeStore } from "./store";

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface DraftSnapshot {
  readonly note: KnowledgeNote;
  readonly dirty: boolean;
  readonly status: string;
  readonly error: string;
  readonly proposedTitle: string | null;
}

/** One note's draft, recovery copy and durable-save barrier, independent of React/Agent. */
export class NoteDraft {
  private snapshot: DraftSnapshot;
  private base: KnowledgeNote;
  private sequence = 0;
  private pending: Promise<void> | null = null;
  private locked = false;
  private listeners = new Set<() => void>();
  readonly initialError: string;
  private readonly key: string;

  constructor(
    note: KnowledgeNote,
    private store: KnowledgeStore,
    private storage: DraftStorage,
  ) {
    this.key = `bcr/knowledge-draft/v1/${note.id}`;
    this.base = note;
    let proposedTitle: string | null = null;
    let draft = note,
      error = "";
    try {
      const raw = storage.getItem(this.key);
      if (raw) {
        const data = JSON.parse(raw);
        draft = decodeNote(data.note);
        this.base = decodeNote(data.base);
        if (data.proposedTitle !== undefined && data.proposedTitle !== null) {
          if (typeof data.proposedTitle !== "string" || data.proposedTitle.length > 500)
            throw new Error("重命名草稿无效");
          proposedTitle = data.proposedTitle;
        }
        if (draft.id !== note.id || this.base.id !== note.id) throw new Error("草稿身份不匹配");
        // Upgrade pre-review recovery drafts without silently approving their title changes.
        if (this.base.title && draft.title !== this.base.title && proposedTitle === null) {
          proposedTitle = draft.title;
          draft = { ...draft, title: this.base.title };
        }
      }
    } catch {
      draft = note;
      this.base = note;
      error = "无法读取本地草稿，请检查浏览器存储并刷新；编辑已暂停";
    }
    this.initialError = error;
    const dirty = !same(draft, note);
    this.snapshot = {
      note: draft,
      dirty,
      error,
      proposedTitle,
      status: dirty ? "已恢复未保存草稿" : "已保存到本机",
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<DraftSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  setLocked(locked: boolean) {
    this.locked = locked;
  }
  get editable() {
    return !this.locked && !this.initialError;
  }
  receive(note: KnowledgeNote) {
    if (note.id !== this.snapshot.note.id) throw new Error("草稿身份不匹配");
    if (!this.snapshot.dirty && !this.pending && note !== this.snapshot.note) {
      this.base = note;
      this.publish({ note });
    }
  }
  private backup(note = this.snapshot.note) {
    this.storage.setItem(
      this.key,
      JSON.stringify({ base: this.base, note, proposedTitle: this.snapshot.proposedTitle }),
    );
  }
  changeTitle = (title: string) => {
    if (!this.editable) throw new Error(this.initialError || "请先解决同步冲突");
    // Naming a new untitled note remains part of normal writing.
    if (!this.base.title && this.snapshot.proposedTitle === null) {
      this.change({ title });
      return;
    }
    this.publish({ proposedTitle: title === this.snapshot.note.title ? null : title });
    try {
      this.backup();
    } catch {
      this.publish({ error: "重命名草稿备份失败，请保持页面打开" });
    }
  };
  cancelRename = () => {
    this.publish({ proposedTitle: null });
    try {
      if (this.snapshot.dirty) this.backup();
      else this.storage.removeItem(this.key);
    } catch {
      this.publish({ error: "草稿清理失败，请检查浏览器存储" });
    }
  };
  flushForNavigation = async () => {
    await this.flush();
    if (this.snapshot.proposedTitle !== null) throw new Error("请先预览确认或取消重命名");
  };
  change = (patch: Partial<KnowledgeNote>) => {
    if (!this.editable) throw new Error(this.initialError || "请先解决同步冲突，编辑草稿已保留");
    const note = {
      ...this.snapshot.note,
      ...patch,
      id: this.snapshot.note.id,
      updatedAt: Date.now(),
    };
    this.sequence++;
    let error = this.snapshot.error;
    try {
      this.backup(note);
    } catch {
      error = "浏览器草稿备份失败，正在尝试保存笔记；成功前请保持页面打开";
    }
    this.publish({ note, dirty: true, status: "待保存…", error });
  };
  /** All callers join one drain, including edits arriving while a write is pending. */
  flush = (): Promise<void> => {
    if (this.pending) return this.pending;
    if (!this.snapshot.dirty) return Promise.resolve();
    const operation = Promise.resolve()
      .then(async () => {
        while (this.snapshot.dirty) {
          if (!this.editable)
            throw new Error(this.initialError || "请先解决同步冲突，编辑草稿已保留");
          await this.save();
        }
      })
      .catch((error: unknown) => {
        this.publish({ error: String(error), status: "保存失败 · 草稿保留" });
        throw error;
      })
      .finally(() => {
        if (this.pending === operation) this.pending = null;
      });
    this.pending = operation;
    return operation;
  };
  private async save(): Promise<void> {
    const captured = this.snapshot.note,
      sequence = this.sequence,
      base = this.base;
    this.publish({ status: "正在保存…", error: "" });
    await this.store.saveNote(captured, base);
    const state = this.store.getSnapshot();
    if (state.conflicts.some((c) => c.kind === "note" && c.key === captured.id))
      throw new Error("保存产生同步冲突，草稿已保留，请先解决冲突");
    const saved = state.notes[captured.id];
    if (!saved) throw new Error("笔记已删除，未保存");
    if (this.sequence === sequence) {
      this.base = saved;
      let error = "";
      try {
        if (this.snapshot.proposedTitle !== null) this.backup(saved);
        else this.storage.removeItem(this.key);
      } catch {
        error = "笔记已保存，草稿清理失败；可以继续编辑";
      }
      this.publish({ note: saved, dirty: false, status: "已保存到本机", error });
    } else {
      // The new draft descends from the captured draft, not from a potentially merged save.
      this.base = captured;
      try {
        this.backup();
      } catch {
        /* In-memory draft is retried by the save barrier. */
      }
    }
  }
}
