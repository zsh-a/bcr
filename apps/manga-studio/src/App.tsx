import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  FileImage,
  FileUp,
  FileText,
  Languages,
  ListChecks,
  Minus,
  PanelRight,
  Play,
  Plus,
  RotateCcw,
  ScanText,
  Sparkles,
  Square,
  Type,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import type { SearchDocument } from "@bcr/core";
import {
  consumeDocumentHandoff,
  getDocumentHandoffMarker,
  markDocumentHandoffExpired,
  publishDocumentHandoff,
} from "@bcr/document-core";
import { useLocationSearch, useOptionalRuntime } from "@bcr/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { expandMangaArchive, formatForMangaFile } from "./archive";
import { mangaPageToDocumentPackages } from "./document-adapter";
import { cancelMangaPipeline, cancelMangaQueue, runMangaPipeline, runMangaQueue } from "./pipeline";
import { findGlossaryMatches } from "./glossary";
import {
  createMangaRuntime,
  fileFromDocumentHandoff,
  importImageArtifact,
  prepareMangaDocumentHandoff,
  persistMangaDocumentPackages,
  persistProject,
  restoreProject,
  type MangaRuntime,
} from "./runtime";
import { manga, useMangaStudio } from "./store";
import {
  CLEAN_MODEL_MANIFESTS,
  OCR_MODEL_MANIFESTS,
  TRANSLATION_MODEL_MANIFESTS,
  resolveMangaCleanMode,
  resolveMangaOcrAdapter,
  resolveMangaTranslationAdapter,
  type MangaAdapterExecution,
  type MangaGlossaryEntry,
  type MangaCleanMode,
  type MangaOcrAdapterId,
  type MangaOcrDevice,
  type MangaSource,
  type MangaTranslationEngineId,
  type OutputMode,
  type TextRegion,
} from "./model";
import "./styles.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function statusLabel(status: string): string {
  if (status === "done") return "DONE";
  if (status === "running") return "RUNNING";
  if (status === "error") return "ERROR";
  return "READY";
}

function statusIcon(status: string) {
  if (status === "done") return <Check className="size-3.5" />;
  if (status === "running") return <Sparkles className="size-3.5 manga-spin" />;
  if (status === "error") return <CircleAlert className="size-3.5" />;
  return <span className="manga-stage-idle" />;
}

function sourceLabel(source: MangaSource): string {
  return source.kind === "fixture" ? "OFFLINE FIXTURE" : "LOCAL IMAGE";
}

function stageTone(status: string): string {
  if (status === "done") return "manga-stage-done";
  if (status === "running") return "manga-stage-running";
  if (status === "error") return "manga-stage-error";
  return "manga-stage-idle-text";
}

function fallbackLabel(reason: MangaAdapterExecution["fallbackReason"]): string {
  if (reason === "language-unsupported") return "语言不匹配 · Review";
  if (reason === "webgpu-unavailable") return "WebGPU 不可用 · WASM";
  if (reason === "webgpu-init-failed") return "GPU 初始化失败 · WASM";
  if (reason === "model-missing") return "模型缺失 · Fixture";
  if (reason === "missing-input") return "缺少输入 · Fixture";
  if (reason === "adapter-not-ready") return "适配器不可用 · Fixture";
  return "";
}

function executionLabel(execution: MangaAdapterExecution | undefined): string {
  if (execution === undefined) return "";
  const adapter = execution.effectiveAdapter;
  const device = execution.effectiveDevice.toUpperCase();
  const phase =
    execution.phase === "loading-model"
      ? "加载模型"
      : execution.phase === "running"
        ? "执行中"
        : execution.phase === "completed"
          ? "已完成"
          : execution.phase === "queued"
            ? "排队"
            : "";
  const cache = execution.cache === undefined ? "" : `CACHE ${execution.cache.toUpperCase()}`;
  const fallback = fallbackLabel(execution.fallbackReason);
  return [adapter, device, phase, cache, fallback].filter((value) => value.length > 0).join(" · ");
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function exportCurrentPage(): Promise<void> {
  const state = manga.getSnapshot();
  const image = new Image();
  image.src = state.source.objectUrl;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = state.source.width;
  canvas.height = state.source.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Canvas 2D is unavailable");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  if (state.outputMode !== "original") {
    for (const region of state.regions) {
      const x = (region.x / 100) * canvas.width;
      const y = (region.y / 100) * canvas.height;
      const width = (region.width / 100) * canvas.width;
      const height = (region.height / 100) * canvas.height;
      context.save();
      context.fillStyle = "rgba(250, 247, 238, 0.96)";
      context.strokeStyle = "rgba(24, 33, 32, 0.8)";
      context.lineWidth = Math.max(2, canvas.width / 500);
      context.beginPath();
      context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      context.fill();
      if (state.outputMode === "translated") {
        context.fillStyle = "#182120";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.font = `600 ${Math.max(14, Math.min(34, height * 0.38 * state.settings.fontSize))}px IBM Plex Sans, Noto Sans CJK SC, sans-serif`;
        context.fillText(region.translatedText, x + width / 2, y + height / 2, width * 0.86);
      }
      context.restore();
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob === null) throw new Error("Unable to encode PNG");
  const basename = state.source.name.replace(/\.[^.]+$/, "") || "manga-page";
  downloadBlob(blob, `${basename}-zh.png`);
  manga.log("ok", `export · ${basename}-zh.png · ${state.source.width}×${state.source.height}`);
}

export function App() {
  const state = useMangaStudio((snapshot) => snapshot);
  const hostServices = useOptionalRuntime();
  const routePageId = new URLSearchParams(useLocationSearch()).get("page");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handoffRef = useRef<string | null>(null);
  const [zoom, setZoom] = useState(0.82);
  const [exporting, setExporting] = useState(false);
  const [documentHandoffBusy, setDocumentHandoffBusy] = useState(false);
  const [runtime, setRuntime] = useState<MangaRuntime | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [glossarySource, setGlossarySource] = useState("");
  const [glossaryTarget, setGlossaryTarget] = useState("");
  const appliedRouteRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    void createMangaRuntime()
      .then(async (nextRuntime) => {
        await restoreProject(nextRuntime);
        if (!cancelled) setRuntime(nextRuntime);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setBootError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (runtime === null) return;
    const timer = window.setTimeout(() => void persistProject(runtime), 650);
    return () => window.clearTimeout(timer);
  }, [runtime, state.pages, state.graph, state.settings, state.glossary, state.batch]);

  useEffect(() => {
    if (runtime === null) return;
    let cancelled = false;
    const pages = state.pages;
    void (async () => {
      for (const page of pages) {
        try {
          const refs = await persistMangaDocumentPackages(
            runtime,
            page,
            state.settings.sourceLanguage,
            hostServices?.artifacts,
          );
          if (cancelled) return;
          const current = manga.getSnapshot().pages.find((candidate) => candidate.id === page.id);
          if (
            current === undefined ||
            JSON.stringify(current.regions) !== JSON.stringify(page.regions)
          ) {
            continue;
          }
          if (manga.setDocumentArtifacts(page.id, refs)) {
            manga.log("ok", `document bridge · ${page.source.name} · canonical packages ready`);
          }
        } catch (error) {
          if (!cancelled) {
            manga.log(
              "warn",
              `document bridge · ${page.source.name} · ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostServices?.artifacts, runtime, state.pages, state.settings.sourceLanguage]);

  useEffect(() => {
    const search = hostServices?.search;
    if (search === undefined || runtime === null) return;
    const records: SearchDocument[] = [];
    for (const [index, page] of state.pages.entries()) {
      const packages = mangaPageToDocumentPackages(page, state.settings.sourceLanguage);
      records.push({
        id: `manga:page:${page.id}`,
        source: "manga",
        kind: "manga-page",
        title: page.source.name,
        subtitle: `page ${index + 1} · ${page.regions.length} regions · ${page.outputReady ? "ready" : "in progress"}`,
        body: packages.content.blocks
          .flatMap((block, blockIndex) => [
            block.label,
            block.text,
            packages.translation.blocks[blockIndex]?.translatedText ?? "",
          ])
          .join(" ")
          .slice(0, 24_000),
        tags: ["manga", "ocr", "translation"],
        route: `/manga?page=${encodeURIComponent(page.id)}`,
        updatedAt: 0,
      });
      for (const block of packages.content.blocks) {
        const translation = packages.translation.blocks.find(
          (candidate) => candidate.id === block.id,
        );
        const body = [block.text, translation?.translatedText ?? ""].filter(Boolean).join(" ");
        records.push({
          id: `manga:region:${page.id}:${block.id}`,
          source: "manga",
          kind: "manga-region",
          title: block.label,
          subtitle: `${page.source.name} · ${translation?.status ?? "needs-review"}`,
          ...(body.length === 0 ? {} : { body }),
          tags: ["manga", "region", block.writingMode ?? "horizontal-tb"],
          route: `/manga?page=${encodeURIComponent(page.id)}`,
          updatedAt: 0,
        });
      }
    }
    search.replaceSource("manga", records);
  }, [hostServices?.search, runtime, state.pages, state.settings.sourceLanguage]);

  useEffect(() => {
    if (routePageId === null || appliedRouteRef.current === routePageId) return;
    if (state.pages.some((page) => page.id === routePageId)) {
      appliedRouteRef.current = routePageId;
      manga.selectPage(routePageId);
    }
  }, [routePageId, state.pages]);

  useEffect(() => {
    if (runtime === null) return;
    const persistOnPageHide = () => void persistProject(runtime);
    const persistOnVisibilityChange = () => {
      if (document.visibilityState === "hidden") persistOnPageHide();
    };
    window.addEventListener("pagehide", persistOnPageHide);
    document.addEventListener("visibilitychange", persistOnVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", persistOnPageHide);
      document.removeEventListener("visibilitychange", persistOnVisibilityChange);
    };
  }, [runtime]);

  const selectedRegion = useMemo(
    () => state.regions.find((region) => region.id === state.activeRegionId) ?? null,
    [state.activeRegionId, state.regions],
  );
  const activePageIndex = Math.max(
    0,
    state.pages.findIndex((page) => page.id === state.activePageId),
  );
  const totalSize = state.pages.reduce((sum, page) => sum + page.source.size, 0);
  const batchRunning = state.batch?.status === "running";
  const batchPaused = state.batch?.status === "paused";
  const batchError = state.batch?.status === "error";
  const resumableCurrentPage =
    !state.outputReady &&
    state.stages.some((stage) => stage.id !== "import" && stage.status === "done") &&
    state.stages.some((stage) => stage.id !== "import" && stage.status !== "done");
  const pendingPages = state.pages.filter((page) => !page.outputReady).length;
  const batchProgress =
    state.batch === undefined || state.batch.pageIds.length === 0
      ? 0
      : state.batch.completedPageIds.length / state.batch.pageIds.length;
  const translationResolution = resolveMangaTranslationAdapter(
    state.settings.engine,
    state.settings.sourceLanguage,
    { device: state.settings.translationDevice },
  );
  const effectiveTranslationManifest = translationResolution.effectiveManifest;
  const translationModel = translationResolution.execution.model;
  const ocrResolution = resolveMangaOcrAdapter(
    state.settings.ocrAdapter,
    state.settings.sourceLanguage,
    { model: state.settings.ocrModel, device: state.settings.ocrDevice },
  );
  const ocrManifest = ocrResolution.manifest;
  const effectiveOcrManifest = ocrResolution.effectiveManifest;
  const ocrIsLocal = state.settings.ocrAdapter !== "review.manual";
  const ocrSupportsLanguage = ocrResolution.execution.fallbackReason !== "language-unsupported";
  const cleanResolution = resolveMangaCleanMode(state.settings.cleanMode);
  const cleanManifest = CLEAN_MODEL_MANIFESTS.find(
    (manifest) =>
      manifest.id === (state.settings.cleanMode === "inpaint" ? "inpaint.onnx" : "fill"),
  );

  const importImage = async (file: File): Promise<void> => {
    if (runtime === null) {
      manga.log("warn", "import · runtime is still starting");
      return;
    }
    if (manga.getSnapshot().running) {
      manga.log("warn", "import · stop the current page pipeline before adding pages");
      return;
    }
    if (!file.type.startsWith("image/")) {
      manga.log("error", `import · unsupported file type · ${file.type || "unknown"}`);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("image decode failed"));
        image.src = objectUrl;
      });
      const ref = await importImageArtifact(runtime, file, hostServices?.artifacts);
      if (manga.getSnapshot().running) {
        URL.revokeObjectURL(objectUrl);
        manga.log("warn", "import · page pipeline started before import finished");
        return;
      }
      manga.addSource(
        {
          id: `image-${Date.now().toString(36)}-${ref.hash?.slice(0, 8) ?? "page"}`,
          kind: "image",
          name: file.name,
          size: file.size,
          objectUrl,
          width: dimensions.width,
          height: dimensions.height,
          pageCount: 1,
          ref,
        },
        [],
      );
      manga.log(
        "warn",
        manga.getSnapshot().settings.ocrAdapter !== "review.manual"
          ? "视觉 OCR · Local ONNX 将在处理阶段按需加载模型"
          : "视觉 OCR · 将创建待审校区域并由 review adapter 固化",
      );
    } catch (reason) {
      URL.revokeObjectURL(objectUrl);
      manga.log("error", `import · ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  const importImageFiles = async (files: ReadonlyArray<File>): Promise<void> => {
    for (const file of files) await importImage(file);
  };

  const importFiles = async (files: ReadonlyArray<File>): Promise<void> => {
    if (runtime === null) {
      manga.log("warn", "import · runtime is still starting");
      return;
    }
    if (manga.getSnapshot().running || manga.getSnapshot().batch?.status === "running") {
      manga.log("warn", "import · pause the current pipeline before adding pages");
      return;
    }
    for (const file of files) {
      const format = formatForMangaFile(file);
      if (format === "image") {
        await importImage(file);
        continue;
      }
      if (format !== "cbz" && format !== "pdf") {
        manga.log("error", `import · unsupported file type · ${file.type || file.name}`);
        continue;
      }
      manga.log("info", `archive · ${file.name} · expanding ${format.toUpperCase()}`);
      try {
        const pages = await expandMangaArchive(file);
        await importImageFiles(pages);
        manga.log("ok", `archive · ${file.name} · ${pages.length} page(s) added`);
      } catch (reason) {
        manga.log(
          "error",
          `archive · ${file.name} · ${reason instanceof Error ? reason.message : String(reason)}`,
        );
      }
    }
  };

  useEffect(() => {
    if (runtime === null) return;
    const handoffId = new URLSearchParams(window.location.search).get("document");
    if (handoffId === null || handoffId === handoffRef.current) return;
    handoffRef.current = handoffId;
    const handoff = consumeDocumentHandoff(handoffId, "manga");
    window.history.replaceState({}, "", "/manga");
    if (handoff === undefined) {
      const marker = getDocumentHandoffMarker();
      markDocumentHandoffExpired(handoffId, "manga");
      manga.log(
        "warn",
        `handoff · ${marker?.id === handoffId && marker.target === "manga" ? marker.name : "source"} link expired · import the source again in Document Studio`,
      );
      return;
    }
    void (async () => {
      try {
        const file = await fileFromDocumentHandoff(runtime, handoff, hostServices?.artifacts);
        if (formatForMangaFile(file) === "unknown") {
          manga.log(
            "warn",
            `handoff · ${handoff.name} needs a page-image adapter before Manga Studio`,
          );
          return;
        }
        await importFiles([file]);
        manga.log(
          "ok",
          `handoff · ${handoff.name} restored from ${handoff.sourceRef === undefined ? "tab-local File" : "source Artifact"}`,
        );
      } catch (reason) {
        manga.log(
          "error",
          `handoff · ${handoff.name} restore failed · ${reason instanceof Error ? reason.message : String(reason)}`,
        );
      }
    })();
  }, [fileFromDocumentHandoff, hostServices?.artifacts, importFiles, runtime]);

  const addRegion = (): void => {
    const index = state.regions.length + 1;
    const region: TextRegion = {
      id: `manual-${Date.now()}`,
      label: `REVIEW ${String(index).padStart(2, "0")}`,
      x: 34,
      y: 46,
      width: 32,
      height: 10,
      rotation: 0,
      writingMode: "horizontal-tb",
      sourceText: "输入原文",
      translatedText: "输入译文",
      confidence: 0,
      status: "needs-review",
    };
    manga.addRegion(region);
  };

  const addGlossary = (): void => {
    if (manga.addGlossaryEntry(glossarySource, glossaryTarget)) {
      setGlossarySource("");
      setGlossaryTarget("");
    }
  };

  const run = () => {
    void runMangaPipeline(hostServices ?? undefined, { resume: resumableCurrentPage });
  };

  const exportPage = () => {
    setExporting(true);
    void exportCurrentPage()
      .catch((reason: unknown) => {
        manga.log("error", `export · ${reason instanceof Error ? reason.message : String(reason)}`);
      })
      .finally(() => setExporting(false));
  };

  const handoffDocument = () => {
    if (runtime === null || documentHandoffBusy || state.running || batchRunning) return;
    const hostArtifacts = hostServices?.artifacts;
    if (hostArtifacts === undefined) {
      manga.log("warn", "handoff · open Manga from Studio Shell to reach Document Studio");
      return;
    }
    const page = state.pages.find((candidate) => candidate.id === state.activePageId);
    if (page === undefined) return;
    setDocumentHandoffBusy(true);
    void prepareMangaDocumentHandoff(runtime, hostArtifacts, page, state.settings.sourceLanguage)
      .then(({ file, sourceRef, content, translation, contentRef, translationRef }) => {
        const handoffId = publishDocumentHandoff({
          jobId: page.id,
          target: "document",
          name: page.source.name,
          format: content.format,
          file,
          size: page.source.size,
          sourceRef,
          contentRef,
          translationRef,
          content,
          translation,
        });
        manga.log("ok", `handoff · ${page.source.name} · Document Studio`);
        window.location.assign(`/documents?handoff=${encodeURIComponent(handoffId)}`);
      })
      .catch((reason: unknown) => {
        manga.log(
          "error",
          `handoff · ${page.source.name} · ${reason instanceof Error ? reason.message : String(reason)}`,
        );
      })
      .finally(() => setDocumentHandoffBusy(false));
  };

  if (bootError !== null) {
    return (
      <div className="manga-boot manga-boot-error">
        <CircleAlert className="size-5" />
        <span>Runtime 初始化失败：{bootError}</span>
      </div>
    );
  }
  if (runtime === null) {
    return (
      <div className="manga-boot">
        <span className="manga-brand-mark">M/01</span>
        <span>
          <strong>ASSEMBLING MANGA RUNTIME</strong>
          <small>OPFS · SQLite · Artifact store</small>
        </span>
      </div>
    );
  }

  return (
    <div className="manga-studio">
      <header className="manga-header">
        <div className="manga-brand-lockup">
          <div className="manga-brand-mark">M/01</div>
          <div>
            <div className="manga-brand-title">
              BCR <span>/</span> Manga Studio
            </div>
            <div className="manga-brand-subtitle">local-first comic translation workbench</div>
          </div>
        </div>

        <div className="manga-header-status">
          <span className="manga-chip manga-chip-cyan">
            <span className="manga-live-dot" /> LOCAL-FIRST
          </span>
          <span className="manga-chip">{sourceLabel(state.source)}</span>
          <span className="manga-header-size">
            {state.source.width} × {state.source.height}
          </span>
        </div>

        <div className="manga-header-actions">
          <button
            type="button"
            className="manga-button manga-button-secondary"
            disabled={state.running || batchRunning || documentHandoffBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="size-4" />
            导入文件
          </button>
          <button
            type="button"
            className="manga-button manga-button-secondary"
            disabled={
              state.running || batchRunning || documentHandoffBusy || state.source.ref === undefined
            }
            onClick={handoffDocument}
            aria-label="交给 Document Studio"
            title={state.source.ref === undefined ? "请先导入原始图片" : "交给 Document Studio"}
          >
            <FileText className="size-4" />
            {documentHandoffBusy ? "交接中…" : "交给 Document"}
            <ArrowUpRight className="size-3.5" />
          </button>
          {batchRunning ? (
            <button
              type="button"
              className="manga-button manga-button-danger"
              onClick={cancelMangaQueue}
            >
              <Square className="size-3.5" />
              暂停队列
            </button>
          ) : state.running ? (
            <button
              type="button"
              className="manga-button manga-button-danger"
              onClick={cancelMangaPipeline}
            >
              <Square className="size-3.5" />
              停止处理
            </button>
          ) : (
            <button type="button" className="manga-button manga-button-primary" onClick={run}>
              <Play className="size-4" />
              {resumableCurrentPage ? "继续当前页" : "翻译当前页"}
            </button>
          )}
          {state.pages.length > 1 &&
            !state.running &&
            !batchRunning &&
            (pendingPages > 0 || batchPaused || batchError) && (
              <button
                type="button"
                className="manga-button manga-button-secondary"
                onClick={() => void runMangaQueue(hostServices ?? undefined)}
              >
                <ListChecks className="size-4" />
                {batchPaused ? "继续队列" : batchError ? "重试队列" : "处理队列"}
              </button>
            )}
          <input
            ref={fileInputRef}
            type="file"
            aria-label="导入漫画图片或压缩包"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,application/vnd.comicbook+zip,application/zip,.pdf,.cbz,.zip"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length > 0) void importFiles(files);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </header>

      <div className="manga-workspace">
        <aside className="manga-sidebar manga-sidebar-left">
          <section className="manga-sidebar-section manga-project-section">
            <div className="manga-section-kicker">PROJECT / 01</div>
            <div className="manga-project-name">Spring Notes</div>
            <div className="manga-project-meta">
              <span>
                {state.pages.length} page{state.pages.length === 1 ? "" : "s"}
              </span>
              <span>·</span>
              <span>{formatBytes(totalSize)}</span>
              <span>·</span>
              <span className="manga-dot-status">autosaved</span>
            </div>
          </section>

          <section className="manga-sidebar-section">
            <div className="manga-section-heading">
              <span>PAGE QUEUE</span>
              <span className="manga-count">
                {String(activePageIndex + 1).padStart(2, "0")} /{" "}
                {String(state.pages.length).padStart(2, "0")}
              </span>
            </div>
            <div className="manga-page-queue" aria-label="漫画页面队列">
              {state.pages.map((page, index) => {
                const completedStages = page.stages.filter(
                  (stage) => stage.status === "done",
                ).length;
                const pageStatus = page.outputReady
                  ? "translated"
                  : page.stages.some((stage) => stage.status === "running")
                    ? "processing"
                    : "needs review";
                return (
                  <button
                    type="button"
                    key={page.id}
                    className={`manga-page-card ${page.id === state.activePageId ? "manga-page-card-active" : ""}`}
                    disabled={(state.running || batchRunning) && page.id !== state.activePageId}
                    aria-label={`选择第 ${index + 1} 页：${page.source.name}`}
                    aria-current={page.id === state.activePageId ? "page" : undefined}
                    onClick={() => manga.selectPage(page.id)}
                  >
                    <span className="manga-page-thumb">
                      <img src={page.source.objectUrl} alt={`第 ${index + 1} 页缩略图`} />
                      <span className="manga-page-thumb-overlay">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </span>
                    <span className="manga-page-card-copy">
                      <span className="manga-page-card-name">{page.source.name}</span>
                      <span className="manga-page-card-detail">
                        {page.regions.length} regions <span>·</span> {pageStatus}
                        {completedStages > 0 && <span> · {completedStages}/9</span>}
                      </span>
                    </span>
                    <ChevronDown className="manga-page-card-chevron size-4" />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="manga-import-card"
              disabled={state.running || batchRunning}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const files = Array.from(event.dataTransfer.files);
                if (files.length > 0) void importFiles(files);
              }}
            >
              <Upload className="size-4" />
              <span>
                <strong>拖入更多页面</strong>
                <small>PNG / JPG / WEBP / CBZ / PDF</small>
              </span>
            </button>
            {state.batch !== undefined && (
              <div
                className={`manga-batch-card manga-batch-${state.batch.status}`}
                data-batch-status={state.batch.status}
              >
                <div className="manga-batch-heading">
                  <span>
                    <ListChecks className="size-3.5" /> QUEUE JOB
                  </span>
                  <strong>
                    {state.batch.completedPageIds.length}/{state.batch.pageIds.length}
                  </strong>
                </div>
                <div className="manga-batch-progress" aria-label="批处理进度">
                  <span style={{ width: `${batchProgress * 100}%` }} />
                </div>
                <small>
                  {state.batch.status === "running"
                    ? `处理中 · ${state.batch.activePageId ? "当前页运行中" : "准备下一页"}`
                    : state.batch.status === "paused"
                      ? "已暂停 · 可继续"
                      : state.batch.status === "completed"
                        ? "已完成 · 新页面可继续加入"
                        : `失败 · ${state.batch.error ?? "请重试"}`}
                </small>
              </div>
            )}
          </section>

          <section className="manga-sidebar-section manga-pipeline-section">
            <div className="manga-section-heading">
              <span>PIPELINE</span>
              <span className="manga-count">
                {state.stages.filter((stage) => stage.status === "done").length}/9
              </span>
            </div>
            <div className="manga-stage-list" aria-label="翻译流水线进度">
              {state.stages.map((stage) => (
                <div
                  key={stage.id}
                  className={`manga-stage-row ${stageTone(stage.status)}`}
                  data-artifact={stage.artifact?.id}
                  data-execution={executionLabel(stage.execution)}
                >
                  <span className="manga-stage-icon">{statusIcon(stage.status)}</span>
                  <span className="manga-stage-copy">
                    <span className="manga-stage-label">{stage.label}</span>
                    <span className="manga-stage-detail">{stage.detail}</span>
                    {stage.execution !== undefined && (
                      <span className="manga-stage-execution">
                        {executionLabel(stage.execution)}
                      </span>
                    )}
                  </span>
                  <span className="manga-stage-status">{statusLabel(stage.status)}</span>
                  {stage.status === "running" && (
                    <span
                      className="manga-stage-progress"
                      style={{ width: `${stage.progress * 100}%` }}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="manga-adapter-note">
              <WandSparkles className="size-4" />
              <span>
                <strong>
                  {ocrResolution.execution.requestedAdapter ===
                  ocrResolution.execution.effectiveAdapter
                    ? ocrManifest.label
                    : `${ocrResolution.execution.requestedAdapter} → ${ocrResolution.execution.effectiveAdapter}`}
                </strong>
                <small>{effectiveOcrManifest.detail}</small>
                {ocrResolution.execution.fallbackReason !== undefined && (
                  <small className="manga-config-warning">
                    {fallbackLabel(ocrResolution.execution.fallbackReason)}
                  </small>
                )}
              </span>
            </div>
          </section>
        </aside>

        <main className="manga-main">
          <div className="manga-main-toolbar">
            <div className="manga-view-tabs" role="tablist" aria-label="页面预览模式">
              {(
                [
                  ["translated", "TRANSLATED"],
                  ["clean", "CLEAN PAGE"],
                  ["original", "ORIGINAL"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={state.outputMode === mode}
                  className={
                    state.outputMode === mode
                      ? "manga-view-tab manga-view-tab-active"
                      : "manga-view-tab"
                  }
                  onClick={() => manga.setOutputMode(mode as OutputMode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="manga-canvas-tools">
              <span className="manga-canvas-label">
                <FileImage className="size-3.5" /> {state.source.name}
              </span>
              <button
                type="button"
                className="manga-icon-button"
                aria-label="缩小页面"
                onClick={() =>
                  setZoom((value) => Math.max(0.55, Number((value - 0.08).toFixed(2))))
                }
              >
                <Minus className="size-4" />
              </button>
              <span className="manga-zoom-value">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className="manga-icon-button"
                aria-label="放大页面"
                onClick={() => setZoom((value) => Math.min(1.2, Number((value + 0.08).toFixed(2))))}
              >
                <Plus className="size-4" />
              </button>
              <button
                type="button"
                className="manga-icon-button"
                aria-label="重置缩放"
                onClick={() => setZoom(0.82)}
              >
                <RotateCcw className="size-3.5" />
              </button>
            </div>
          </div>

          <div className="manga-canvas-area">
            <div className="manga-canvas-grid" aria-hidden="true" />
            <div className="manga-canvas-scroll">
              <div className="manga-page-stage" style={{ transform: `scale(${zoom})` }}>
                <div className="manga-page-art">
                  <img src={state.source.objectUrl} alt="正在翻译的漫画页面" draggable={false} />
                  {state.outputMode !== "original" &&
                    state.regions.map((region) => (
                      <button
                        type="button"
                        key={region.id}
                        className={`manga-region manga-region-${state.outputMode} ${
                          region.id === state.activeRegionId ? "manga-region-active" : ""
                        }`}
                        style={{
                          left: `${region.x}%`,
                          top: `${region.y}%`,
                          width: `${region.width}%`,
                          height: `${region.height}%`,
                          transform: `rotate(${region.rotation}deg)`,
                        }}
                        onClick={() => manga.setActiveRegion(region.id)}
                        aria-label={`${region.label}，${region.translatedText}`}
                      >
                        <span className="manga-region-tag">{region.label}</span>
                        {state.outputMode === "translated" && (
                          <span className="manga-region-copy">{region.translatedText}</span>
                        )}
                      </button>
                    ))}
                </div>
              </div>
            </div>
            <div className="manga-canvas-caption">
              <span>
                <ScanText className="size-3.5" /> {state.regions.length} text regions · click a
                region to review
              </span>
              <span className="manga-caption-right">
                {state.settings.sourceLanguage.toUpperCase()} → ZH
              </span>
            </div>
          </div>
        </main>

        <aside className="manga-sidebar manga-sidebar-right">
          <section className="manga-sidebar-section manga-config-section">
            <div className="manga-section-heading">
              <span>TRANSLATION</span>
              <Languages className="size-4 text-[var(--manga-cyan)]" />
            </div>
            <div className="manga-config-grid">
              <label>
                <span>源语言</span>
                <select
                  aria-label="源语言"
                  value={state.settings.sourceLanguage}
                  onChange={(event) =>
                    manga.setSettings({ sourceLanguage: event.target.value as "ja" | "en" | "ko" })
                  }
                >
                  <option value="ja">日本語</option>
                  <option value="en">English</option>
                  <option value="ko">한국어</option>
                </select>
              </label>
              <label>
                <span>目标语言</span>
                <select value="zh" disabled aria-label="目标语言">
                  <option value="zh">简体中文</option>
                </select>
              </label>
            </div>
            <label className="manga-config-wide">
              <span>翻译引擎</span>
              <select
                aria-label="翻译引擎"
                value={state.settings.engine}
                onChange={(event) =>
                  manga.setSettings({ engine: event.target.value as MangaTranslationEngineId })
                }
              >
                {TRANSLATION_MODEL_MANIFESTS.map((manifest) => (
                  <option key={manifest.id} value={manifest.id}>
                    {manifest.label}
                  </option>
                ))}
              </select>
            </label>
            {state.settings.engine === "local" && (
              <>
                <div className="manga-model-note">
                  <strong>{translationModel ?? "No model manifest"}</strong>
                  <small>{effectiveTranslationManifest.detail}</small>
                </div>
                {translationResolution.execution.fallbackReason !== undefined && (
                  <small className="manga-config-help manga-config-warning">
                    {fallbackLabel(translationResolution.execution.fallbackReason)}
                  </small>
                )}
                <label className="manga-config-wide">
                  <span>翻译设备</span>
                  <select
                    aria-label="翻译设备"
                    value={state.settings.translationDevice}
                    onChange={(event) =>
                      manga.setSettings({
                        translationDevice: event.target.value as MangaOcrDevice,
                      })
                    }
                  >
                    <option value="auto">Auto / 自动降级</option>
                    <option value="webgpu">WebGPU / 优先 GPU</option>
                    <option value="wasm">WASM / 兼容模式</option>
                  </select>
                </label>
              </>
            )}
            <label className="manga-config-wide">
              <span>OCR 引擎</span>
              <select
                aria-label="OCR 引擎"
                value={state.settings.ocrAdapter}
                onChange={(event) => {
                  const ocrAdapter = event.target.value as MangaOcrAdapterId;
                  const manifest = OCR_MODEL_MANIFESTS.find(
                    (candidate) => candidate.id === ocrAdapter,
                  );
                  manga.setSettings({
                    ocrAdapter,
                    ...(manifest?.model === undefined ? {} : { ocrModel: manifest.model }),
                  });
                }}
              >
                {OCR_MODEL_MANIFESTS.map((manifest) => (
                  <option key={manifest.id} value={manifest.id}>
                    {manifest.label}
                  </option>
                ))}
              </select>
            </label>
            {ocrIsLocal && (
              <>
                <label className="manga-config-wide">
                  <span>OCR 模型</span>
                  <input
                    aria-label="OCR 模型"
                    value={state.settings.ocrModel}
                    onChange={(event) => manga.setSettings({ ocrModel: event.target.value })}
                    spellCheck={false}
                    aria-describedby="manga-ocr-model-help"
                  />
                  <small id="manga-ocr-model-help" className="manga-config-help">
                    {ocrManifest?.detail}
                  </small>
                </label>
                {!ocrSupportsLanguage && (
                  <small className="manga-config-help manga-config-warning">
                    当前源语言不在该模型能力范围内；建议切换 Review adapter 并人工审校。
                  </small>
                )}
                <label className="manga-config-wide">
                  <span>运行设备</span>
                  <select
                    aria-label="OCR 运行设备"
                    value={state.settings.ocrDevice}
                    onChange={(event) =>
                      manga.setSettings({ ocrDevice: event.target.value as MangaOcrDevice })
                    }
                  >
                    <option value="auto">Auto / 自动降级</option>
                    <option value="webgpu">WebGPU / 优先 GPU</option>
                    <option value="wasm">WASM / 兼容模式</option>
                  </select>
                </label>
              </>
            )}
            <div className="manga-config-grid manga-typeset-controls">
              <label>
                <span>原文清理</span>
                <select
                  aria-label="原文清理模式"
                  value={state.settings.cleanMode}
                  onChange={(event) =>
                    manga.setSettings({ cleanMode: event.target.value as MangaCleanMode })
                  }
                >
                  <option value="fill">Fill / 稳定</option>
                  <option value="inpaint">Inpaint / 实验（回退 Fill）</option>
                </select>
              </label>
              <label>
                <span className="manga-range-label">
                  字号 <b>{state.settings.fontSize.toFixed(1)}×</b>
                </span>
                <input
                  className="manga-range"
                  type="range"
                  min="0.7"
                  max="1.4"
                  step="0.1"
                  value={state.settings.fontSize}
                  aria-label="译文字号缩放"
                  onChange={(event) => manga.setSettings({ fontSize: Number(event.target.value) })}
                />
              </label>
            </div>
            <small
              className={
                cleanResolution.fallbackReason
                  ? "manga-config-help manga-config-warning"
                  : "manga-config-help"
              }
            >
              {cleanResolution.fallbackReason
                ? `${cleanManifest?.detail ?? "Inpaint 尚未接入"} · 本次有效模式：Fill`
                : cleanManifest?.detail}
            </small>
            <div className="manga-capability-row">
              <span
                className={
                  ocrIsLocal
                    ? "manga-capability-pill manga-capability-experimental"
                    : "manga-capability-pill"
                }
              >
                {ocrIsLocal ? `${ocrManifest?.label ?? "ONNX OCR"} · EXP` : "REVIEW OCR"}
              </span>
              <span className="manga-capability-pill">GLOSSARY</span>
              <span
                className={
                  state.settings.cleanMode === "inpaint"
                    ? "manga-capability-pill manga-capability-experimental"
                    : "manga-capability-pill manga-capability-muted"
                }
              >
                {state.settings.cleanMode === "inpaint" ? "INPAINT · FALLBACK" : "INPAINT · SOON"}
              </span>
            </div>
          </section>

          <section className="manga-sidebar-section manga-glossary-section">
            <div className="manga-section-heading">
              <span>GLOSSARY</span>
              <span className="manga-count">{state.glossary.length}</span>
            </div>
            <div className="manga-glossary-form">
              <label>
                <span>原文术语</span>
                <input
                  value={glossarySource}
                  placeholder="例如：勇者"
                  onChange={(event) => setGlossarySource(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addGlossary();
                    }
                  }}
                />
              </label>
              <label>
                <span>固定译法</span>
                <input
                  value={glossaryTarget}
                  placeholder="例如：勇者大人"
                  onChange={(event) => setGlossaryTarget(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addGlossary();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="manga-button manga-button-secondary manga-glossary-add"
                disabled={glossarySource.trim().length === 0 || glossaryTarget.trim().length === 0}
                onClick={addGlossary}
              >
                <Plus className="size-3.5" /> 添加术语
              </button>
            </div>
            <div className="manga-glossary-list">
              {state.glossary.length === 0 ? (
                <div className="manga-glossary-empty">暂无术语 · 添加后会在翻译阶段优先采用</div>
              ) : (
                state.glossary.map((entry) => (
                  <div className="manga-glossary-entry" key={entry.id}>
                    <input
                      value={entry.source}
                      aria-label={`术语原文：${entry.source}`}
                      onChange={(event) =>
                        manga.updateGlossaryEntry(entry.id, { source: event.target.value })
                      }
                    />
                    <span className="manga-glossary-arrow" aria-hidden="true">
                      →
                    </span>
                    <input
                      value={entry.target}
                      aria-label={`术语译文：${entry.target}`}
                      onChange={(event) =>
                        manga.updateGlossaryEntry(entry.id, { target: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="manga-icon-button manga-glossary-remove"
                      aria-label={`删除术语：${entry.source}`}
                      onClick={() => manga.removeGlossaryEntry(entry.id)}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="manga-sidebar-section manga-region-section">
            <div className="manga-section-heading">
              <span>TEXT REGIONS</span>
              <button type="button" className="manga-add-region" onClick={addRegion}>
                <Plus className="size-3.5" /> 添加区域
              </button>
            </div>
            <div className="manga-region-list">
              {state.regions.length === 0 ? (
                <div className="manga-empty-regions">
                  <ScanText className="size-5" />
                  <span>运行检测或手动添加文本区域</span>
                </div>
              ) : (
                state.regions.map((region) => (
                  <button
                    type="button"
                    key={region.id}
                    className={`manga-region-row ${region.id === state.activeRegionId ? "manga-region-row-active" : ""}`}
                    onClick={() => manga.setActiveRegion(region.id)}
                  >
                    <span className="manga-region-index">
                      {region.label.replace("BUBBLE ", "").replace("REVIEW ", "#")}
                    </span>
                    <span className="manga-region-row-copy">
                      <strong>{region.sourceText}</strong>
                      <small>{region.translatedText}</small>
                    </span>
                    <span
                      className={`manga-confidence ${region.confidence < 0.7 ? "manga-confidence-low" : ""}`}
                    >
                      {percent(region.confidence)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="manga-sidebar-section manga-inspector-section">
            <div className="manga-section-heading">
              <span>INSPECTOR</span>
              <PanelRight className="size-4 text-[var(--manga-muted)]" />
            </div>
            {selectedRegion === null ? (
              <div className="manga-inspector-empty">选择一个文本区域开始审校</div>
            ) : (
              <RegionInspector region={selectedRegion} glossary={state.glossary} />
            )}
          </section>

          <section className="manga-sidebar-section manga-export-section">
            <div className="manga-export-note">
              <Type className="size-4" />
              <span>译文会保留页面尺寸，当前导出为 PNG。</span>
            </div>
            <button
              type="button"
              className="manga-button manga-button-primary manga-export-button"
              disabled={exporting}
              onClick={exportPage}
            >
              <Download className="size-4" />
              {exporting ? "正在编码…" : "导出当前页面"}
            </button>
          </section>
        </aside>
      </div>

      <footer className="manga-footer">
        <div className="manga-footer-log">
          <span className="manga-footer-pulse" />
          <span className="manga-footer-log-label">RUNTIME LOG</span>
          <span className="manga-footer-message">{state.logs.at(-1)?.message ?? "ready"}</span>
        </div>
        <div className="manga-footer-meta">
          <span>ARTIFACTS · {state.stages.filter((stage) => stage.status === "done").length}</span>
          <span>OPFS READY</span>
          <span>WORKER · WASM FALLBACK</span>
        </div>
      </footer>
    </div>
  );
}

function RegionInspector({
  region,
  glossary,
}: {
  region: TextRegion;
  glossary: ReadonlyArray<MangaGlossaryEntry>;
}) {
  const matches = findGlossaryMatches(region.sourceText, glossary);
  return (
    <div className="manga-inspector-fields">
      <div className="manga-inspector-title-row">
        <span className="manga-inspector-id">{region.label}</span>
        <span
          className={
            region.confidence < 0.7
              ? "manga-review-badge manga-review-badge-warn"
              : "manga-review-badge"
          }
        >
          {region.confidence < 0.7 ? "REVIEW" : "CONFIDENT"}
        </span>
      </div>
      <label>
        <span>原文 / OCR 输出</span>
        <textarea
          aria-label="原文 OCR 输出"
          value={region.sourceText}
          onChange={(event) => manga.patchRegion(region.id, { sourceText: event.target.value })}
          rows={2}
        />
      </label>
      <label>
        <span>译文 / 可直接编辑</span>
        <textarea
          aria-label="译文"
          value={region.translatedText}
          onChange={(event) => manga.patchRegion(region.id, { translatedText: event.target.value })}
          rows={2}
        />
      </label>
      <div className="manga-inspector-grid">
        <label>
          <span>阅读方向</span>
          <select
            aria-label="阅读方向"
            value={region.writingMode}
            onChange={(event) =>
              manga.patchRegion(region.id, {
                writingMode: event.target.value as TextRegion["writingMode"],
              })
            }
          >
            <option value="horizontal-tb">横排</option>
            <option value="vertical-rl">竖排</option>
          </select>
        </label>
        <label>
          <span>置信度</span>
          <input value={percent(region.confidence)} readOnly aria-label="OCR 置信度" />
        </label>
      </div>
      <div
        className={`manga-glossary-hit ${matches.length > 0 ? "manga-glossary-hit-active" : ""}`}
      >
        <span className="manga-glossary-dot" />
        <span>
          {matches.length > 0
            ? `Glossary 命中 · ${matches.map((entry) => `${entry.source} → ${entry.target}`).join(" · ")}`
            : "Glossary 未命中 · 可在上方加入术语"}
        </span>
      </div>
      <button
        type="button"
        className="manga-remove-region"
        onClick={() => manga.removeRegion(region.id)}
      >
        <X className="size-3.5" /> 删除此区域
      </button>
    </div>
  );
}
