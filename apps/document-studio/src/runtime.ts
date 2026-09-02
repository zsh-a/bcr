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
  createDocumentContentPackage,
  createDocumentJob,
  createDocumentTranslationPackage,
  decodeDocumentExportBundle,
  decodeDocumentContentPackage,
  decodeDocumentTranslationPackage,
  documentOcrSettings,
  documentContentText,
  documentExportFileName,
  invalidateDownstream,
  markReadyStages,
  serializeDocumentExport,
  stageById,
  supportsDocumentTextExtract,
  updateStage,
  type DocumentFormat,
  type DocumentOcrSettings,
  type DocumentHandoff,
  type DocumentContentPackage,
  type DocumentJob,
  type DocumentExportFormat,
  type DocumentExportView,
  type DocumentStageId,
  type DocumentTranslationPackage,
} from "@bcr/document-core";
import { documents } from "./store";

let taskSequence = 0;
const activeOcrPreloads = new Map<string, Promise<void>>();
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

function mimeForDocumentFormat(format: DocumentFormat): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "epub":
      return "application/epub+zip";
    case "cbz":
      return "application/vnd.comicbook+zip";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "html":
      return "text/html";
    case "markdown":
      return "text/markdown";
    case "image":
      return "image/*";
    default:
      return "text/plain";
  }
}

async function packageFromArtifact<T>(
  services: RuntimeServices,
  ref: ArtifactRef,
  decode: (value: unknown) => T | undefined,
): Promise<T> {
  const bytes = await Effect.runPromise(services.artifacts.get(ref));
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error(`Document handoff Artifact ${ref.id} 不是有效 JSON`);
  }
  const decoded = decode(value);
  if (decoded === undefined) throw new Error(`Document handoff Artifact ${ref.id} 契约校验失败`);
  return decoded;
}

async function writeContentPackage(
  services: RuntimeServices,
  content: DocumentContentPackage,
  prefix: string,
): Promise<ArtifactRef> {
  const bytes = new TextEncoder().encode(JSON.stringify(content));
  const hash = contentHash(bytes);
  const ref: ArtifactRef = {
    id: `document/content/${prefix}/${hash}`,
    type: "document/content-package",
    storage: "opfs",
    format: "json",
    hash,
  };
  await Effect.runPromise(services.artifacts.put(ref, bytes));
  return ref;
}

async function writeTranslationPackage(
  services: RuntimeServices,
  translation: DocumentTranslationPackage,
  prefix: string,
): Promise<ArtifactRef> {
  const bytes = new TextEncoder().encode(JSON.stringify(translation));
  const hash = contentHash(bytes);
  const ref: ArtifactRef = {
    id: `document/translation/${prefix}/${hash}`,
    type: "document/translation-package",
    storage: "opfs",
    format: "json",
    hash,
  };
  await Effect.runPromise(services.artifacts.put(ref, bytes));
  return ref;
}

/**
 * Manga hands Document a visual Content Package after OCR/review. Keep the
 * provenance boundary explicit so an arbitrary image package cannot make the
 * planned OCR capability look complete.
 */
function isVisualOcrContent(content: DocumentContentPackage): boolean {
  if (content.format !== "image") return false;
  const adapter = content.provenance.adapter;
  return (
    adapter.startsWith("manga.ocr.") ||
    adapter === "manga.review.regions" ||
    adapter.startsWith("document.ocr.")
  );
}

/** Rebuild a durable Document job from a Reader/Manga handoff. */
export async function importDocumentHandoff(
  services: RuntimeServices,
  handoff: DocumentHandoff,
): Promise<{ readonly job: DocumentJob; readonly file: File }> {
  const file =
    handoff.file ??
    (handoff.sourceRef === undefined
      ? undefined
      : new File(
          [await Effect.runPromise(services.artifacts.getBlob(handoff.sourceRef))],
          handoff.name,
          { type: handoff.sourceRef.format ?? mimeForDocumentFormat(handoff.format) },
        ));
  if (file === undefined) {
    throw new Error("Document handoff 缺少可恢复的 source Artifact，请回到来源工作台重新交接");
  }
  const sourceRef = await importDocumentFile(services, file);
  const content =
    handoff.content ??
    (handoff.contentRef === undefined
      ? undefined
      : await packageFromArtifact(services, handoff.contentRef, decodeDocumentContentPackage));
  const translation =
    handoff.translation ??
    (handoff.translationRef === undefined
      ? undefined
      : await packageFromArtifact(
          services,
          handoff.translationRef,
          decodeDocumentTranslationPackage,
        ));
  const contentRef =
    content === undefined
      ? undefined
      : (handoff.contentRef ?? (await writeContentPackage(services, content, "handoff")));
  const translationRef =
    translation === undefined
      ? undefined
      : (handoff.translationRef ??
        (await writeTranslationPackage(services, translation, "handoff")));
  let job = markReadyStages(
    createDocumentJob({
      id: `document-handoff-${handoff.id}`,
      name: handoff.name,
      format: handoff.format,
      size: handoff.size || file.size,
      sourceRef,
      sourceTextPreview:
        content === undefined
          ? undefined
          : documentContentText(content).replace(/\s+/gu, " ").trim().slice(0, 240),
    }),
  );
  const completedAt = Date.now();
  if (contentRef !== undefined) {
    job = updateStage(job, "extract", {
      status: "done",
      progress: 1,
      completedAt,
      artifact: contentRef,
      adapter: content?.provenance.adapter ?? "handoff.content",
    });
    if (content !== undefined && isVisualOcrContent(content)) {
      job = updateStage(job, "ocr", {
        status: "done",
        progress: 1,
        completedAt,
        artifact: contentRef,
        adapter: content.provenance.adapter,
        capability: "adapter",
        execution: {
          runtime: "wasm",
          operation: content.provenance.adapter,
          cache: "disabled",
        },
      });
    } else if (content !== undefined && job.format === "image") {
      // A pre-existing image Content Package is not proof that pixels were
      // recognized. Keep OCR explicitly blocked until Manga or this Worker
      // supplies visual provenance.
      job = updateStage(job, "ocr", {
        status: "blocked",
        progress: 0,
        capability: "planned",
        detail: "该图片内容包没有视觉 OCR provenance，请交给 Manga 或重新运行 OCR",
      });
    }
  }
  if (translationRef !== undefined) {
    job = updateStage(job, "translate", {
      status: "done",
      progress: 1,
      completedAt,
      artifact: translationRef,
      adapter: translation?.provenance.adapter ?? "handoff.translation",
    });
  }
  return { job, file };
}

/** Rehydrate a Document job from its lossless JSON Export Bundle. */
export async function importDocumentExportBundle(
  services: RuntimeServices,
  file: File,
): Promise<{ readonly job: DocumentJob; readonly file: File }> {
  let value: unknown;
  try {
    value = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`${file.name} 不是有效的 Document Export Bundle`);
  }
  const bundle = decodeDocumentExportBundle(value);
  if (bundle === undefined) throw new Error(`${file.name} 的 Export Bundle 契约校验失败`);
  const sourceRef = bundle.content.sourceRef;
  if (sourceRef === undefined) {
    throw new Error("Document Export Bundle 缺少 source Artifact，无法恢复源文件");
  }
  let sourceBlob: Blob;
  try {
    sourceBlob = await Effect.runPromise(services.artifacts.getBlob(sourceRef));
  } catch {
    throw new Error(`Document Export Bundle 的 source Artifact 不可用：${sourceRef.id}`);
  }
  const sourceFile = new File([sourceBlob], bundle.content.sourceName, {
    type: sourceRef.format ?? mimeForDocumentFormat(bundle.content.format),
  });
  const imported = await importDocumentHandoff(services, {
    id: `document-export-${contentHash(new TextEncoder().encode(file.name)).slice(0, 16)}`,
    jobId: bundle.content.id,
    target: "document",
    name: bundle.content.sourceName,
    format: bundle.content.format,
    size: sourceFile.size,
    file: sourceFile,
    sourceRef,
    content: bundle.content,
    ...(bundle.translation === undefined ? {} : { translation: bundle.translation }),
    createdAt: Date.now(),
  });
  return { job: imported.job, file: imported.file };
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
    const reviewed = updateStage(current, "translate", {
      status: "done",
      progress: 1,
      artifact,
      adapter: "review.manual",
      ...(stage?.completedAt === undefined ? {} : { completedAt: stage.completedAt }),
    });
    documents.replaceJob(invalidateDownstream(reviewed, "translate"));
  }
  documents.setNotice("人工修订已保存为新的 Translation Package");
}

/** Persist OCR text corrections while retaining the original geometry. */
export async function saveDocumentOcrReview(
  services: RuntimeServices,
  job: DocumentJob,
  content: DocumentContentPackage,
  updates: Readonly<Record<string, string>>,
): Promise<void> {
  const changed = content.blocks.some(
    (block) => Object.hasOwn(updates, block.id) && updates[block.id] !== block.text,
  );
  if (!changed) {
    documents.setNotice("没有检测到 OCR 文本修改");
    return;
  }
  const blocks = content.blocks.map((block) => {
    if (!Object.hasOwn(updates, block.id)) return block;
    return {
      ...block,
      text: updates[block.id]?.replace(/\r\n?/gu, "\n").trim() ?? "",
    };
  });
  const payload = createDocumentContentPackage({
    id: content.id,
    format: content.format,
    sourceName: content.sourceName,
    metadata: content.metadata,
    ...(content.sourceRef === undefined ? {} : { sourceRef: content.sourceRef }),
    ...(content.provenance.sourceHash === undefined
      ? {}
      : { sourceHash: content.provenance.sourceHash }),
    blocks,
    adapter: "document.ocr.review",
  });
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = contentHash(bytes);
  const artifact: ArtifactRef = {
    id: `document/content/review/${hash}`,
    type: "document/content-package",
    storage: "opfs",
    format: "json",
    hash,
  };
  await Effect.runPromise(services.artifacts.put(artifact, bytes));
  const current = currentJob(job.id);
  if (current !== undefined) {
    const stage = stageById(current.stages, "ocr");
    const reviewed = updateStage(current, "ocr", {
      status: "done",
      progress: 1,
      artifact,
      adapter: "document.ocr.review",
      execution: {
        runtime: "js",
        operation: "document.ocr.review",
        cache: "disabled",
      },
      ...(stage?.completedAt === undefined ? {} : { completedAt: stage.completedAt }),
    });
    documents.replaceJob(invalidateDownstream(reviewed, "ocr"));
  }
  documents.setNotice("OCR 文本修订已保存；下游翻译与排版需要重新运行");
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
