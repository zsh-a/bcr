import type { RuntimeMetadata } from "@bcr/core";
import {
  DIAGRAM_INDEX,
  diagramKey,
  decodeDocument,
  decodeIndex,
  decodeScene,
  emptyScene,
  summary,
  validId,
  type DiagramDocument,
  type DiagramScene,
  type DiagramSummary,
} from "./model";

export interface DiagramDraftState {
  document: DiagramDocument;
  dirty: boolean;
  saving: boolean;
  error: string;
}
export class DiagramDraft {
  private value: DiagramDraftState;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private persisted: string;
  private editor: ((scene: DiagramScene) => void) | undefined;
  private closed = false;
  constructor(
    document: DiagramDocument,
    private readonly save: (document: DiagramDocument, base: string) => Promise<void>,
  ) {
    this.persisted = document.revision;
    this.value = { document, dirty: false, saving: false, error: "" };
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  attachEditor(apply: (scene: DiagramScene) => void) {
    this.editor = apply;
    return () => {
      if (this.editor === apply) this.editor = undefined;
    };
  }
  change(patch: { title?: string; scene?: DiagramScene }, expectedRevision?: string) {
    if (this.closed) throw new Error("图表已关闭，草稿已保留");
    if (expectedRevision && this.value.document.revision !== expectedRevision)
      throw new Error("画布已变化，请重新读取 revision 后修改");
    if (patch.title !== undefined && (!patch.title.trim() || patch.title.length > 200))
      throw new Error("请输入不超过 200 字的图表名称");
    this.value = {
      ...this.value,
      document: {
        ...this.value.document,
        ...patch,
        revision: crypto.randomUUID(),
        updatedAt: Date.now(),
      },
      dirty: true,
      error: "",
    };
    this.emit();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => undefined);
    }, 450);
  }
  apply(scene: DiagramScene, revision: string) {
    this.change({ scene }, revision);
    this.editor?.(scene);
  }
  flush(): Promise<DiagramDocument> {
    clearTimeout(this.timer);
    const operation = this.tail
      .catch(() => undefined)
      .then(async () => {
        if (!this.value.dirty) return this.value.document;
        const document = this.value.document;
        this.value = { ...this.value, saving: true };
        this.emit();
        try {
          await this.save(document, this.persisted);
          this.persisted = document.revision;
          this.value = {
            ...this.value,
            dirty: this.value.document.revision !== document.revision,
            saving: false,
            error: "",
          };
          this.emit();
          return document;
        } catch (error) {
          this.value = {
            ...this.value,
            saving: false,
            error: error instanceof Error ? error.message : String(error),
          };
          this.emit();
          throw error;
        }
      });
    this.tail = operation;
    return operation;
  }
  async close() {
    this.closed = true;
    this.editor = undefined;
    clearTimeout(this.timer);
    await this.flush();
  }
}

/** Lazy per-document reads and atomic document/index commits; images never enter the index. */
export class DiagramStore {
  private items: readonly DiagramSummary[] = [];
  private drafts = new Map<string, Promise<DiagramDraft>>();
  private listeners = new Set<() => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private stopping = false;
  private closing: Promise<void> | undefined;
  private accepted = new Set<Promise<unknown>>();
  current: { id: string; selection: readonly string[] } | null = null;
  readonly ready: Promise<void>;
  constructor(private readonly metadata: RuntimeMetadata | undefined) {
    this.ready = this.load();
    void this.ready.catch(() => undefined);
  }
  private async load() {
    if (!this.metadata) throw new Error("本地存储不可用，无法保存图表");
    this.items = decodeIndex(await this.metadata.get(DIAGRAM_INDEX));
    this.emit();
  }
  getSnapshot = () => this.items;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  open(id: string): Promise<DiagramDraft> {
    return this.accept(() => this.getOrOpen(id));
  }
  private getOrOpen(id: string): Promise<DiagramDraft> {
    if (!validId(id)) return Promise.reject(new Error("图表 ID 无效"));
    let draft = this.drafts.get(id);
    if (!draft) {
      draft = this.ready.then(async () => {
        if (!this.items.some((item) => item.id === id)) throw new Error("图表不存在或已删除");
        const raw = await this.metadata!.get(diagramKey(id));
        if (!raw) throw new Error("图表内容丢失，索引已保留");
        const document = decodeDocument(raw);
        if (document.id !== id) throw new Error("图表内容与索引不匹配");
        return this.makeDraft(document);
      });
      this.drafts.set(id, draft);
      void draft.catch(() => {
        if (this.drafts.get(id) === draft) this.drafts.delete(id);
      });
    }
    return draft;
  }
  private makeDraft(document: DiagramDocument) {
    return new DiagramDraft(document, (next, base) => this.persist(next, base));
  }
  private accept<T>(run: () => Promise<T>): Promise<T> {
    if (this.stopping || this.closed) return Promise.reject(new Error("绘图工作区已关闭"));
    const operation = run();
    this.accepted.add(operation);
    const done = () => this.accepted.delete(operation);
    void operation.then(done, done);
    return operation;
  }
  private queue<T>(write: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("绘图工作区已关闭"));
    const operation = this.tail
      .catch(() => undefined)
      .then(async () => {
        await this.ready;
        if (typeof navigator !== "undefined" && navigator.locks)
          return navigator.locks.request("bcr-diagrams-write", write);
        return write();
      });
    this.tail = operation;
    return operation;
  }
  private async commit(document: DiagramDocument, base: string | null) {
    if (!this.metadata?.batch) throw new Error("本地存储不支持原子保存，无法保存图表");
    const raw = JSON.stringify(document);
    decodeDocument(raw);
    const items = decodeIndex(await this.metadata!.get(DIAGRAM_INDEX));
    const previous = items.find((item) => item.id === document.id);
    // A receipt may have been lost after commit; accept only the exact same revision.
    if (previous?.revision === document.revision) {
      this.items = items;
      this.emit();
      return;
    }
    if ((previous?.revision ?? null) !== base)
      throw new Error("其他窗口已修改或删除图表，请导出当前草稿后重新打开");
    const next = [summary(document), ...items.filter((item) => item.id !== document.id)].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    await this.metadata!.batch!([
      [diagramKey(document.id), raw],
      [DIAGRAM_INDEX, JSON.stringify({ version: 1, items: next })],
    ]);
    this.items = next;
    this.emit();
  }
  private persist(document: DiagramDocument, base: string) {
    return this.queue(() => this.commit(document, base));
  }
  create(
    title = "未命名图表",
    scene = emptyScene(),
    identity?: { id: string; creationKey: string },
  ): Promise<DiagramDraft> {
    return this.accept(() =>
      this.queue(async () => {
        if (!title.trim() || title.length > 200) throw new Error("请输入不超过 200 字的图表名称");
        const id = identity?.id ?? crypto.randomUUID();
        if (!validId(id)) throw new Error("图表 ID 无效");
        const existing = await this.metadata!.get(diagramKey(id));
        if (existing) {
          const document = decodeDocument(existing);
          if (!identity || document.creationKey !== identity.creationKey)
            throw new Error("创建请求已使用且内容不同");
          this.items = decodeIndex(await this.metadata!.get(DIAGRAM_INDEX));
          this.emit();
          const draft = await this.getOrOpen(id);
          return draft;
        }
        const document: DiagramDocument = {
          version: 1,
          id,
          title: title.trim(),
          scene: decodeScene(scene),
          revision: crypto.randomUUID(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...(identity ? { creationKey: identity.creationKey } : {}),
        };
        await this.commit(document, null);
        const draft = this.makeDraft(document);
        this.drafts.set(id, Promise.resolve(draft));
        return draft;
      }),
    );
  }
  remove(id: string, revision: string) {
    return this.accept(async () => {
      const draft = await this.getOrOpen(id);
      await draft.flush();
      return this.queue(async () => {
        if (draft.getSnapshot().document.revision !== revision)
          throw new Error("图表已变化，请重新确认删除");
        const items = decodeIndex(await this.metadata!.get(DIAGRAM_INDEX));
        if (items.find((item) => item.id === id)?.revision !== revision)
          throw new Error("其他窗口已修改图表，请重新打开");
        const next = items.filter((item) => item.id !== id);
        await this.metadata!.batch!([
          [diagramKey(id), undefined],
          [DIAGRAM_INDEX, JSON.stringify({ version: 1, items: next })],
        ]);
        this.drafts.delete(id);
        this.items = next;
        this.emit();
      });
    });
  }
  async flush() {
    await this.ready;
    await Promise.all([...this.drafts.values()].map(async (draft) => (await draft).flush()));
    await this.tail;
  }
  close(): Promise<void> {
    this.stopping = true;
    return (this.closing ??= (async () => {
      await this.ready.catch(() => undefined);
      await Promise.allSettled(this.accepted);
      const results = await Promise.allSettled(
        [...this.drafts.values()].map(async (draft) => (await draft).close()),
      );
      await this.tail.catch(() => undefined);
      this.closed = true;
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })());
  }
}
