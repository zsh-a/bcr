import type { RuntimeMetadata } from "@bcr/core";
import { ContentAssets, type ContentArtifact } from "./assets";
import type { BinaryStore } from "@bcr/storage-opfs";
import { decodeProject, type ContentProject } from "./model";
import { decodeRelease, type ReleaseSnapshot } from "./release";

const INDEX = "content/index.v1";
const projectKey = (id: string) => `content/project/${id}`;
const releaseKey = (id: string) => `content/release/${id}`;

/** Explicit durable commands; no view-owned write queue or optimistic success state. */
export class ContentStore {
  private projects: readonly ContentProject[] = [];
  private listeners = new Set<() => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  readonly ready: Promise<void>;
  readonly assets: ContentAssets;
  uploads: readonly ContentArtifact[] = [];
  current: { id: string; section: string; dirty: boolean } | null = null;
  private drafts = new Map<string, Set<() => boolean>>();
  registerDraft(id: string, dirty: () => boolean) {
    const entries = this.drafts.get(id) ?? new Set<() => boolean>();
    entries.add(dirty);
    this.drafts.set(id, entries);
    return () => {
      entries.delete(dirty);
      if (!entries.size) this.drafts.delete(id);
    };
  }
  assertWritable(id: string) {
    if ([...(this.drafts.get(id) ?? [])].some((dirty) => dirty()))
      throw new Error("项目有未保存的编辑，请先保存或撤销");
  }
  async receipt(request: { id: string; digest: string }): Promise<ContentProject | null> {
    await this.ready;
    const raw = await this.metadata!.get(`content/request/${request.id}`);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { digest: string; project: unknown };
    if (saved.digest !== request.digest) throw new Error("requestId 已用于不同的操作");
    return decodeProject(saved.project);
  }
  constructor(
    private readonly metadata: RuntimeMetadata | undefined,
    binary?: BinaryStore,
  ) {
    this.assets = new ContentAssets(binary);
    this.ready = this.load();
    void this.ready.catch(() => undefined);
  }
  private async load() {
    if (!this.metadata?.batch) throw new Error("内容项目需要支持事务的本地存储");
    const ids = await this.ids();
    this.projects = await Promise.all(
      ids.map(async (id) => {
        const raw = await this.metadata!.get(projectKey(id));
        if (!raw) throw new Error("项目文件缺失，索引已保留");
        const project = decodeProject(JSON.parse(raw));
        if (project.id !== id) throw new Error("项目索引身份不匹配");
        return project;
      }),
    );
    this.emit();
  }
  private async ids(): Promise<string[]> {
    const raw = await this.metadata!.get(INDEX);
    if (!raw) return [];
    const values: unknown = JSON.parse(raw);
    if (
      !Array.isArray(values) ||
      values.length > 1000 ||
      !values.every(
        (id) => typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/u.test(id),
      ) ||
      new Set(values).size !== values.length
    )
      throw new Error("项目索引损坏");
    return values as string[];
  }
  getSnapshot = () => this.projects;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private queue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("内容工作区已关闭"));
    const next = this.tail
      .catch(() => undefined)
      .then(async () => {
        await this.ready;
        if (typeof navigator !== "undefined" && navigator.locks)
          return navigator.locks.request("bcr-content-write", operation);
        return operation();
      });
    this.tail = next;
    return next;
  }
  async release(id: string): Promise<ReleaseSnapshot> {
    await this.ready;
    const raw = await this.metadata!.get(releaseKey(id));
    if (!raw) throw new Error("发布快照不存在");
    return decodeRelease(JSON.parse(raw));
  }
  save(
    project: ContentProject,
    expected: string | null,
    releases: readonly ReleaseSnapshot[] = [],
    check: () => void = () => {},
    request?: { id: string; digest: string },
  ): Promise<ContentProject> {
    const captured = decodeProject(structuredClone(project));
    const snapshots = releases.map((release) => decodeRelease(structuredClone(release)));
    return this.queue(async () => {
      if (request) {
        const saved = await this.receipt(request);
        if (saved) return saved;
      }
      const raw = await this.metadata!.get(projectKey(captured.id));
      const previous = raw ? decodeProject(JSON.parse(raw)) : null;
      if ((previous?.revision ?? null) !== expected)
        throw new Error("项目已被其他窗口修改，请刷新项目后重试；当前输入仍保留");
      if (previous?.releases.some((id) => !captured.releases.includes(id)))
        throw new Error("已发布快照不能从项目中移除");
      const entries: (readonly [string, string])[] = [];
      for (const release of snapshots) {
        const existing = await this.metadata!.get(releaseKey(release.id));
        if (existing && decodeRelease(JSON.parse(existing)).digest !== release.digest)
          throw new Error("发布快照身份冲突");
        entries.push([releaseKey(release.id), JSON.stringify(release)]);
      }
      for (const id of captured.releases)
        if (!snapshots.some((r) => r.id === id) && !(await this.metadata!.get(releaseKey(id))))
          throw new Error("项目引用的发布快照缺失");
      const ids = await this.ids();
      if (!ids.includes(captured.id) && ids.length >= 1000) throw new Error("项目数量超过首版限制");
      const next = decodeProject({
        ...captured,
        revision: crypto.randomUUID(),
        updatedAt: Date.now(),
      });
      const encoded = JSON.stringify(next);
      if (new Blob([encoded]).size > 12 * 1024 * 1024)
        throw new Error("项目元数据超过 12 MiB，请减少粘贴正文");
      check();
      await this.metadata!.batch!([
        ...entries,
        [projectKey(next.id), encoded],
        [INDEX, JSON.stringify([...new Set([next.id, ...ids])])],
        ...(request
          ? [
              [
                `content/request/${request.id}`,
                JSON.stringify({ digest: request.digest, project: next }),
              ] as const,
            ]
          : []),
      ]);
      this.projects = [next, ...this.projects.filter((p) => p.id !== next.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
      this.emit();
      return next;
    });
  }
  refresh() {
    return this.queue(() => this.load());
  }
  async flush() {
    await this.ready;
    await this.tail;
  }
  async close() {
    this.closed = true;
    await this.ready.catch(() => undefined);
    await this.tail;
  }
}
