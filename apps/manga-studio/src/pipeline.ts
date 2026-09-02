import { type ArtifactRef, type ComputeTask, type TaskHandle } from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { Effect, Fiber, Stream } from "effect";
import { createImportedRegion } from "./fixture";
import { translateWithGlossary } from "./glossary";
import {
  CLEAN_MODEL_MANIFESTS,
  OCR_MODEL_MANIFESTS,
  resolveMangaCleanMode,
  resolveMangaOcrAdapter,
  resolveMangaTranslationAdapter,
  decodeMangaOcrArtifact,
  decodeMangaTranslationArtifact,
  type MangaAdapterExecution,
  type MangaGlossaryEntry,
  type MangaCleanArtifact,
  type MangaCleanMode,
  type MangaCleanRegionMask,
  type MangaOcrAdapterId,
  type MangaOcrArtifact,
  type MangaOcrLine,
  type TextRegion,
  type MangaTranslationArtifact,
} from "./model";
import {
  LOCAL_OCR_OPERATION,
  LOCAL_TRANSLATION_OPERATION,
  CLEAN_PREVIEW_OPERATION,
  MODEL_PRELOAD_OPERATION,
  REVIEW_OCR_OPERATION,
} from "./operations";
import { mangaRuntime } from "./runtime";
import { manga } from "./store";

let activeRun = 0;
let activeQueueRun = 0;
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

const stageTimings: ReadonlyArray<{ id: Parameters<typeof manga.updateStage>[0]; ms: number }> = [
  { id: "normalize", ms: 360 },
  { id: "detect", ms: 440 },
  { id: "ocr", ms: 520 },
  { id: "reading-order", ms: 280 },
  { id: "translate", ms: 480 },
  { id: "remove-text", ms: 380 },
  { id: "typeset", ms: 360 },
  { id: "export", ms: 240 },
];

export interface MangaPipelineOptions {
  /** Reuse completed stage checkpoints for a paused/crash-recovered page. */
  readonly resume?: boolean;
}

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
export function mergeOcrLinesIntoRegions(
  regions: ReadonlyArray<TextRegion>,
  lines: ReadonlyArray<MangaOcrLine>,
): ReadonlyArray<TextRegion> {
  if (lines.length === 0) return regions;
  const previous = new Map(regions.map((region) => [region.id, region]));
  return lines.map((line) => {
    const existing = previous.get(line.id);
    return {
      id: line.id,
      label: line.label,
      x: line.x,
      y: line.y,
      width: line.width,
      height: line.height,
      rotation: line.rotation,
      writingMode: line.writingMode,
      sourceText: line.text,
      translatedText: existing?.translatedText ?? "",
      confidence: line.confidence,
      status: "needs-review",
    } satisfies TextRegion;
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function fixtureTranslate(text: string): string {
  const dictionary: Record<string, string> = {
    "ここから、始めよう。": "就从这里开始吧。",
    もうすぐ春だね: "春天快到了呢",
    "見つけた！": "找到了！",
    静かな午後: "安静的午后",
    ページをめくる: "翻开下一页",
    "また明日。": "明天见。",
    待识别文本: "请编辑译文",
  };
  return dictionary[text] ?? (text.trim().length > 0 ? `译：${text}` : "请编辑译文");
}

function translateText(text: string, glossary: ReadonlyArray<MangaGlossaryEntry>): string {
  return translateWithGlossary(text, glossary, fixtureTranslate);
}

function translationFallback(
  execution: MangaAdapterExecution,
  fallbackReason: MangaAdapterExecution["fallbackReason"],
): MangaAdapterExecution {
  return {
    ...execution,
    effectiveAdapter: "fixture",
    runtime: "fixture",
    effectiveDevice: "fixture",
    phase: "running",
    cache: "disabled",
    ...(fallbackReason === undefined ? {} : { fallbackReason }),
  };
}

function initialAdapterExecution(execution: MangaAdapterExecution): MangaAdapterExecution {
  const isPhysicalAdapter =
    execution.effectiveAdapter === "local" ||
    execution.effectiveAdapter === "vision.onnx" ||
    execution.effectiveAdapter === "manga.onnx";
  return {
    ...execution,
    phase: isPhysicalAdapter ? "queued" : "running",
    ...(isPhysicalAdapter ? {} : { cache: "disabled" as const }),
  };
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

function trackModelReady(execution: MangaAdapterExecution | undefined): void {
  if (execution === undefined || execution.model === undefined) return;
  const runtime = mangaRuntime();
  if (runtime === undefined) return;
  void runtime.models.markReady(execution);
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
  try {
    await Effect.runPromise(handle.await);
    if (runtime !== undefined) void runtime.models.markReady(execution);
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
async function runOcrAdapter(
  services: RuntimeServices,
  runId: number,
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
  if (runId !== activeRun) {
    await Effect.runPromise(handle.cancel);
    return undefined;
  }
  activeOcr = { runId, handle };
  let submittedExecution = submittedAdapterExecution(
    manga.getSnapshot().stages.find((stage) => stage.id === "ocr")?.execution,
    handle,
  );
  if (submittedExecution !== undefined) {
    manga.updateStage("ocr", { execution: submittedExecution });
    trackModelLoading(submittedExecution);
  }
  const progressFiber = Effect.runFork(
    Stream.runForEach(handle.events, (event) =>
      Effect.sync(() => {
        if (runId === activeRun && event.type === "progress") {
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
    if (runId !== activeRun) return undefined;
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
      trackModelReady(observedExecution);
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
async function runLocalTranslation(
  services: RuntimeServices,
  runId: number,
  input: ArtifactRef,
): Promise<{ artifact: ArtifactRef; payload: MangaTranslationArtifact } | undefined> {
  const task = translationTask(runId, input);
  if (task === undefined) return undefined;
  const available = await Effect.runPromise(services.artifacts.has(input));
  if (!available) {
    manga.log("warn", "translate local ONNX · OCR artifact is not bridged into shared artifacts");
    return undefined;
  }
  const handle = await Effect.runPromise(services.scheduler.submit(task));
  if (runId !== activeRun) {
    await Effect.runPromise(handle.cancel);
    return undefined;
  }
  activeTranslation = { runId, handle };
  let submittedExecution = submittedAdapterExecution(
    manga.getSnapshot().stages.find((stage) => stage.id === "translate")?.execution,
    handle,
  );
  if (submittedExecution !== undefined) {
    manga.updateStage("translate", { execution: submittedExecution });
    trackModelLoading(submittedExecution);
  }
  const progressFiber = Effect.runFork(
    Stream.runForEach(handle.events, (event) =>
      Effect.sync(() => {
        if (runId === activeRun && event.type === "progress") {
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
    if (runId !== activeRun) return undefined;
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
      trackModelReady(observedExecution);
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
async function runCleanAdapter(
  services: RuntimeServices,
  runId: number,
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
  if (runId !== activeRun) {
    await Effect.runPromise(handle.cancel);
    return undefined;
  }
  activeClean = { runId, handle };
  const progressFiber = Effect.runFork(
    Stream.runForEach(handle.events, (event) =>
      Effect.sync(() => {
        if (runId === activeRun && event.type === "progress") {
          manga.updateStage("remove-text", { progress: event.value });
        }
      }),
    ),
  );
  try {
    const outputs = await Effect.runPromise(handle.await);
    if (runId !== activeRun) return undefined;
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

export async function runMangaPipeline(
  services?: RuntimeServices,
  options: MangaPipelineOptions = {},
): Promise<"completed" | "cancelled" | "failed"> {
  const runId = ++activeRun;
  const resume = options.resume === true;
  const previousStages = resume ? manga.getSnapshot().stages : undefined;
  manga.beginRun(resume);
  let currentStage: (typeof stageTimings)[number]["id"] = "normalize";
  let ocrArtifact: ArtifactRef | undefined = previousStages?.find(
    (stage) => stage.id === "ocr" && stage.status === "done",
  )?.artifact;
  let ocrPayload: MangaOcrArtifact | undefined;

  try {
    if (ocrArtifact !== undefined && services !== undefined) {
      try {
        ocrPayload = decodeOcrArtifact(
          await Effect.runPromise(services.artifacts.get(ocrArtifact)),
        );
        manga.setRegionsForPipeline(
          mergeOcrLinesIntoRegions(manga.getSnapshot().regions, ocrPayload.lines),
        );
      } catch (error) {
        manga.log("warn", `ocr checkpoint · unable to restore lines · ${String(error)}`);
      }
    }
    for (const [index, stage] of stageTimings.entries()) {
      if (runId !== activeRun) return "cancelled";
      const checkpoint = previousStages?.find((candidate) => candidate.id === stage.id);
      if (checkpoint?.status === "done") {
        // Completed stages are immutable checkpoints for queue retries. Their
        // artifacts and progress remain visible while downstream stages run.
        continue;
      }
      currentStage = stage.id;
      manga.updateStage(stage.id, { status: "running", progress: 0.08, error: undefined });

      let stageArtifact: ArtifactRef | undefined;
      let localTranslation: MangaTranslationArtifact | undefined;
      let stageExecution: MangaAdapterExecution | undefined;
      if (stage.id === "ocr") {
        stageExecution = initialAdapterExecution(
          resolveMangaOcrAdapter(
            manga.getSnapshot().settings.ocrAdapter,
            manga.getSnapshot().settings.sourceLanguage,
            {
              model: manga.getSnapshot().settings.ocrModel,
              device: manga.getSnapshot().settings.ocrDevice,
            },
          ).execution,
        );
        manga.updateStage(stage.id, { execution: stageExecution });
      }
      if (stage.id === "ocr" && services !== undefined) {
        const result = await runOcrAdapter(services, runId);
        ocrArtifact = result?.artifact;
        ocrPayload = result?.payload;
        stageArtifact = ocrArtifact;
        stageExecution = result?.payload.execution ?? stageExecution;
        if (ocrPayload !== undefined) {
          manga.setRegionsForPipeline(
            mergeOcrLinesIntoRegions(manga.getSnapshot().regions, ocrPayload.lines),
          );
        }
      }
      if (stage.id === "translate") {
        const translationResolution = resolveMangaTranslationAdapter(
          manga.getSnapshot().settings.engine,
          manga.getSnapshot().settings.sourceLanguage,
          { device: manga.getSnapshot().settings.translationDevice },
        );
        stageExecution = initialAdapterExecution(translationResolution.execution);
        manga.updateStage(stage.id, { execution: stageExecution });
        if (
          manga.getSnapshot().settings.engine === "local" &&
          (ocrArtifact === undefined ||
            services === undefined ||
            stageExecution.effectiveAdapter !== "local")
        ) {
          const fallbackReason = stageExecution.fallbackReason ?? "missing-input";
          stageExecution = translationFallback(stageExecution, fallbackReason);
          manga.updateStage(stage.id, { execution: stageExecution });
        }
      }
      if (
        stage.id === "translate" &&
        manga.getSnapshot().settings.engine === "local" &&
        services !== undefined &&
        ocrArtifact !== undefined
      ) {
        const result = await runLocalTranslation(services, runId, ocrArtifact);
        stageArtifact = result?.artifact;
        localTranslation = result?.payload;
        stageExecution = result?.payload.execution ?? stageExecution;
        if (result === undefined && stageExecution?.effectiveAdapter === "local") {
          stageExecution = translationFallback(stageExecution, "adapter-not-ready");
          manga.updateStage(stage.id, { execution: stageExecution });
        }
      } else if (stage.id === "translate" && manga.getSnapshot().settings.engine === "local") {
        manga.log(
          "warn",
          "translate local ONNX · fixture or review-only page has no OCR artifact, using Fixture fallback",
        );
      }
      if (stage.id === "remove-text" && services !== undefined) {
        const result = await runCleanAdapter(services, runId);
        stageArtifact = result?.artifact;
      } else if (
        stage.id === "remove-text" &&
        manga.getSnapshot().settings.cleanMode === "inpaint"
      ) {
        const resolved = resolveMangaCleanMode("inpaint");
        manga.log(
          "warn",
          `clean · requested ${resolved.requestedMode}, effective ${resolved.effectiveMode} · ${resolved.fallbackReason}`,
        );
      }
      if (stageArtifact !== undefined) {
        manga.updateStage(stage.id, {
          status: "done",
          progress: 1,
          artifact: stageArtifact,
          ...(stageExecution === undefined ? {} : { execution: stageExecution }),
        });
      } else {
        await wait(stage.ms);
      }
      if (runId !== activeRun) return "cancelled";

      if (stageExecution !== undefined && stageExecution.phase !== "completed") {
        stageExecution = { ...stageExecution, phase: "completed" };
        manga.updateStage(stage.id, { execution: stageExecution });
      }

      if (
        stage.id === "detect" &&
        manga.getSnapshot().source.kind === "image" &&
        manga.getSnapshot().regions.length === 0
      ) {
        const source = manga.getSnapshot().source;
        manga.addRegion(createImportedRegion(source.width, source.height));
      }
      if (stage.id === "translate") {
        const { glossary } = manga.getSnapshot();
        const translatedById = new Map(
          localTranslation?.lines.map((line) => [line.id, line.translatedText]) ?? [],
        );
        const regions = manga.getSnapshot().regions.map((region) => ({
          ...region,
          translatedText:
            translatedById.get(region.id) ?? translateText(region.sourceText, glossary),
        }));
        manga.setRegionsForPipeline(regions);
      }

      if (stageArtifact === undefined) {
        manga.updateStage(stage.id, { status: "done", progress: 1 });
      }
      manga.log("ok", `${stage.id} · ${index + 2}/9 · artifact ready`);
    }

    if (runId === activeRun) {
      manga.finishRun();
      return "completed";
    }
    return "cancelled";
  } catch (reason) {
    if (runId === activeRun) {
      const message = errorMessage(reason);
      manga.updateStage(currentStage, { status: "error", progress: 0, error: message });
      manga.failRun(message);
      return "failed";
    }
    return "cancelled";
  }
}

/**
 * Process only pages that still need output. The durable batch cursor makes a
 * refresh or an explicit pause resumable without rerunning completed pages.
 */
export async function runMangaQueue(services?: RuntimeServices): Promise<void> {
  if (manga.getSnapshot().running || manga.getSnapshot().batch?.status === "running") return;
  const snapshot = manga.getSnapshot();
  const existing = snapshot.batch;
  const resume = existing?.status === "paused" || existing?.status === "error";
  const pageIds = resume
    ? existing.pageIds
    : snapshot.pages.filter((page) => !page.outputReady).map((page) => page.id);
  const validPageIds = pageIds.filter((id) => snapshot.pages.some((page) => page.id === id));
  if (validPageIds.length === 0) {
    manga.log("info", "batch · no pages need processing");
    return;
  }

  const queueRun = ++activeQueueRun;
  manga.startBatch(validPageIds, resume);
  const completed = new Set(
    resume ? (existing?.completedPageIds.filter((id) => validPageIds.includes(id)) ?? []) : [],
  );

  for (const pageId of validPageIds) {
    if (queueRun !== activeQueueRun) return;
    if (completed.has(pageId)) continue;
    const page = manga.getSnapshot().pages.find((candidate) => candidate.id === pageId);
    if (page === undefined) continue;
    manga.setBatchActivePage(pageId);
    manga.selectPage(pageId);
    const result = await runMangaPipeline(services, { resume: true });
    if (queueRun !== activeQueueRun || result === "cancelled") return;
    if (result === "failed") {
      manga.failBatch(`${page.source.name} 处理失败`);
      return;
    }
    manga.completeBatchPage(pageId);
    completed.add(pageId);
  }

  if (queueRun === activeQueueRun) manga.finishBatch();
}

export function cancelMangaPipeline(): void {
  activeRun += 1;
  const active = activeOcr;
  const activeTranslate = activeTranslation;
  const activeCleanRun = activeClean;
  activeOcr = undefined;
  activeTranslation = undefined;
  activeClean = undefined;
  if (active !== undefined) void Effect.runPromise(active.handle.cancel);
  if (activeTranslate !== undefined) void Effect.runPromise(activeTranslate.handle.cancel);
  if (activeCleanRun !== undefined) void Effect.runPromise(activeCleanRun.handle.cancel);
  manga.cancelRun();
}

export function cancelMangaQueue(): void {
  activeQueueRun += 1;
  cancelMangaPipeline();
  manga.pauseBatch();
}
