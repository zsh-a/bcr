import { cacheKey, type RuntimeMetadata } from "@bcr/core";
import { Schema } from "effect";
import type { WorkspaceFiles } from "../workspace/files";
import { decodeWork, Id, mimeFor, parseCommit, type Work, type WorkCommit } from "./model";

const INDEX = "works/index.v1";
const key = (id: string, revision: string) => `works/version/${id}/${revision}`;
type Index = Record<string, string>;

/** Immutable manifests + immutable blobs; only head pointers and receipts are transactional. */
export class WorkStore {
  private snapshot: readonly Work[] = [];
  private listeners = new Set<() => void>();
  private drafts = new Map<string, Map<symbol, () => boolean>>();
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  readonly ready: Promise<void>;
  constructor(
    private readonly metadata: RuntimeMetadata | undefined,
    readonly files: WorkspaceFiles,
  ) {
    this.ready = this.load();
    void this.ready.catch(() => undefined);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  registerDraft(id: string, dirty: () => boolean) {
    const token = Symbol("editor"),
      entries = this.drafts.get(id) ?? new Map();
    entries.set(token, dirty);
    this.drafts.set(id, entries);
    return {
      token,
      dispose: () => {
        entries.delete(token);
        if (!entries.size) this.drafts.delete(id);
      },
    };
  }
  assertWritable(id: string, owner?: symbol) {
    if ([...(this.drafts.get(id) ?? [])].some(([token, dirty]) => token !== owner && dirty()))
      throw new Error("作品有未保存的编辑，请先保存或撤销");
  }
  private async index(): Promise<Index> {
    if (!this.metadata?.batch) throw new Error("作品需要支持事务的本地存储");
    const raw = await this.metadata.get(INDEX);
    return Object.assign(
      Object.create(null),
      raw ? Schema.decodeUnknownSync(Schema.Record({ key: Id, value: Id }))(JSON.parse(raw)) : {},
    ) as Index;
  }
  private async load() {
    const index = await this.index();
    if (Object.keys(index).length > 1000) throw new Error("作品数量超过限制");
    this.snapshot = await Promise.all(
      Object.entries(index).map(([id, revision]) => this.version(id, revision)),
    );
    for (const fn of this.listeners) fn();
  }
  private queue<T>(fn: () => Promise<T>) {
    if (this.closed) return Promise.reject(new Error("作品工作区已关闭"));
    const next = this.tail
      .catch(() => undefined)
      .then(async () => {
        await this.ready;
        return typeof navigator !== "undefined" && navigator.locks
          ? navigator.locks.request("bcr-works-write", fn)
          : fn();
      });
    this.tail = next;
    return next;
  }
  refresh() {
    return this.queue(() => this.load());
  }
  async read(id: string, revision?: string) {
    await this.ready;
    Schema.decodeUnknownSync(Id)(id);
    const selected = revision ?? (await this.index())[id];
    if (!selected) throw new Error("作品不存在");
    return this.version(id, selected);
  }
  private async version(id: string, revision: string) {
    Schema.decodeUnknownSync(Id)(id);
    Schema.decodeUnknownSync(Id)(revision);
    const raw = await this.metadata!.get(key(id, revision));
    if (!raw) throw new Error("作品版本不存在");
    const work = decodeWork(JSON.parse(raw));
    if (work.id !== id || work.revision !== revision) throw new Error("作品版本身份不匹配");
    return work;
  }
  async history(id: string, revision?: string) {
    let work: Work | null = await this.read(id, revision);
    const items: { revision: string; title: string; updatedAt: number }[] = [];
    while (work && items.length < 30) {
      items.push({ revision: work.revision, title: work.title, updatedAt: work.updatedAt });
      work = work.parent ? await this.version(id, work.parent) : null;
    }
    return { items, nextRevision: work?.revision ?? null };
  }
  commit(raw: WorkCommit, signal?: AbortSignal, owner?: symbol): Promise<Work> {
    const input = parseCommit(structuredClone(raw));
    const digest = cacheKey({
      operation: "work.commit",
      inputs: [],
      config: { input },
      runtimeVersion: "1",
    });
    return this.queue(async () => {
      const receiptKey = `works/request/${input.requestId}`;
      const receipt = await this.metadata!.get(receiptKey);
      if (receipt) {
        const saved = JSON.parse(receipt) as { digest: string; id: string; revision: string };
        if (saved.digest !== digest) throw new Error("requestId 已用于不同的操作");
        await this.load();
        return this.version(saved.id, saved.revision);
      }
      const index = await this.index(),
        id = input.id ?? crypto.randomUUID();
      if ((index[id] ?? null) !== input.revision)
        throw new Error("作品版本冲突，请重新读取 revision");
      this.assertWritable(id, owner);
      const previous = index[id] ? await this.version(id, index[id]) : undefined;
      const base = input.restoreRevision ? await this.version(id, input.restoreRevision) : previous;
      const files = new Map((base?.files ?? []).map((f) => [f.path, f]));
      for (const path of input.remove ?? []) files.delete(path);
      for (const file of input.put ?? []) {
        signal?.throwIfAborted();
        const artifact =
          file.artifact ??
          (await this.files.import(
            new Blob([file.text!], { type: file.mime ?? mimeFor(file.path) }),
            file.path,
            signal,
          ));
        if (file.artifact) await this.files.read(artifact);
        files.set(file.path, { path: file.path, artifact });
      }
      const now = Date.now();
      const work = decodeWork({
        format: "bcr-work-1",
        id,
        revision: crypto.randomUUID(),
        parent: previous?.revision ?? null,
        title: input.title ?? base?.title ?? "未命名作品",
        entry: input.entry === undefined ? (base?.entry ?? null) : input.entry,
        links: input.links ?? base?.links ?? [],
        files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });
      if (!previous && Object.keys(index).length >= 1000) throw new Error("作品数量超过 1000");
      this.assertWritable(id, owner);
      signal?.throwIfAborted();
      await this.metadata!.batch!([
        [key(id, work.revision), JSON.stringify(work)],
        [INDEX, JSON.stringify({ ...index, [id]: work.revision })],
        [receiptKey, JSON.stringify({ digest, id, revision: work.revision })],
      ]);
      await this.load();
      return work;
    });
  }
  async flush() {
    await this.ready;
    await this.tail;
  }
  async close() {
    this.closed = true;
    await this.ready.catch(() => undefined);
    await this.tail.catch(() => undefined);
  }
}
