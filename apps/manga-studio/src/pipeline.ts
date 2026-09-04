import { type ArtifactRef } from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { Effect } from "effect";
import { createImportedRegion } from "./fixture";
import { translateWithGlossary } from "./glossary";
import {
  decodeMangaOcrArtifact,
  resolveMangaCleanMode,
  resolveMangaOcrAdapter,
  resolveMangaTranslationAdapter,
  type MangaAdapterExecution,
  type MangaGlossaryEntry,
  type MangaOcrArtifact,
  type MangaOcrLine,
  type MangaTranslationArtifact,
  type TextRegion,
} from "./model";
import {
  cancelMangaAdapterTasks,
  runCleanAdapter,
  runLocalTranslation,
  runOcrAdapter,
} from "./pipelineAdapters";
import { manga } from "./store";

export { preloadMangaModel } from "./pipelineAdapters";

let activeRun = 0;
let activeQueueRun = 0;

function isRunActive(runId: number): boolean {
  return runId === activeRun;
}
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

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Warm a selected local model through the same WorkerPool used by the pipeline. */
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
        const result = await runOcrAdapter(services, runId, isRunActive);
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
        const result = await runLocalTranslation(services, runId, ocrArtifact, isRunActive);
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
        const result = await runCleanAdapter(services, runId, isRunActive);
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
  cancelMangaAdapterTasks();
  manga.cancelRun();
}

export function cancelMangaQueue(): void {
  activeQueueRun += 1;
  cancelMangaPipeline();
  manga.pauseBatch();
}
