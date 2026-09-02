import { type ArtifactRef, type ComputeTask, type TaskHandle } from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { Effect, Fiber, Stream } from "effect";
import { createImportedRegion } from "./fixture";
import { translateWithGlossary } from "./glossary";
import {
  TRANSLATION_MODEL_MANIFESTS,
  type MangaGlossaryEntry,
  type MangaSourceLanguage,
  type MangaTranslationArtifact,
} from "./model";
import {
  LOCAL_OCR_OPERATION,
  LOCAL_TRANSLATION_OPERATION,
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

function ocrTask(runId: number): ComputeTask | undefined {
  const state = manga.getSnapshot();
  const source = state.source.ref;
  if (source === undefined || source.storage !== "opfs") return undefined;
  const operation =
    state.settings.ocrAdapter === "vision.onnx" ? LOCAL_OCR_OPERATION : REVIEW_OCR_OPERATION;
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
    resources: operation.resources,
    cache: { enabled: true },
    config: {
      adapter: state.settings.ocrAdapter,
      model: state.settings.ocrModel,
      device: state.settings.ocrDevice,
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

function translationModel(sourceLanguage: MangaSourceLanguage): string | undefined {
  const manifest = TRANSLATION_MODEL_MANIFESTS.find((candidate) => candidate.id === "local");
  return manifest?.models[sourceLanguage];
}

function translationTask(runId: number, input: ArtifactRef): ComputeTask | undefined {
  const state = manga.getSnapshot();
  const model = translationModel(state.settings.sourceLanguage);
  if (model === undefined) return undefined;
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
    resources: LOCAL_TRANSLATION_OPERATION.resources,
    cache: { enabled: true },
    config: {
      model,
      device: state.settings.translationDevice,
      sourceLanguage: state.settings.sourceLanguage,
      targetLanguage: state.settings.targetLanguage,
      sourceName: state.source.name,
      glossary: state.glossary,
    },
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Run the selected OCR adapter through the shared WorkerPool. */
async function runOcrAdapter(
  services: RuntimeServices,
  runId: number,
): Promise<ArtifactRef | undefined> {
  const task = ocrTask(runId);
  if (task === undefined) return undefined;
  if (
    task.config?.["adapter"] === "vision.onnx" &&
    manga.getSnapshot().settings.sourceLanguage !== "en"
  ) {
    manga.log(
      "warn",
      "ocr local ONNX · current manifest is Latin/English focused; review every region",
    );
  }
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
  const progressFiber = Effect.runFork(
    Stream.runForEach(handle.events, (event) =>
      Effect.sync(() => {
        if (runId === activeRun && event.type === "progress") {
          manga.updateStage("ocr", { progress: event.value });
        }
      }),
    ),
  );
  try {
    const outputs = await Effect.runPromise(handle.await);
    if (runId !== activeRun) return undefined;
    const artifact = outputs[0];
    if (artifact === undefined) throw new Error("ocr adapter returned no artifact");
    const localRuntime = mangaRuntime();
    if (localRuntime !== undefined && localRuntime.artifacts !== services.artifacts) {
      try {
        const data = await Effect.runPromise(services.artifacts.get(artifact));
        await Effect.runPromise(localRuntime.artifacts.put(artifact, data));
      } catch (error) {
        manga.log("warn", `ocr adapter · local mirror unavailable · ${String(error)}`);
      }
    }
    const adapter = task.config?.["adapter"] === "vision.onnx" ? "local ONNX" : "review";
    manga.log("ok", `ocr ${adapter} adapter · ${artifact.id} · needs-review regions preserved`);
    return artifact;
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
  const progressFiber = Effect.runFork(
    Stream.runForEach(handle.events, (event) =>
      Effect.sync(() => {
        if (runId === activeRun && event.type === "progress") {
          manga.updateStage("translate", { progress: event.value });
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
    const payload = JSON.parse(new TextDecoder().decode(data)) as MangaTranslationArtifact;
    if (payload.version !== 1 || payload.adapter !== "local.onnx") {
      throw new Error("local translation adapter returned an invalid artifact");
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
    return { artifact, payload };
  } finally {
    Effect.runFork(Fiber.interrupt(progressFiber));
    if (activeTranslation?.handle === handle) activeTranslation = undefined;
  }
}

export async function runMangaPipeline(
  services?: RuntimeServices,
): Promise<"completed" | "cancelled" | "failed"> {
  const runId = ++activeRun;
  manga.beginRun();
  let currentStage: (typeof stageTimings)[number]["id"] = "normalize";
  let ocrArtifact: ArtifactRef | undefined;

  try {
    for (const [index, stage] of stageTimings.entries()) {
      if (runId !== activeRun) return "cancelled";
      currentStage = stage.id;
      manga.updateStage(stage.id, { status: "running", progress: 0.08, error: undefined });

      let stageArtifact: ArtifactRef | undefined;
      let localTranslation: MangaTranslationArtifact | undefined;
      if (stage.id === "ocr" && services !== undefined) {
        ocrArtifact = await runOcrAdapter(services, runId);
        stageArtifact = ocrArtifact;
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
      } else if (stage.id === "translate" && manga.getSnapshot().settings.engine === "local") {
        manga.log(
          "warn",
          "translate local ONNX · fixture or review-only page has no OCR artifact, using fallback",
        );
      }
      if (stageArtifact !== undefined) {
        manga.updateStage(stage.id, { status: "done", progress: 1, artifact: stageArtifact });
      } else {
        await wait(stage.ms);
      }
      if (runId !== activeRun) return "cancelled";

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
  const resume = existing?.status === "paused";
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
    const result = await runMangaPipeline(services);
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
  activeOcr = undefined;
  activeTranslation = undefined;
  if (active !== undefined) void Effect.runPromise(active.handle.cancel);
  if (activeTranslate !== undefined) void Effect.runPromise(activeTranslate.handle.cancel);
  manga.cancelRun();
}

export function cancelMangaQueue(): void {
  activeQueueRun += 1;
  cancelMangaPipeline();
  manga.pauseBatch();
}
