import type {
  PageState,
  PageCapture,
  ReviewView,
  ReviewImage,
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
import { RunnerClient } from "./runner";

/**
 * Works is a control plane for projects owned by a Runner. Source files never
 * enter browser storage; every operation is pinned to the Runner source that
 * returned the Work reference.
 */
export class WorkService {
  readonly runner: RunnerClient;
  private state: readonly WorkSummary[] = [];
  private listeners = new Set<() => void>();
  private dispose: (() => void)[];

  constructor(runner = new RunnerClient()) {
    this.runner = runner;
    this.dispose = [runner.subscribe(this.publish)];
    this.publish();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private publish = () => {
    this.state = this.runner
      .getSnapshot()
      .items.map(({ ref, title, revision, targets, capabilities }): WorkSummary => ({
        ref,
        title,
        revision,
        targets,
        capabilities,
      }));
    for (const listener of this.listeners) listener();
  };

  async list() {
    await this.runner.refresh();
    return this.state;
  }

  connectedSource() {
    const source = this.runner.getSnapshot().sourceId;
    if (!source) throw new Error("请先连接 Runner");
    return source;
  }

  assertSource(sourceId: string) {
    if (this.connectedSource() !== sourceId)
      throw new Error("作品属于另一个 Runner，请连接原来的作品来源");
  }

  read(ref: WorkRef, revision?: string, signal?: AbortSignal) {
    return this.call<Project>(
      ref.sourceId,
      "read",
      { id: ref.id, ...(revision ? { revision } : {}) },
      signal,
    );
  }

  file(ref: WorkRef, revision: string, path: string, offset = 0, signal?: AbortSignal) {
    return this.call(ref.sourceId, "file", { id: ref.id, revision, path, offset }, signal);
  }

  async call<T>(
    sourceId: string,
    operation: string,
    input: unknown = {},
    signal?: AbortSignal,
    owner?: symbol,
  ): Promise<T> {
    this.assertSource(sourceId);
    if (["render", "parameters", "restore", "checkpoint"].includes(operation))
      this.runner.assertClean((input as { id: string }).id, owner);
    const result = await this.runner.call<T>(operation, input, signal);
    this.assertSource(sourceId);
    if (["parameters", "restore"].includes(operation)) await this.runner.refresh();
    return result;
  }

  async startPreview(ref: WorkRef, jobId: string, signal?: AbortSignal) {
    const job = await this.call<Job>(ref.sourceId, "job", { id: jobId }, signal);
    if (job.request.id !== ref.id) throw new Error("预览任务不属于此作品");
    return this.runner.startPreview(jobId, signal);
  }

  versions(ref: WorkRef, cursor?: string, signal?: AbortSignal): Promise<VersionPage> {
    return this.call(
      ref.sourceId,
      "versions",
      { id: ref.id, ...(cursor ? { cursor } : {}) },
      signal,
    );
  }

  checkpoint(ref: WorkRef, input: CheckpointRequest, signal?: AbortSignal) {
    if (input.id !== ref.id) throw new Error("检查点不属于此作品");
    return this.call<Project>(ref.sourceId, "checkpoint", input, signal);
  }

  restore(ref: WorkRef, input: RestoreRequest, signal?: AbortSignal) {
    if (input.id !== ref.id) throw new Error("恢复请求不属于此作品");
    return this.call<Project>(ref.sourceId, "restore", input, signal);
  }

  diff(ref: WorkRef, from: string, to: string, path?: string, signal?: AbortSignal) {
    return this.call<VersionDiff>(
      ref.sourceId,
      "diff",
      { id: ref.id, from, to, ...(path ? { path } : {}) },
      signal,
    );
  }

  async output(sourceId: string, jobId: string, name: string, signal?: AbortSignal) {
    const job = await this.call<Job>(sourceId, "job", { id: jobId }, signal);
    const output = job.outputs.find((item) => item.name === name);
    if (job.status !== "succeeded" || !output || output.size > 300 * 1024 * 1024)
      throw new Error("产物不存在或超过工作区读取限制，请用 CLI download");
    return this.runner.output(jobId, name, signal);
  }

  reviewRead(ref: WorkRef, signal?: AbortSignal) {
    return this.call<ReviewBook>(ref.sourceId, "review_read", { id: ref.id }, signal);
  }

  reviewEdit(ref: WorkRef, input: ReviewEdit, signal?: AbortSignal) {
    if (input.id !== ref.id) throw new Error("审阅操作不属于此作品");
    if (input.action.kind === "submit") this.runner.assertClean(ref.id);
    return this.call<ReviewBook>(ref.sourceId, "review_edit", input, signal);
  }

  async reviewOutput(ref: WorkRef, output: ReviewOutput, signal?: AbortSignal): Promise<Blob> {
    if (!output.jobId) throw new Error("产物缺少任务身份");
    const blob = await this.output(ref.sourceId, output.jobId, output.name, signal);
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    signal?.throwIfAborted();
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (output.hashAlgorithm !== "sha256" || blob.size !== output.size || hash !== output.hash)
      throw new Error("审阅产物完整性校验失败");
    return blob;
  }

  async capturePage(
    ref: WorkRef,
    submissionId: string,
    page: PageState,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<ReviewView> {
    const submission = (await this.reviewRead(ref, signal)).submissions.find(
      (item) => item.id === submissionId,
    );
    if (!submission || submission.target.runtime !== "html") throw new Error("页面审阅版本不存在");
    const capture = await this.call<PageCapture>(
      ref.sourceId,
      "page_capture",
      { source: { kind: "submission", id: ref.id, submissionId }, page, requestId },
      signal,
    );
    return {
      id: capture.id,
      submissionId,
      title: `${page.path} · ${page.viewport.width} × ${page.viewport.height}`,
      page: capture.page,
      image: capture.image,
      elements: capture.elements,
      warnings: capture.warnings,
      engine: capture.engine,
      createdAt: capture.createdAt,
    };
  }

  async reviewImage(ref: WorkRef, image: ReviewImage, signal?: AbortSignal): Promise<Blob> {
    this.assertSource(ref.sourceId);
    if (!image.captureId || image.hashAlgorithm !== "sha256")
      throw new Error("截图缺少 Runner 身份");
    const blob = await this.runner.pageImage(image.captureId, signal);
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    this.assertSource(ref.sourceId);
    if (blob.size !== image.size || hash !== image.hash) throw new Error("截图完整性校验失败");
    return blob;
  }

  async deliveryBundle(ref: WorkRef, delivery: Delivery, signal?: AbortSignal) {
    const saved = (await this.reviewRead(ref, signal)).deliveries.find(
      (item) => item.id === delivery.id,
    );
    if (!saved) throw new Error("交付清单不存在");
    if (
      saved.selections
        .flatMap((selection) => selection.outputs)
        .reduce((size, output) => size + output.size, 0) >
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
    this.runner.disconnect();
  }
}

export const workKey = (ref: WorkRef) => `${ref.sourceId}:${ref.id}`;
export const workRoute = (ref: WorkRef) =>
  `/works?${new URLSearchParams({ source: ref.sourceId, work: ref.id })}`;
