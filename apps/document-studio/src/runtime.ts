import { hashReadableStream, type ArtifactRef, type ComputeTask, type TaskHandle } from "@bcr/core";
import { Effect, Stream } from "effect";
import type { RuntimeServices } from "@bcr/react";
import {
  stageById,
  updateStage,
  type DocumentFormat,
  type DocumentJob,
  type DocumentStageId,
} from "@bcr/document-core";
import { documents } from "./store";

let taskSequence = 0;
const activeTasks = new Map<
  string,
  { readonly stageId: DocumentStageId; readonly handle: TaskHandle }
>();
const cancellationRequests = new Set<string>();

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLocaleLowerCase() || "bin";
}

/** Store a source in the shared runtime namespace so Worker tasks can consume it. */
export async function importDocumentFile(
  services: RuntimeServices,
  file: File,
): Promise<ArtifactRef> {
  const hash = await hashReadableStream(file.stream());
  const ref: ArtifactRef = {
    id: `document/source/${hash}`,
    type: `file/${extensionOf(file)}`,
    storage: "opfs",
    format: file.type || undefined,
    hash,
  };
  await Effect.runPromise(services.artifacts.putStream(ref, file.stream()));
  return ref;
}

function taskConfig(job: DocumentJob): Record<string, unknown> {
  return {
    format: job.format,
    sourceName: job.name,
    sizeBytes: job.size,
  };
}

function taskFor(job: DocumentJob, stageId: DocumentStageId): ComputeTask | undefined {
  if (stageId !== "extract" || job.sourceRef === undefined) return undefined;
  taskSequence += 1;
  return {
    id: `document-task-${Date.now().toString(36)}-${taskSequence.toString(36)}`,
    runtime: "wasm",
    operation: "document.extract",
    inputs: [{ ...job.sourceRef, port: "source" }],
    outputs: [
      {
        name: "sections",
        type: "document/sections",
        storage: "opfs",
        format: "json",
      },
    ],
    resources: { memoryMB: 256, threads: 1 },
    cache: { enabled: true },
    config: taskConfig(job),
  };
}

function currentJob(jobId: string): DocumentJob | undefined {
  return documents.getJob(jobId);
}

function patchStage(
  jobId: string,
  stageId: DocumentStageId,
  patch: Parameters<typeof updateStage>[2],
): void {
  const job = currentJob(jobId);
  if (job !== undefined) documents.replaceJob(updateStage(job, stageId, patch));
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Execute the first real Document stage through the shared Scheduler/WorkerPool. */
export async function runDocumentStage(
  services: RuntimeServices,
  job: DocumentJob,
  stageId: DocumentStageId,
): Promise<void> {
  const stage = stageById(job.stages, stageId);
  if (stage === undefined || stage.status === "running") return;
  if (stageId !== "extract") {
    documents.setNotice(`${stage.label} 仍等待对应的本地适配器`);
    return;
  }
  const task = taskFor(job, stageId);
  if (task === undefined) {
    documents.setNotice(`${job.name} 没有可消费的源 Artifact，请重新导入文件`);
    return;
  }

  cancellationRequests.delete(job.id);
  patchStage(job.id, stageId, { status: "running", progress: 0, error: undefined });
  try {
    const handle = await Effect.runPromise(services.scheduler.submit(task));
    activeTasks.set(job.id, { stageId, handle });
    Effect.runFork(
      Stream.runForEach(handle.events, (event) =>
        Effect.sync(() => {
          if (event.type === "progress") {
            patchStage(job.id, stageId, { status: "running", progress: event.value });
          }
        }),
      ).pipe(Effect.catchAll(() => Effect.void)),
    );
    const outputs = await Effect.runPromise(handle.await);
    cancellationRequests.delete(job.id);
    const artifact = outputs[0];
    patchStage(job.id, stageId, {
      status: "done",
      progress: 1,
      ...(artifact === undefined ? {} : { artifact }),
    });
    documents.setNotice(
      `${job.name} Extract ${handle.cached ? "命中缓存" : "完成"}；结构化章节 Artifact 已就绪`,
    );
  } catch (reason) {
    if (cancellationRequests.delete(job.id)) {
      patchStage(job.id, stageId, { status: "idle", progress: 0, error: undefined });
      documents.setNotice(`${job.name} ${stage.label} 已取消`);
      return;
    }
    const message = errorMessage(reason);
    patchStage(job.id, stageId, { status: "error", progress: 0, error: message });
    documents.setNotice(`${job.name} Extract 失败：${message}`);
  } finally {
    const active = activeTasks.get(job.id);
    if (active?.stageId === stageId) activeTasks.delete(job.id);
  }
}

export async function cancelDocumentStage(jobId: string, stageId: DocumentStageId): Promise<void> {
  const active = activeTasks.get(jobId);
  if (active === undefined || active.stageId !== stageId) return;
  cancellationRequests.add(jobId);
  await Effect.runPromise(active.handle.cancel);
}

export function isExtractableFormat(format: DocumentFormat): boolean {
  return ["txt", "markdown", "html", "fb2"].includes(format);
}
