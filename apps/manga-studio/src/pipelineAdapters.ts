import { type ArtifactRef, type ComputeTask, type TaskHandle } from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { Effect, Fiber, Stream } from "effect";
import {
  CLEAN_MODEL_MANIFESTS,
  OCR_MODEL_MANIFESTS,
  decodeMangaOcrArtifact,
  decodeMangaTranslationArtifact,
  resolveMangaOcrAdapter,
  resolveMangaTranslationAdapter,
  type MangaAdapterExecution,
  type MangaCleanArtifact,
  type MangaCleanMode,
  type MangaCleanRegionMask,
  type MangaOcrAdapterId,
  type MangaOcrArtifact,
  type MangaTranslationArtifact,
} from "./model";
import {
  CLEAN_PREVIEW_OPERATION,
  LOCAL_OCR_OPERATION,
  LOCAL_TRANSLATION_OPERATION,
  MODEL_PRELOAD_OPERATION,
  REVIEW_OCR_OPERATION,
} from "./operations";
import { mangaRuntime } from "./runtime";
import { manga } from "./store";

let activeOcr:
  | {
      readonly runId: number;
      readonly handle: TaskHandle;
    }
  | undefined;
let activeTranslation:
  | {
      readonly runId: number;
      readonly handle: TaskHandle;
    }
  | undefined;
let activeClean:
  | {
      readonly runId: number;
      readonly handle: TaskHandle;
    }
  | undefined;
let activeModelPreload:
  | {
      readonly key: string;
      readonly handle: TaskHandle;
    }
  | undefined;
function decodeOcrArtifact(bytes: Uint8Array): MangaOcrArtifact {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("manga OCR Artifact 不是有效 JSON");
  }
  return decodeMangaOcrArtifact(value);
}

/** Merge model output into the review model while preserving stable region IDs. */
function browserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function submittedAdapterExecution(
  execution: MangaAdapterExecution | undefined,
  handle: TaskHandle,
): MangaAdapterExecution | undefined {
  if (execution === undefined) return undefined;
  const isPhysicalAdapter =
    execution.effectiveAdapter === "local" ||
    execution.effectiveAdapter === "vision.onnx" ||
    execution.effectiveAdapter === "manga.onnx";
  return {
    ...execution,
    phase: handle.cached ? "completed" : isPhysicalAdapter ? "loading-model" : "running",
    cache: handle.cached ? "hit" : "miss",
  };
}

function completedAdapterExecution(
  execution: MangaAdapterExecution | undefined,
  handle: TaskHandle,
): MangaAdapterExecution | undefined {
  if (execution === undefined) return undefined;
  return {
    ...execution,
    phase: "completed",
    cache: handle.cached ? "hit" : "miss",
  };
}

function trackModelLoading(execution: MangaAdapterExecution | undefined): void {
  if (execution === undefined || execution.model === undefined) return;
  const runtime = mangaRuntime();
  if (runtime === undefined) return;
  void runtime.models.markLoading(execution);
}

function trackModelReady(execution: MangaAdapterExecution | undefined, durationMs?: number): void {
  if (execution === undefined || execution.model === undefined) return;
  const runtime = mangaRuntime();
  if (runtime === undefined) return;
  void runtime.models.markReady(execution, durationMs);
}

function trackModelError(execution: MangaAdapterExecution | undefined, error: unknown): void {
  if (execution === undefined || execution.model === undefined) return;
  const runtime = mangaRuntime();
  if (runtime === undefined) return;
  void runtime.models.markError(execution, error);
}

function ocrTask(runId: number): ComputeTask | undefined {
  const state = manga.getSnapshot();
  const source = state.source.ref;
  if (source === undefined || source.storage !== "opfs") return undefined;
  const resolution = resolveMangaOcrAdapter(
    state.settings.ocrAdapter,
    state.settings.sourceLanguage,
    { model: state.settings.ocrModel, device: state.settings.ocrDevice },
  );
  const operation =
    resolution.execution.effectiveAdapter === "review.manual"
      ? REVIEW_OCR_OPERATION
      : LOCAL_OCR_OPERATION;
  return {
    id: `manga-ocr-${Date.now().toString(36)}-${runId.toString(36)}`,
    runtime: operation.runtime,
    operation: operation.operation,
    inputs: [{ ...source, port: "source" }],
    outputs: [
      {
        name: "lines",
        type: "manga/ocr-lines",
        storage: "opfs",
        format: "json",
      },
    ],
    resources: {
      ...operation.resources,
      ...(resolution.execution.effectiveDevice === "webgpu" ? { gpu: true } : {}),
    },
    cache: { enabled: true },
    config: {
      /** Keep requested/effective IDs separate so a language fallback is auditable. */
      requestedAdapter: state.settings.ocrAdapter,
      adapter: resolution.execution.effectiveAdapter,
      model: state.settings.ocrModel,
      device: state.settings.ocrDevice,
      sourceLanguage: state.settings.sourceLanguage,
      offlineOnly: browserOffline(),
      sourceName: state.source.name,
      width: state.source.width,
      height: state.source.height,
      regions: state.regions.map((region) => ({
        id: region.id,
        label: region.label,
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        rotation: region.rotation,
        writingMode: region.writingMode,
        sourceText: region.sourceText,
        confidence: region.confidence,
      })),
    },
  };
}

function translationTask(runId: number, input: ArtifactRef): ComputeTask | undefined {
  const state = manga.getSnapshot();
  const resolution = resolveMangaTranslationAdapter(
    state.settings.engine,
    state.settings.sourceLanguage,
    { device: state.settings.translationDevice },
  );
  if (
    resolution.execution.effectiveAdapter !== "local" ||
    resolution.execution.model === undefined
  ) {
    return undefined;
  }
  const model = resolution.execution.model;
  return {
    id: `manga-translate-${Date.now().toString(36)}-${runId.toString(36)}`,
    runtime: LOCAL_TRANSLATION_OPERATION.runtime,
    operation: LOCAL_TRANSLATION_OPERATION.operation,
    inputs: [{ ...input, port: "lines" }],
    outputs: [
      {
        name: "segments",
        type: "manga/translation-lines",
        storage: "opfs",
        format: "json",
      },
    ],
    resources: {
      ...LOCAL_TRANSLATION_OPERATION.resources,
      ...(resolution.execution.effectiveDevice === "webgpu" ? { gpu: true } : {}),
    },
    cache: { enabled: true },
    config: {
      requestedAdapter: state.settings.engine,
      adapter: resolution.execution.effectiveAdapter,
      model,
      device: state.settings.translationDevice,
      sourceLanguage: state.settings.sourceLanguage,
      targetLanguage: state.settings.targetLanguage,
      offlineOnly: browserOffline(),
      sourceName: state.source.name,
      glossary: state.glossary,
    },
  };
}

function cleanTask(runId: number): ComputeTask | undefined {
  const state = manga.getSnapshot();
  const source = state.source.ref;
  if (source === undefined || source.storage !== "opfs") return undefined;
  const mode: MangaCleanMode = state.settings.cleanMode === "inpaint" ? "inpaint" : "fill";
  const regions: MangaCleanRegionMask[] = state.regions.map((region) => ({
    id: region.id,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    rotation: region.rotation,
  }));
  return {
    id: `manga-clean-${Date.now().toString(36)}-${runId.toString(36)}`,
    runtime: CLEAN_PREVIEW_OPERATION.runtime,
    operation: CLEAN_PREVIEW_OPERATION.operation,
    inputs: [{ ...source, port: "source" }],
    outputs: [
      {
        name: "cleanPage",
        type: "manga/clean-page",
        storage: "opfs",
        format: "json",
      },
    ],
    resources: CLEAN_PREVIEW_OPERATION.resources,
    cache: { enabled: true },
    config: {
      mode,
      sourceName: state.source.name,
      regions,
    },
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Warm a selected local model through the same WorkerPool used by the pipeline. */
export async function preloadMangaModel(
  services: RuntimeServices | undefined,
  execution: MangaAdapterExecution,
): Promise<boolean> {
  if (
    services === undefined ||
    execution.model === undefined ||
    execution.model.trim().length === 0
  ) {
    return false;
  }
  const isLocalOcr =
    execution.kind === "ocr" &&
    (execution.effectiveAdapter === "vision.onnx" || execution.effectiveAdapter === "manga.onnx");
  const isLocalTranslation =
    execution.kind === "translation" && execution.effectiveAdapter === "local";
  if (!isLocalOcr && !isLocalTranslation) return false;
  const key = `${execution.kind}:${execution.model}:${execution.requestedDevice}`;
  if (activeModelPreload !== undefined) {
    if (activeModelPreload.key !== key) return false;
    await Effect.runPromise(activeModelPreload.handle.await);
    return true;
  }
  const runtime = mangaRuntime();
  if (runtime !== undefined) void runtime.models.markLoading(execution);
  const task: ComputeTask = {
    id: `manga-model-preload-${Date.now().toString(36)}`,
    runtime: MODEL_PRELOAD_OPERATION.runtime,
    operation: MODEL_PRELOAD_OPERATION.operation,
    inputs: [],
    outputs: [],
    resources: {
      ...MODEL_PRELOAD_OPERATION.resources,
      ...(execution.effectiveDevice === "webgpu" ? { gpu: true } : {}),
    },
    // The scheduler cache is intentionally disabled. Transformers.js is the
    // source of truth for model bytes; every explicit preload revalidates it.
    cache: { enabled: false },
    config: {
      kind: execution.kind,
      model: execution.model,
      adapter: execution.effectiveAdapter,
      sourceLanguage: execution.sourceLanguage ?? "ja",
      device: execution.requestedDevice,
      offlineOnly: browserOffline(),
    },
  };
  let handle: TaskHandle;
  try {
    handle = await Effect.runPromise(services.scheduler.submit(task));
  } catch (error) {
    if (runtime !== undefined) void runtime.models.markError(execution, error);
    throw error;
  }
  activeModelPreload = { key, handle };
  const modelLoadStartedAt = performance.now();
  try {
    await Effect.runPromise(handle.await);
    if (runtime !== undefined) {
      void runtime.models.markReady(execution, performance.now() - modelLoadStartedAt);
    }
    manga.log("ok", `model preload · ${execution.model} · browser cache ready`);
    return true;
  } catch (error) {
    if (runtime !== undefined) void runtime.models.markError(execution, error);
    manga.log("warn", `model preload · ${execution.model} · ${errorMessage(error)}`);
    throw error;
  } finally {
    if (activeModelPreload?.handle === handle) activeModelPreload = undefined;
  }
}

/** Run the selected OCR adapter through the shared WorkerPool. */
export async function runOcrAdapter(
  services: RuntimeServices,
  runId: number,
  isActive: (runId: number) => boolean,
): Promise<{ readonly artifact: ArtifactRef; readonly payload: MangaOcrArtifact } | undefined> {
  const task = ocrTask(runId);
  if (task === undefined) return undefined;
  const adapterValue = task.config?.["adapter"];
  const adapter: MangaOcrAdapterId =
    adapterValue === "manga.onnx" || adapterValue === "vision.onnx"
      ? adapterValue
      : "review.manual";
  const manifest = OCR_MODEL_MANIFESTS.find((candidate) => candidate.id === adapter);
  const source = task.inputs[0];
  if (source === undefined) return undefined;
  const available = await Effect.runPromise(services.artifacts.has(source));
  if (!available) {
    manga.log("warn", "ocr adapter · source is not bridged into shared artifacts");
    return undefined;
  }

  const handle = await Effect.runPromise(services.scheduler.submit(task));
  if (!isActive(runId)) {
    await Effect.runPromise(handle.cancel);
    return undefined;
  }
  activeOcr = { runId, handle };
  const modelLoadStartedAt = handle.cached ? undefined : performance.now();
  let submittedExecution = submittedAdapterExecution(
    manga.getSnapshot().stages.find((stage) => stage.id === "ocr")?.execution,
    handle,
  );
  if (submittedExecution !== undefined) {
    manga.updateStage("ocr", { execution: submittedExecution });
    if (!handle.cached) trackModelLoading(submittedExecution);
  }
  const progressFiber = Effect.runFork(
    Stream.runForEach(handle.events, (event) =>
      Effect.sync(() => {
        if (isActive(runId) && event.type === "progress") {
          manga.updateStage("ocr", { progress: event.value });
          const execution = manga
            .getSnapshot()
            .stages.find((stage) => stage.id === "ocr")?.execution;
          if (execution !== undefined && !handle.cached) {
            submittedExecution = {
              ...execution,
              phase:
                execution.effectiveAdapter === "review.manual"
                  ? "running"
                  : event.value < 0.4
                    ? "loading-model"
                    : "running",
            };
            manga.updateStage("ocr", { execution: submittedExecution });
          }
        }
      }),
    ),
  );
  try {
    const outputs = await Effect.runPromise(handle.await);
    if (!isActive(runId)) return undefined;
    const artifact = outputs[0];
    if (artifact === undefined) throw new Error("ocr adapter returned no artifact");
    const data = await Effect.runPromise(services.artifacts.get(artifact));
    const payload = decodeOcrArtifact(data);
    const observedExecution = completedAdapterExecution(
      payload.execution ?? submittedExecution,
      handle,
    );
    const observedPayload =
      observedExecution === undefined ? payload : { ...payload, execution: observedExecution };
    if (observedExecution !== undefined) {
      manga.updateStage("ocr", { execution: observedExecution });
      if (!handle.cached && observedExecution.modelUsed === true) {
        trackModelReady(
          observedExecution,
          observedExecution.modelLoadDurationMs ??
            (modelLoadStartedAt === undefined ? undefined : performance.now() - modelLoadStartedAt),
        );
      }
      if (observedExecution.fallbackReason !== undefined) {
        manga.log(
          "warn",
          `ocr ${observedExecution.requestedAdapter} → ${observedExecution.effectiveAdapter} · ${observedExecution.fallbackReason}`,
        );
      }
    }
    const localRuntime = mangaRuntime();
    if (localRuntime !== undefined && localRuntime.artifacts !== services.artifacts) {
      try {
        await Effect.runPromise(localRuntime.artifacts.put(artifact, data));
      } catch (error) {
        manga.log("warn", `ocr adapter · local mirror unavailable · ${String(error)}`);
      }
    }
    const adapterLabel = manifest?.label ?? (adapter === "review.manual" ? "Review" : "Local ONNX");
    manga.log(
      "ok",
      `ocr ${adapterLabel} adapter · ${artifact.id} · needs-review regions preserved`,
    );
    return { artifact, payload: observedPayload };
  } catch (error) {
    trackModelError(submittedExecution, error);
    throw error;
  } finally {
    Effect.runFork(Fiber.interrupt(progressFiber));
    if (activeOcr?.handle === handle) activeOcr = undefined;
  }
}

/** Run local NLLB translation through the shared WorkerPool and decode its artifact. */
export async function runLocalTranslation(
  services: RuntimeServices,
  runId: number,
  input: ArtifactRef,
  isActive: (runId: number) => boolean,
): Promise<{ artifact: ArtifactRef; payload: MangaTranslationArtifact } | undefined> {
  const task = translationTask(runId, input);
  if (task === undefined) return undefined;
  const available = await Effect.runPromise(services.artifacts.has(input));
  if (!available) {
    manga.log("warn", "translate local ONNX · OCR artifact is not bridged into shared artifacts");
    return undefined;
  }
  const handle = await Effect.runPromise(services.scheduler.submit(task));
  if (!isActive(runId)) {
    await Effect.runPromise(handle.cancel);
    return undefined;
  }
  activeTranslation = { runId, handle };
  const modelLoadStartedAt = handle.cached ? undefined : performance.now();
  let submittedExecution = submittedAdapterExecution(
    manga.getSnapshot().stages.find((stage) => stage.id === "translate")?.execution,
    handle,
  );
  if (submittedExecution !== undefined) {
    manga.updateStage("translate", { execution: submittedExecution });
    if (!handle.cached) trackModelLoading(submittedExecution);
  }
  const progressFiber = Effect.runFork(
    Stream.runForEach(handle.events, (event) =>
      Effect.sync(() => {
        if (isActive(runId) && event.type === "progress") {
          manga.updateStage("translate", { progress: event.value });
          const execution = manga
            .getSnapshot()
            .stages.find((stage) => stage.id === "translate")?.execution;
          if (execution !== undefined && !handle.cached) {
            submittedExecution = {
              ...execution,
              phase: event.value < 0.4 ? "loading-model" : "running",
            };
            manga.updateStage("translate", { execution: submittedExecution });
          }
        }
      }),
    ),
  );
  try {
    const outputs = await Effect.runPromise(handle.await);
    if (!isActive(runId)) return undefined;
    const artifact = outputs[0];
    if (artifact === undefined) throw new Error("local translation adapter returned no artifact");
    const data = await Effect.runPromise(services.artifacts.get(artifact));
    const payload = decodeMangaTranslationArtifact(
      JSON.parse(new TextDecoder().decode(data)) as unknown,
    );
    if (payload.adapter !== "local.onnx") {
      throw new Error("local translation adapter returned an invalid artifact");
    }
    const observedExecution = completedAdapterExecution(
      payload.execution ?? submittedExecution,
      handle,
    );
    const observedPayload =
      observedExecution === undefined ? payload : { ...payload, execution: observedExecution };
    if (observedExecution !== undefined) {
      manga.updateStage("translate", { execution: observedExecution });
      if (!handle.cached && observedExecution.modelUsed === true) {
        trackModelReady(
          observedExecution,
          observedExecution.modelLoadDurationMs ??
            (modelLoadStartedAt === undefined ? undefined : performance.now() - modelLoadStartedAt),
        );
      }
      if (observedExecution.fallbackReason !== undefined) {
        manga.log(
          "warn",
          `translate ${observedExecution.requestedAdapter} → ${observedExecution.effectiveAdapter} · ${observedExecution.fallbackReason}`,
        );
      }
    }
    const localRuntime = mangaRuntime();
    if (localRuntime !== undefined && localRuntime.artifacts !== services.artifacts) {
      try {
        await Effect.runPromise(localRuntime.artifacts.put(artifact, data));
      } catch (error) {
        manga.log("warn", `translate local ONNX · local mirror unavailable · ${String(error)}`);
      }
    }
    manga.log("ok", `translate local ONNX · ${artifact.id} · needs-review segments preserved`);
    return { artifact, payload: observedPayload };
  } catch (error) {
    trackModelError(submittedExecution, error);
    throw error;
  } finally {
    Effect.runFork(Fiber.interrupt(progressFiber));
    if (activeTranslation?.handle === handle) activeTranslation = undefined;
  }
}

/** Serialize a safe cleaning boundary; pixel generation stays in a future adapter. */
export async function runCleanAdapter(
  services: RuntimeServices,
  runId: number,
  isActive: (runId: number) => boolean,
): Promise<{ artifact: ArtifactRef; payload: MangaCleanArtifact } | undefined> {
  const task = cleanTask(runId);
  if (task === undefined) return undefined;
  const source = task.inputs[0];
  if (source === undefined) return undefined;
  const available = await Effect.runPromise(services.artifacts.has(source));
  if (!available) {
    manga.log("warn", "clean preview · source is not bridged into shared artifacts");
    return undefined;
  }
  const handle = await Effect.runPromise(services.scheduler.submit(task));
  if (!isActive(runId)) {
    await Effect.runPromise(handle.cancel);
    return undefined;
  }
  activeClean = { runId, handle };
  const progressFiber = Effect.runFork(
    Stream.runForEach(handle.events, (event) =>
      Effect.sync(() => {
        if (isActive(runId) && event.type === "progress") {
          manga.updateStage("remove-text", { progress: event.value });
        }
      }),
    ),
  );
  try {
    const outputs = await Effect.runPromise(handle.await);
    if (!isActive(runId)) return undefined;
    const artifact = outputs[0];
    if (artifact === undefined) throw new Error("clean adapter returned no artifact");
    const data = await Effect.runPromise(services.artifacts.get(artifact));
    const payload = JSON.parse(new TextDecoder().decode(data)) as MangaCleanArtifact;
    if (payload.version !== 1 || payload.adapter !== "fill" || payload.effectiveMode !== "fill") {
      throw new Error("clean adapter returned an invalid artifact");
    }
    const localRuntime = mangaRuntime();
    if (localRuntime !== undefined && localRuntime.artifacts !== services.artifacts) {
      try {
        await Effect.runPromise(localRuntime.artifacts.put(artifact, data));
      } catch (error) {
        manga.log("warn", `clean preview · local mirror unavailable · ${String(error)}`);
      }
    }
    const manifest = CLEAN_MODEL_MANIFESTS.find(
      (candidate) =>
        candidate.id === (payload.requestedMode === "inpaint" ? "inpaint.onnx" : "fill"),
    );
    if (payload.fallbackReason !== undefined) {
      manga.log(
        "warn",
        `clean ${manifest?.label ?? "Inpaint"} · requested ${payload.requestedMode}, effective Fill · ${payload.fallbackReason}`,
      );
    } else {
      manga.log("ok", `clean ${manifest?.label ?? "Fill"} · ${artifact.id} · mask preserved`);
    }
    return { artifact, payload };
  } finally {
    Effect.runFork(Fiber.interrupt(progressFiber));
    if (activeClean?.handle === handle) activeClean = undefined;
  }
}

export function cancelMangaAdapterTasks(): void {
  const ocr = activeOcr;
  const translation = activeTranslation;
  const clean = activeClean;
  activeOcr = undefined;
  activeTranslation = undefined;
  activeClean = undefined;
  if (ocr !== undefined) void Effect.runPromise(ocr.handle.cancel);
  if (translation !== undefined) void Effect.runPromise(translation.handle.cancel);
  if (clean !== undefined) void Effect.runPromise(clean.handle.cancel);
}
