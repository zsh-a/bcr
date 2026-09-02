import {
  contentHash,
  hashReadableStream,
  type ArtifactRef,
  type ComputeTask,
  type TaskHandle,
} from "@bcr/core";
import { Effect, Stream } from "effect";
import type { RuntimeServices } from "@bcr/react";
import {
  createDocumentTranslationPackage,
  stageById,
  supportsDocumentTextExtract,
  updateStage,
  type DocumentFormat,
  type DocumentJob,
  type DocumentStageId,
  type DocumentTranslationPackage,
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

function inputForStage(job: DocumentJob, stageId: DocumentStageId): ArtifactRef | undefined {
  if (stageId === "extract") return job.sourceRef;
  if (stageId === "translate") return stageById(job.stages, "extract")?.artifact;
  if (stageId === "typeset") return stageById(job.stages, "translate")?.artifact;
  return undefined;
}

function operationForStage(stageId: DocumentStageId): string | undefined {
  if (stageId === "extract") return "document.extract";
  if (stageId === "translate") return "document.translate.fixture";
  if (stageId === "typeset") return "document.typeset.preview";
  return undefined;
}

function outputForStage(stageId: DocumentStageId): ComputeTask["outputs"] {
  if (stageId === "extract") {
    return [{ name: "content", type: "document/content-package", storage: "opfs", format: "json" }];
  }
  if (stageId === "translate") {
    return [
      {
        name: "translation",
        type: "document/translation-package",
        storage: "opfs",
        format: "json",
      },
    ];
  }
  return [{ name: "typeset", type: "document/typeset-preview", storage: "opfs", format: "json" }];
}

function taskFor(job: DocumentJob, stageId: DocumentStageId): ComputeTask | undefined {
  const input = inputForStage(job, stageId);
  const operation = operationForStage(stageId);
  if (input === undefined || operation === undefined) return undefined;
  taskSequence += 1;
  return {
    id: `document-task-${Date.now().toString(36)}-${taskSequence.toString(36)}`,
    runtime: "wasm",
    operation,
    inputs: [{ ...input, port: "source" }],
    outputs: outputForStage(stageId),
    resources: { memoryMB: 256, threads: 1 },
    cache: { enabled: true },
    config: taskConfig(job),
  };
}

export function canRunDocumentStage(job: DocumentJob, stageId: DocumentStageId): boolean {
  const stage = stageById(job.stages, stageId);
  return (
    stage !== undefined &&
    stage.status !== "running" &&
    stage.status !== "blocked" &&
    stage.capability !== "planned" &&
    (stageId !== "extract" || supportsDocumentTextExtract(job.format)) &&
    inputForStage(job, stageId) !== undefined &&
    operationForStage(stageId) !== undefined
  );
}

/** Persist a human review as a new immutable Translation Package Artifact. */
export async function saveDocumentTranslationReview(
  services: RuntimeServices,
  job: DocumentJob,
  translation: DocumentTranslationPackage,
  updates: Readonly<Record<string, string>>,
): Promise<void> {
  const changed = translation.blocks.some(
    (block) => Object.hasOwn(updates, block.id) && updates[block.id] !== block.translatedText,
  );
  if (!changed) {
    documents.setNotice("没有检测到译文修改");
    return;
  }
  const blocks = translation.blocks.map((block) => {
    if (!Object.hasOwn(updates, block.id)) return block;
    const translatedText = updates[block.id]?.replace(/\r\n?/gu, "\n").trim() ?? "";
    return {
      ...block,
      translatedText,
      status: translatedText.length > 0 ? ("translated" as const) : ("needs-review" as const),
    };
  });
  const payload = createDocumentTranslationPackage({
    id: translation.id,
    sourceContentId: translation.sourceContentId,
    sourceName: translation.sourceName,
    format: translation.format,
    ...(translation.sourceLanguage === undefined
      ? {}
      : { sourceLanguage: translation.sourceLanguage }),
    targetLanguage: translation.targetLanguage,
    metadata: translation.metadata,
    ...(translation.sourceRef === undefined ? {} : { sourceRef: translation.sourceRef }),
    blocks,
    adapter: "review.manual",
  });
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = contentHash(bytes);
  const artifact: ArtifactRef = {
    id: `document/translations/review/${hash}`,
    type: "document/translation-package",
    storage: "opfs",
    format: "json",
    hash,
  };
  await Effect.runPromise(services.artifacts.put(artifact, bytes));
  const current = currentJob(job.id);
  if (current !== undefined) {
    const stage = stageById(current.stages, "translate");
    documents.replaceJob(
      updateStage(current, "translate", {
        status: "done",
        progress: 1,
        artifact,
        adapter: "review.manual",
        ...(stage?.completedAt === undefined ? {} : { completedAt: stage.completedAt }),
      }),
    );
  }
  documents.setNotice("人工修订已保存为新的 Translation Package");
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
  if (stage.capability === "planned") {
    documents.setNotice(`${stage.label} 仍等待对应的本地适配器`);
    return;
  }
  const task = taskFor(job, stageId);
  if (task === undefined) {
    documents.setNotice(`${job.name} 的 ${stage.label} 缺少上游 Artifact，请先完成前置阶段`);
    return;
  }

  cancellationRequests.delete(job.id);
  const startedAt = Date.now();
  patchStage(job.id, stageId, {
    status: "running",
    progress: 0,
    error: undefined,
    attempts: (stage.attempts ?? 0) + 1,
    startedAt,
    completedAt: undefined,
    durationMs: undefined,
  });
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
    const completedAt = Date.now();
    patchStage(job.id, stageId, {
      status: "done",
      progress: 1,
      completedAt,
      durationMs: completedAt - startedAt,
      ...(artifact === undefined ? {} : { artifact }),
    });
    documents.setNotice(
      `${job.name} ${stage.label} ${handle.cached ? "命中缓存" : "完成"}；Artifact 已就绪`,
    );
  } catch (reason) {
    if (cancellationRequests.delete(job.id)) {
      const completedAt = Date.now();
      patchStage(job.id, stageId, {
        status: "idle",
        progress: 0,
        error: undefined,
        completedAt,
        durationMs: completedAt - startedAt,
      });
      documents.setNotice(`${job.name} ${stage.label} 已取消`);
      return;
    }
    const message = errorMessage(reason);
    const completedAt = Date.now();
    patchStage(job.id, stageId, {
      status: "error",
      progress: 0,
      error: message,
      completedAt,
      durationMs: completedAt - startedAt,
    });
    documents.setNotice(`${job.name} ${stage.label} 失败：${message}`);
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
  return supportsDocumentTextExtract(format);
}
