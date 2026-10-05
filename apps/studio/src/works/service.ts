import type {
  PageState,
  PageCapture,
  ReviewView,
  ReviewImage,
  Submission,
  ReviewBook,
  ReviewEdit,
  ReviewOutput,
  Delivery,
  Job,
  Project,
  WorkRef,
  WorkSummary,
  VersionPage,
  VersionDiff,
  CheckpointRequest,
  RestoreRequest,
} from "@bcr/work-core";
import { changedFiles } from "@bcr/work-core";
import type { WorkStore } from "./store";
import type { WorkCommit } from "./model";
import { WorkPreview } from "./preview";
import { LocalRunner } from "./local";

export const BROWSER_SOURCE = "browser";
export const workKey = (ref: WorkRef) => `${ref.sourceId}:${ref.id}`;
export const workRoute = (ref: WorkRef) =>
  `/works?${new URLSearchParams({ source: ref.sourceId, work: ref.id })}`;

/** Application boundary shared by the workbench and Agent. Storage formats stay with their sources. */
export class WorkService {
  readonly local = new LocalRunner();
  private state: readonly WorkSummary[] = [];
  private listeners = new Set<() => void>();
  private dispose: (() => void)[];
  constructor(
    readonly browser: WorkStore,
    readonly preview = new WorkPreview(),
  ) {
    this.dispose = [browser.subscribe(this.publish), this.local.subscribe(this.publish)];
    this.publish();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish = () => {
    this.state = [
      ...this.browser.getSnapshot().map((w): WorkSummary => ({
        ref: { sourceId: BROWSER_SOURCE, provider: "browser", id: w.id },
        title: w.title,
        revision: w.revision,
        targets: w.entry ? [{ id: "page", runtime: "html", entry: w.entry }] : [],
        capabilities: ["read", "commit", "history", "versions", "preview", "archive", "review"],
      })),
      ...this.local.getSnapshot().items.map(({ ref, title, revision, targets, capabilities }) => ({
        ref,
        title,
        revision,
        targets,
        capabilities,
      })),
    ];
    for (const listener of this.listeners) listener();
  };
  async list() {
    await Promise.all([this.browser.refresh(), this.local.refresh()]);
    return this.state;
  }
  /** Legacy provider inputs remain accepted; unqualified IDs must be unambiguous. */
  resolve(input: {
    id: string;
    provider?: string | undefined;
    sourceId?: string | undefined;
  }): WorkRef {
    const { id, provider, sourceId } = input;
    if (provider === "all") throw new Error("操作作品需要明确来源");
    if (sourceId) {
      const actual = sourceId === BROWSER_SOURCE ? "browser" : "local";
      if (provider && provider !== actual) throw new Error("sourceId 与 provider 不一致");
      if (actual === "local") this.assertSource(sourceId);
      return { sourceId, provider: actual, id };
    }
    if (provider === "browser") return { sourceId: BROWSER_SOURCE, provider, id };
    if (provider === "local") return { sourceId: this.connectedSource(), provider, id };
    const found = this.state.filter((w) => w.ref.id === id);
    if (found.length !== 1) throw new Error("作品 ID 不明确，请先 work_list 并传入 ref.sourceId");
    return found[0]!.ref;
  }
  connectedSource() {
    const source = this.local.getSnapshot().sourceId;
    if (!source) throw new Error("请先连接本地 Runner");
    return source;
  }
  assertSource(sourceId: string) {
    if (this.connectedSource() !== sourceId)
      throw new Error("作品属于另一个 Runner，请连接原来的作品来源");
  }
  async read(ref: WorkRef, revision?: string, signal?: AbortSignal) {
    return ref.provider === "browser"
      ? this.browser.read(ref.id, revision)
      : this.call<Project>(
          ref.sourceId,
          "read",
          { id: ref.id, ...(revision ? { revision } : {}) },
          signal,
        );
  }
  async file(
    ref: WorkRef,
    revision: string,
    path: string,
    offset = 0,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (ref.provider === "local")
      return this.call(ref.sourceId, "file", { id: ref.id, revision, path, offset }, signal);
    const work = await this.browser.read(ref.id, revision);
    const file = work.files.find((f) => f.path === path);
    if (!file) throw new Error("作品文件不存在");
    if (
      file.artifact.size > 2 * 1024 * 1024 ||
      !/^(?:text\/|application\/(?:json|javascript))|^image\/svg\+xml/u.test(file.artifact.mime)
    )
      return { id: ref.id, revision, ...file, message: "使用 artifact 下载文件" };
    const text = await (await this.browser.files.read(file.artifact)).text();
    return {
      id: ref.id,
      revision,
      ...file,
      text: text.slice(offset, offset + 32000),
      nextOffset: offset + 32000 < text.length ? offset + 32000 : null,
    };
  }
  commit(input: WorkCommit, signal?: AbortSignal, owner?: symbol) {
    return this.browser.commit(input, signal, owner);
  }
  /** Local RPCs are always scoped to the authority selected by the caller. */
  async call<T>(
    sourceId: string,
    operation: string,
    input: unknown = {},
    signal?: AbortSignal,
    owner?: symbol,
  ): Promise<T> {
    this.assertSource(sourceId);
    if (["render", "parameters", "restore", "checkpoint"].includes(operation))
      this.local.assertClean((input as { id: string }).id, owner);
    const result = await this.local.call<T>(operation, input, signal);
    this.assertSource(sourceId);
    if (["parameters", "restore"].includes(operation)) await this.local.refresh();
    return result;
  }
  async startPreview(ref: WorkRef, jobId: string, signal?: AbortSignal) {
    const job = await this.call<Job>(ref.sourceId, "job", { id: jobId }, signal);
    if (job.request.id !== ref.id) throw new Error("预览任务不属于此作品");
    return this.local.startPreview(jobId, signal);
  }
  async versions(ref: WorkRef, cursor?: string, signal?: AbortSignal): Promise<VersionPage> {
    if (ref.provider === "local")
      return this.call(
        ref.sourceId,
        "versions",
        { id: ref.id, ...(cursor ? { cursor } : {}) },
        signal,
      );
    const [page, head] = await Promise.all([
      this.browser.history(ref.id, cursor),
      this.browser.read(ref.id),
    ]);
    return {
      head: head.revision,
      nextCursor: page.nextRevision,
      items: page.items.map((v) => ({
        id: v.revision,
        revision: v.revision,
        parent: v.parent,
        message:
          v.message ?? (v.restoredFrom ? `从 ${v.restoredFrom.slice(0, 8)} 恢复` : "保存作品"),
        kind: v.restoredFrom ? "restore" : "save",
        createdAt: v.updatedAt,
        ...(v.restoredFrom ? { restoredFrom: v.restoredFrom } : {}),
      })),
    };
  }
  checkpoint(ref: WorkRef, input: CheckpointRequest, signal?: AbortSignal) {
    if (input.id !== ref.id) throw new Error("检查点不属于此作品");
    return ref.provider === "local"
      ? this.call<Project>(ref.sourceId, "checkpoint", input, signal)
      : this.browser.commit(input, signal);
  }
  restore(ref: WorkRef, input: RestoreRequest, signal?: AbortSignal) {
    if (input.id !== ref.id) throw new Error("恢复请求不属于此作品");
    return ref.provider === "local"
      ? this.call<Project>(ref.sourceId, "restore", input, signal)
      : this.browser.commit(input, signal);
  }
  async diff(
    ref: WorkRef,
    from: string,
    to: string,
    path?: string,
    signal?: AbortSignal,
  ): Promise<VersionDiff> {
    if (ref.provider === "local")
      return this.call(
        ref.sourceId,
        "diff",
        { id: ref.id, from, to, ...(path ? { path } : {}) },
        signal,
      );
    const [a, b] = await Promise.all([
      this.browser.read(ref.id, from),
      this.browser.read(ref.id, to),
    ]);
    const files = (w: typeof a) =>
      w.files.map((f) => ({ path: f.path, hash: f.artifact.hash, size: f.artifact.size }));
    const result: VersionDiff = { from, to, changes: changedFiles(files(a), files(b)) };
    if (path) {
      if (!a.files.some((f) => f.path === path) && !b.files.some((f) => f.path === path))
        throw new Error("版本中没有此文件");
      const text = async (w: typeof a) => {
        const file = w.files.find((f) => f.path === path);
        if (!file) return null;
        if (file.artifact.size > 64000) return undefined;
        const bytes = new Uint8Array(
          await (await this.browser.files.read(file.artifact)).arrayBuffer(),
        );
        if (bytes.includes(0)) return undefined;
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          return undefined;
        }
      };
      const [before, after] = await Promise.all([text(a), text(b)]);
      result.detail = {
        path,
        before: before ?? null,
        after: after ?? null,
        ...(before === undefined || after === undefined
          ? { message: "二进制或超过 64 KB，仅显示文件差异" }
          : {}),
      };
    }
    signal?.throwIfAborted();
    return result;
  }
  async output(sourceId: string, jobId: string, name: string, signal?: AbortSignal) {
    const job = await this.call<Job>(sourceId, "job", { id: jobId }, signal);
    const output = job.outputs.find((o) => o.name === name);
    if (job.status !== "succeeded" || !output || output.size > 300 * 1024 * 1024)
      throw new Error("产物不存在或超过工作区读取限制，请用 CLI download");
    return this.local.output(jobId, name, signal);
  }
  reviewRead(ref: WorkRef, signal?: AbortSignal) {
    return ref.provider === "browser"
      ? this.browser.reviewRead(ref.id)
      : this.call<ReviewBook>(ref.sourceId, "review_read", { id: ref.id }, signal);
  }
  reviewEdit(ref: WorkRef, input: ReviewEdit, signal?: AbortSignal) {
    if (input.id !== ref.id) throw new Error("审阅操作不属于此作品");
    if (input.action.kind === "submit" && ref.provider === "local") this.local.assertClean(ref.id);
    return ref.provider === "browser"
      ? this.browser.reviewEdit(input, signal)
      : this.call<ReviewBook>(ref.sourceId, "review_edit", input, signal);
  }
  async reviewOutput(ref: WorkRef, output: ReviewOutput, signal?: AbortSignal) {
    if (ref.provider === "local") {
      if (!output.jobId) throw new Error("产物缺少任务身份");
      const blob = await this.output(ref.sourceId, output.jobId, output.name, signal);
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      signal?.throwIfAborted();
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
        "",
      );
      if (output.hashAlgorithm !== "sha256" || blob.size !== output.size || hash !== output.hash)
        throw new Error("审阅产物完整性校验失败");
      return blob;
    }
    if (output.hashAlgorithm !== "blake3") throw new Error("浏览器产物摘要类型无效");
    return this.browser.files.read({
      name: output.name,
      size: output.size,
      mime: output.mime,
      hash: output.hash,
    });
  }
  async reviewDocument(ref: WorkRef, submission: Submission, path: string, signal?: AbortSignal) {
    const page = (submission.pages ?? [{ path: submission.target.entry, output: "page" }]).find(
      (p) => p.path === path,
    );
    const output = submission.outputs.find((o) => o.key === page?.output && o.mime === "text/html");
    if (!output) throw new Error("此版本没有固定的页面产物，请提交新稿");
    return { output, html: await (await this.reviewOutput(ref, output, signal)).text() };
  }
  async capturePage(
    ref: WorkRef,
    submissionId: string,
    page: PageState,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<ReviewView> {
    const submission = (await this.reviewRead(ref, signal)).submissions.find(
      (s) => s.id === submissionId,
    );
    if (!submission || submission.target.runtime !== "html") throw new Error("页面审阅版本不存在");
    const sourceId = ref.provider === "local" ? ref.sourceId : this.connectedSource();
    const source =
      ref.provider === "local"
        ? { kind: "submission", id: ref.id, submissionId }
        : await (async () => {
            const { html, output } = await this.reviewDocument(ref, submission, page.path, signal);
            return { kind: "document", key: `${ref.id}:${submissionId}:${output.hash}`, html };
          })();
    const capture = await this.call<PageCapture>(
      sourceId,
      "page_capture",
      { source, page, requestId },
      signal,
    );
    let image = capture.image;
    if (ref.provider === "browser") {
      const blob = await this.reviewImage({ ...ref, provider: "local", sourceId }, image, signal);
      const artifact = await this.browser.files.import(blob, "page.png", signal);
      image = { ...artifact, mime: "image/png", hashAlgorithm: "blake3" };
    }
    return {
      id: capture.id,
      submissionId,
      title: `${page.path} · ${page.viewport.width} × ${page.viewport.height}`,
      page: capture.page,
      image,
      elements: capture.elements,
      warnings: capture.warnings,
      engine: capture.engine,
      createdAt: capture.createdAt,
    };
  }
  async reviewImage(ref: WorkRef, image: ReviewImage, signal?: AbortSignal): Promise<Blob> {
    if (ref.provider === "browser") {
      if (image.hashAlgorithm !== "blake3") throw new Error("浏览器截图摘要类型无效");
      return this.browser.files.read(image);
    }
    this.assertSource(ref.sourceId);
    if (!image.captureId || image.hashAlgorithm !== "sha256")
      throw new Error("截图缺少 Runner 身份");
    const blob = await this.local.pageImage(image.captureId, signal);
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    this.assertSource(ref.sourceId);
    if (blob.size !== image.size || hash !== image.hash) throw new Error("截图完整性校验失败");
    return blob;
  }
  async deliveryBundle(ref: WorkRef, delivery: Delivery, signal?: AbortSignal) {
    const saved = (await this.reviewRead(ref, signal)).deliveries.find((d) => d.id === delivery.id);
    if (!saved) throw new Error("交付清单不存在");
    if (
      saved.selections.flatMap((s) => s.outputs).reduce((n, o) => n + o.size, 0) >
      256 * 1024 * 1024
    )
      throw new Error("交付包超过 256 MiB，请用 CLI 逐个下载");
    const { ZipWriter, BlobWriter, BlobReader, TextReader } = await import("@zip.js/zip.js");
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    const options = { useWebWorkers: false, ...(signal ? { signal } : {}) };
    try {
      await writer.add(
        "delivery.json",
        new TextReader(JSON.stringify({ format: "bcr-delivery-1", work: ref, ...saved }, null, 2)),
        options,
      );
      for (const selection of saved.selections) {
        for (const [index, output] of selection.outputs.entries()) {
          signal?.throwIfAborted();
          const blob = await this.reviewOutput(ref, output, signal);
          await writer.add(
            `${selection.submissionId}/${index + 1}-${output.name.split("/").at(-1)}`,
            new BlobReader(blob),
            options,
          );
        }
      }
      return await writer.close();
    } catch (error) {
      await writer.close().catch(() => undefined);
      throw error;
    }
  }
  close() {
    for (const dispose of this.dispose) dispose();
    this.local.disconnect();
    this.preview.stop();
  }
}
