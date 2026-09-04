import { contentHash, type ArtifactRef, type ComputeTask, type TaskHandle } from "@bcr/core";
import { Effect, Stream } from "effect";
import type { RuntimeServices } from "@bcr/react";
import {
  documentOcrSettings,
  documentExportFileName,
  invalidateDownstream,
  serializeDocumentExport,
  stageById,
  supportsDocumentTextExtract,
  updateStage,
  type DocumentFormat,
  type DocumentOcrSettings,
  type DocumentContentPackage,
  type DocumentJob,
  type DocumentExportFormat,
  type DocumentExportView,
  type DocumentStageId,
  type DocumentTranslationPackage,
} from "@bcr/document-core";
import { documents } from "./store";

export {
  importDocumentExportBundle,
  importDocumentFile,
  importDocumentHandoff,
} from "./documentIngest";
export { saveDocumentOcrReview, saveDocumentTranslationReview } from "./documentReviews";

let taskSequence = 0;
const activeOcrPreloads = new Map<string, Promise<void>>();
const activeTasks = new Map<
  string,
  { readonly stageId: DocumentStageId; readonly handle: TaskHandle }
>();
const cancellationRequests = new Set<string>();

function taskConfig(job: DocumentJob): Record<string, unknown> {
  return {
    format: job.format,
    sourceName: job.name,
    sizeBytes: job.size,
  };
}

function inputForStage(job: DocumentJob, stageId: DocumentStageId): ArtifactRef | undefined {
  if (stageId === "extract") return job.sourceRef;
  if (stageId === "ocr") return job.format === "image" ? job.sourceRef : undefined;
  if (stageId === "translate") {
    return stageById(job.stages, "extract")?.artifact ?? stageById(job.stages, "ocr")?.artifact;
  }
  if (stageId === "typeset") return stageById(job.stages, "translate")?.artifact;
  return undefined;
}

function operationForStage(job: DocumentJob, stageId: DocumentStageId): string | undefined {
  if (stageId === "extract") return "document.extract";
  if (stageId === "ocr" && job.format === "image") return "document.ocr.onnx";
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
  if (stageId === "ocr") {
    return [{ name: "content", type: "document/content-package", storage: "opfs", format: "json" }];
  }
  return [{ name: "typeset", type: "document/typeset-preview", storage: "opfs", format: "json" }];
}

function taskFor(job: DocumentJob, stageId: DocumentStageId): ComputeTask | undefined {
  const input = inputForStage(job, stageId);
  const operation = operationForStage(job, stageId);
  if (input === undefined || operation === undefined) return undefined;
  const ocr = documentOcrSettings(job.ocr);
  const needsGpu =
    stageId === "ocr" &&
    (ocr.device === "webgpu" ||
      (ocr.device === "auto" && typeof navigator !== "undefined" && "gpu" in navigator));
  taskSequence += 1;
  return {
    id: `document-task-${Date.now().toString(36)}-${taskSequence.toString(36)}`,
    runtime: "wasm",
    operation,
    inputs: [{ ...input, port: "source" }],
    outputs: outputForStage(stageId),
    resources:
      stageId === "ocr"
        ? { memoryMB: 1536, threads: 1, ...(needsGpu ? { gpu: true } : {}) }
        : { memoryMB: 256, threads: 1 },
    cache: { enabled: true },
    config: {
      ...taskConfig(job),
      ...(stageId === "ocr"
        ? {
            adapter: ocr.adapter,
            model: ocr.model,
            device: ocr.device,
            sourceLanguage: ocr.sourceLanguage,
            // The first Document adapter is deliberately a single full-page
            // region. Manga remains the route for dense multi-region pages.
            regions: [
              {
                id: "page-1",
                label: "Page 1",
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                rotation: 0,
                writingMode: "horizontal-tb",
                sourceText: "",
                confidence: 0,
              },
            ],
          }
        : {}),
    },
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
    operationForStage(job, stageId) !== undefined
  );
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

/** Warm the shared OCR model/cache without touching a document page. */
export async function preloadDocumentOcrModel(
  services: RuntimeServices,
  settings: DocumentOcrSettings,
): Promise<void> {
  const key = `${settings.adapter}:${settings.model}:${settings.sourceLanguage}:${settings.device}`;
  const active = activeOcrPreloads.get(key);
  if (active !== undefined) {
    await active;
    return;
  }
  const needsGpu =
    settings.device === "webgpu" ||
    (settings.device === "auto" && typeof navigator !== "undefined" && "gpu" in navigator);
  const task: ComputeTask = {
    id: `document-ocr-preload-${Date.now().toString(36)}-${(++taskSequence).toString(36)}`,
    runtime: "wasm",
    operation: "manga.model.preload",
    inputs: [],
    outputs: [],
    resources: { memoryMB: 1536, threads: 1, ...(needsGpu ? { gpu: true } : {}) },
    // Transformers.js owns model byte caching; the Scheduler should not
    // mistake an empty output list for a reusable document result.
    cache: { enabled: false },
    config: {
      kind: "ocr",
      adapter: settings.adapter,
      model: settings.model,
      sourceLanguage: settings.sourceLanguage,
      device: settings.device,
      offlineOnly: typeof navigator !== "undefined" && navigator.onLine === false,
    },
  };
  const promise = (async () => {
    const handle = await Effect.runPromise(services.scheduler.submit(task));
    await Effect.runPromise(handle.await);
  })();
  activeOcrPreloads.set(key, promise);
  try {
    await promise;
  } finally {
    if (activeOcrPreloads.get(key) === promise) activeOcrPreloads.delete(key);
  }
}

export interface DocumentExportArtifact {
  readonly ref: ArtifactRef;
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly mime: string;
}

/** Persist a canonical export before exposing a browser download. */
export async function exportDocumentPackage(
  services: RuntimeServices,
  job: DocumentJob,
  content: DocumentContentPackage,
  translation: DocumentTranslationPackage | undefined,
  format: DocumentExportFormat,
  view: DocumentExportView = translation === undefined ? "source" : "bilingual",
): Promise<DocumentExportArtifact> {
  const payload = serializeDocumentExport(content, translation, format, view);
  const bytes = new TextEncoder().encode(payload.text);
  const hash = contentHash(bytes);
  const ref: ArtifactRef = {
    id: `document/export/${hash}`,
    type: "document/export",
    storage: "opfs",
    format: payload.mime,
    hash,
  };
  await Effect.runPromise(services.artifacts.put(ref, bytes));
  const completedAt = Date.now();
  const current = currentJob(job.id);
  if (current !== undefined) {
    documents.replaceJob(
      updateStage(current, "export", {
        status: "done",
        progress: 1,
        completedAt,
        durationMs: 0,
        artifact: ref,
        adapter: `document.export.${format}`,
        capability: "adapter",
        execution: {
          runtime: "js",
          operation: `document.export.${format}`,
          cache: "disabled",
        },
      }),
    );
  }
  return {
    ref,
    bytes,
    fileName: documentExportFileName(job.name, payload),
    mime: payload.mime,
  };
}

/** Execute the first real Document stage through the shared Scheduler/WorkerPool. */
export async function runDocumentStage(
  services: RuntimeServices,
  job: DocumentJob,
  stageId: DocumentStageId,
): Promise<void> {
  const current = currentJob(job.id) ?? job;
  const originalStage = stageById(current.stages, stageId);
  if (originalStage === undefined || originalStage.status === "running") return;
  if (originalStage.capability === "planned") {
    documents.setNotice(`${originalStage.label} 仍等待对应的本地适配器`);
    return;
  }
  if (!canRunDocumentStage(current, stageId)) {
    documents.setNotice(
      `${current.name} 的 ${originalStage.label} 缺少上游 Artifact，请先完成前置阶段`,
    );
    return;
  }
  const prepared = invalidateDownstream(current, stageId);
  documents.replaceJob(prepared);
  const stage = stageById(prepared.stages, stageId);
  if (stage === undefined || stage.status === "running") return;
  const task = taskFor(prepared, stageId);
  if (task === undefined) {
    documents.setNotice(`${prepared.name} 的 ${stage.label} 缺少上游 Artifact，请先完成前置阶段`);
    return;
  }

  cancellationRequests.delete(prepared.id);
  const startedAt = Date.now();
  patchStage(prepared.id, stageId, {
    status: "running",
    progress: 0,
    error: undefined,
    attempts: (stage.attempts ?? 0) + 1,
    startedAt,
    completedAt: undefined,
    durationMs: undefined,
    execution: {
      runtime: task.runtime,
      operation: task.operation,
      cache: task.cache?.enabled === false ? "disabled" : undefined,
    },
  });
  try {
    const handle = await Effect.runPromise(services.scheduler.submit(task));
    activeTasks.set(prepared.id, { stageId, handle });
    Effect.runFork(
      Stream.runForEach(handle.events, (event) =>
        Effect.sync(() => {
          if (event.type === "progress") {
            patchStage(prepared.id, stageId, { status: "running", progress: event.value });
          }
        }),
      ).pipe(Effect.catchAll(() => Effect.void)),
    );
    const outputs = await Effect.runPromise(handle.await);
    cancellationRequests.delete(prepared.id);
    const artifact = outputs[0];
    const completedAt = Date.now();
    patchStage(prepared.id, stageId, {
      status: "done",
      progress: 1,
      completedAt,
      durationMs: completedAt - startedAt,
      execution: {
        runtime: task.runtime,
        operation: task.operation,
        cache: task.cache?.enabled === false ? "disabled" : handle.cached ? "hit" : "miss",
      },
      ...(artifact === undefined ? {} : { artifact }),
    });
    documents.setNotice(
      `${prepared.name} ${stage.label} ${handle.cached ? "命中缓存" : "完成"}；Artifact 已就绪`,
    );
  } catch (reason) {
    if (cancellationRequests.delete(prepared.id)) {
      const completedAt = Date.now();
      patchStage(prepared.id, stageId, {
        status: "idle",
        progress: 0,
        error: undefined,
        completedAt,
        durationMs: completedAt - startedAt,
      });
      documents.setNotice(`${prepared.name} ${stage.label} 已取消`);
      return;
    }
    const message = errorMessage(reason);
    const completedAt = Date.now();
    patchStage(prepared.id, stageId, {
      status: "error",
      progress: 0,
      error: message,
      completedAt,
      durationMs: completedAt - startedAt,
    });
    documents.setNotice(`${prepared.name} ${stage.label} 失败：${message}`);
  } finally {
    const active = activeTasks.get(prepared.id);
    if (active?.stageId === stageId) activeTasks.delete(prepared.id);
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
