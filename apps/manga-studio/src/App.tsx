import { useNavigation } from "@bcr/react";
import type { SearchDocument } from "@bcr/core";
import {
  consumeDocumentHandoff,
  getDocumentHandoffMarker,
  markDocumentHandoffExpired,
  publishDocumentHandoff,
} from "@bcr/document-core";
import {
  Button,
  Dialog,
  Drawer,
  Toast,
  type Notice,
  StatusDot,
  useMediaQuery,
  useLocationSearch,
  useOptionalRuntime,
  usePublishRunningCount,
} from "@bcr/react";
import { CircleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { expandMangaArchive, formatForMangaFile } from "./project/archive";
import { mangaPageToDocumentPackages } from "./documents/document-adapter";
import { MangaCanvas } from "./workbench/MangaCanvas";
import { MangaHeader } from "./workbench/MangaHeader";
import { MangaProjectPanel } from "./workbench/MangaProjectPanel";
import { MangaToolsPanel } from "./workbench/MangaToolsPanel";
import { CLEAN_MODEL_MANIFESTS } from "./models/catalog";
import {
  resolveMangaCleanMode,
  resolveMangaOcrAdapter,
  resolveMangaTranslationAdapter,
} from "./models/resolution";
import { type MangaAdapterExecution, type TextRegion } from "./project/model";
import type { MangaModelCacheInfo } from "./models/model-cache";
import type { MangaModelRecord } from "./models/model-registry";
import { createMangaRuntime, type MangaRuntime } from "./runtime";
import {
  fileFromDocumentHandoff,
  importMangaExportBundle,
  persistMangaDocumentPackages,
  prepareMangaDocumentHandoff,
  regionsFromDocumentHandoff,
} from "./documents/handoff";
import { importImageArtifact } from "./project/source";
import { persistProject } from "./project/persistence";
import { manga } from "./project/store";
import { useMangaStudio } from "./project/useMangaStudio";
import "./styles.css";

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
  const navigation = useNavigation();
  const state = useMangaStudio((snapshot) => snapshot);
  usePublishRunningCount("manga", state.running ? 1 : 0);
  const parentServices = useOptionalRuntime();
  const routeParams = new URLSearchParams(useLocationSearch());
  const routePageId = routeParams.get("page");
  const routeRegionId = routeParams.get("region");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handoffRef = useRef<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [documentHandoffBusy, setDocumentHandoffBusy] = useState(false);
  const [runtime, setRuntime] = useState<MangaRuntime | null>(null);
  const hostServices = runtime?.session ?? parentServices;
  const lifetime = useRef<Promise<void>>(Promise.resolve());
  const [bootError, setBootError] = useState<string | null>(null);
  const [glossarySource, setGlossarySource] = useState("");
  const [glossaryTarget, setGlossaryTarget] = useState("");
  const [modelRecords, setModelRecords] = useState<ReadonlyArray<MangaModelRecord>>([]);
  const [modelCacheInfo, setModelCacheInfo] = useState<MangaModelCacheInfo | null>(null);
  const [modelActionKey, setModelActionKey] = useState<string | null>(null);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const compactTools = useMediaQuery("(max-width: 960px)");

  useEffect(() => {
    if (state.logs.at(-1)?.level === "error")
      setNotice({ message: "操作未完成，请在更多菜单的运行详情中查看原因并重试。", tone: "error" });
  }, [state.logs]);
  useEffect(() => {
    if (state.running) setNotice(null);
  }, [state.running]);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const appliedRouteRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    let stop!: () => void;
    const stopped = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const previous = lifetime.current;
    lifetime.current = (async () => {
      await previous;
      if (cancelled) return;
      let owned: MangaRuntime | undefined;
      try {
        owned = await createMangaRuntime(parentServices?.host);
        if (cancelled) return;
        if (!cancelled) {
          setRuntime(owned);
          await stopped;
        }
      } catch (reason) {
        if (!cancelled) setBootError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        await owned?.session
          ?.dispose()
          .catch((error) => console.error("Manga cleanup failed", error));
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [parentServices?.host]);

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
            parentServices?.artifacts,
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
  }, [parentServices?.artifacts, runtime, state.pages, state.settings.sourceLanguage]);

  useEffect(() => {
    const search = parentServices?.search;
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
          route: `/manga?page=${encodeURIComponent(page.id)}&region=${encodeURIComponent(block.id)}`,
          updatedAt: 0,
        });
      }
    }
    search.replaceSource("manga", records);
  }, [parentServices?.search, runtime, state.pages, state.settings.sourceLanguage]);

  useEffect(() => {
    if (routePageId === null) return;
    const page = state.pages.find((candidate) => candidate.id === routePageId);
    if (page === undefined) return;
    const routeKey = `${routePageId}|${routeRegionId ?? ""}`;
    if (appliedRouteRef.current === routeKey) return;
    appliedRouteRef.current = routeKey;
    if (state.activePageId !== routePageId) manga.selectPage(routePageId);
    if (routeRegionId !== null && page.regions.some((region) => region.id === routeRegionId)) {
      manga.setActiveRegion(routeRegionId);
    }
  }, [routePageId, routeRegionId, state.activePageId, state.pages]);

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

  useEffect(() => {
    if (runtime === null) {
      setModelRecords([]);
      setModelCacheInfo(null);
      return;
    }
    const sync = () => setModelRecords(runtime.models.getSnapshot().records);
    sync();
    return runtime.models.subscribe(sync);
  }, [runtime]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const refreshModelCache = (): void => {
    if (runtime === null) return;
    void runtime.models.inspectCache().then(setModelCacheInfo);
  };

  useEffect(() => {
    if (runtime === null) return;
    refreshModelCache();
    const timer = window.setInterval(refreshModelCache, 15_000);
    return () => window.clearInterval(timer);
  }, [runtime, modelRecords]);

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
  const ocrResolution = resolveMangaOcrAdapter(
    state.settings.ocrAdapter,
    state.settings.sourceLanguage,
    { model: state.settings.ocrModel, device: state.settings.ocrDevice },
  );
  const modelActionId = (execution: MangaAdapterExecution): string =>
    execution.model === undefined
      ? `${execution.kind}:none`
      : `${execution.kind}:${execution.model}`;
  const startModelPreload = (execution: MangaAdapterExecution): void => {
    if (runtime === null) return;
    const actionId = modelActionId(execution);
    if (modelActionKey !== null) return;
    setModelActionKey(actionId);
    void runtime.pipeline
      .preloadMangaModel(hostServices ?? undefined, execution)
      .catch(() => undefined)
      .finally(() => {
        setModelActionKey((current) => (current === actionId ? null : current));
        refreshModelCache();
      });
  };
  const clearModelCache = (): void => {
    if (runtime === null || modelActionKey !== null) return;
    if (!window.confirm("清理 Manga 模型缓存？下次使用需要重新下载。")) return;
    setModelActionKey("clear");
    void runtime.models
      .clearCache()
      .then((deleted) => {
        manga.log(
          deleted ? "ok" : "warn",
          deleted ? "model cache · Manga 专属缓存已清理" : "model cache · 当前浏览器不支持清理",
        );
      })
      .catch((error: unknown) => {
        manga.log(
          "warn",
          `model cache · clear failed · ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        setModelActionKey(null);
        refreshModelCache();
      });
  };
  const cleanResolution = resolveMangaCleanMode(state.settings.cleanMode);
  const cleanManifest = CLEAN_MODEL_MANIFESTS.find(
    (manifest) =>
      manifest.id === (state.settings.cleanMode === "inpaint" ? "inpaint.onnx" : "fill"),
  );

  const importImage = async (
    file: File,
    initialRegions: ReadonlyArray<TextRegion> = [],
  ): Promise<void> => {
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
      const ref = await importImageArtifact(runtime, file, parentServices?.artifacts);
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
        initialRegions,
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

  const importFiles = async (
    files: ReadonlyArray<File>,
    initialRegions: ReadonlyArray<TextRegion> = [],
  ): Promise<void> => {
    if (runtime === null) {
      manga.log("warn", "import · runtime is still starting");
      return;
    }
    if (manga.getSnapshot().running || manga.getSnapshot().batch?.status === "running") {
      manga.log("warn", "import · pause the current pipeline before adding pages");
      return;
    }
    for (const file of files) {
      const isExportBundle =
        /\.json$/iu.test(file.name) || file.type.toLocaleLowerCase().startsWith("application/json");
      if (isExportBundle) {
        try {
          const replay = await importMangaExportBundle(runtime, file, parentServices?.artifacts);
          await importImage(replay.file, replay.regions);
          manga.log("ok", `export bundle · ${replay.content.sourceName} · visual regions restored`);
        } catch (reason) {
          manga.log(
            "error",
            `export bundle · ${file.name} · ${reason instanceof Error ? reason.message : String(reason)}`,
          );
        }
        continue;
      }
      const format = formatForMangaFile(file);
      if (format === "image") {
        await importImage(file, initialRegions);
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
    navigation.navigate("/manga", true);
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
        const file = await fileFromDocumentHandoff(runtime, handoff, parentServices?.artifacts);
        if (formatForMangaFile(file) === "unknown") {
          manga.log(
            "warn",
            `handoff · ${handoff.name} needs a page-image adapter before Manga Studio`,
          );
          return;
        }
        let initialRegions: ReadonlyArray<TextRegion> = [];
        try {
          initialRegions = await regionsFromDocumentHandoff(
            runtime,
            handoff,
            parentServices?.artifacts,
          );
        } catch (reason) {
          manga.log(
            "warn",
            `handoff · visual content ignored · ${reason instanceof Error ? reason.message : String(reason)}`,
          );
        }
        await importFiles([file], initialRegions);
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
  }, [fileFromDocumentHandoff, parentServices?.artifacts, importFiles, runtime]);

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
    void runtime?.pipeline.runMangaPipeline(hostServices ?? undefined, {
      resume: resumableCurrentPage,
    });
  };

  const exportPage = () => {
    setExporting(true);
    setNotice(null);
    void exportCurrentPage()
      .then(() => setNotice({ message: "图片已导出", tone: "success" }))
      .catch((reason: unknown) => {
        manga.log("error", `export · ${reason instanceof Error ? reason.message : String(reason)}`);
      })
      .finally(() => setExporting(false));
  };

  const handoffDocument = () => {
    if (runtime === null || documentHandoffBusy || state.running || batchRunning) return;
    const hostArtifacts = parentServices?.artifacts;
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
          <strong>正在打开漫画工作台</strong>
          <small>正在恢复本地项目</small>
        </span>
      </div>
    );
  }

  const toolsPanel = (
    <MangaToolsPanel
      state={state}
      selectedRegion={selectedRegion}
      modelCacheInfo={modelCacheInfo}
      modelRecords={modelRecords}
      modelActionKey={modelActionKey}
      online={online}
      runtimeReady
      translationResolution={translationResolution}
      ocrResolution={ocrResolution}
      cleanManifest={cleanManifest}
      cleanFallback={cleanResolution.fallbackReason !== undefined}
      glossarySource={glossarySource}
      glossaryTarget={glossaryTarget}
      exporting={exporting}
      onRefreshModelCache={refreshModelCache}
      onClearModelCache={clearModelCache}
      onPreloadModel={startModelPreload}
      onGlossarySourceChange={setGlossarySource}
      onGlossaryTargetChange={setGlossaryTarget}
      onAddGlossary={addGlossary}
      onAddRegion={addRegion}
      onExportPage={exportPage}
    />
  );

  return (
    <div className="manga-studio">
      <Toast notice={notice} onDismiss={() => setNotice(null)} />
      <MangaHeader
        state={state}
        fileInputRef={fileInputRef}
        mobileToolsOpen={mobileToolsOpen}
        batchRunning={batchRunning}
        batchPaused={batchPaused}
        batchError={batchError}
        documentHandoffBusy={documentHandoffBusy}
        pendingPages={pendingPages}
        resumableCurrentPage={resumableCurrentPage}
        onOpenTools={() => setMobileToolsOpen(true)}
        onOpenDiagnostics={() => setDiagnosticsOpen(true)}
        onImportFiles={(files) => void importFiles(files)}
        onHandoffDocument={handoffDocument}
        onCancelPage={() => runtime?.pipeline.cancelMangaPipeline()}
        onCancelQueue={() => runtime?.pipeline.cancelMangaQueue()}
        onRunPage={run}
        onRunQueue={() => void runtime?.pipeline.runMangaQueue(hostServices ?? undefined)}
      />

      <div className="manga-workspace">
        <MangaProjectPanel
          state={state}
          fileInputRef={fileInputRef}
          batchRunning={batchRunning}
          activePageIndex={activePageIndex}
          totalSize={totalSize}
          batchProgress={batchProgress}
          ocrResolution={ocrResolution}
          onImportFiles={(files) => void importFiles(files)}
        />
        <MangaCanvas state={state} />
        {!compactTools && toolsPanel}
      </div>

      <Drawer
        open={compactTools && mobileToolsOpen}
        title="翻译工具"
        closeLabel="关闭工具面板"
        onClose={() => setMobileToolsOpen(false)}
        className="manga-tools-drawer"
      >
        {compactTools && toolsPanel}
      </Drawer>
      <Dialog open={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} title="运行详情">
        <div className="manga-diagnostics">
          <p>本地存储 · Worker / WASM</p>
          {state.logs.map((entry, index) => (
            <p key={index} data-level={entry.level}>
              {entry.message}
            </p>
          ))}
        </div>
      </Dialog>
      <footer className="manga-footer">
        <span className="manga-footer-log">
          <StatusDot status={state.running ? "running" : "completed"} />
          {state.running
            ? "正在翻译"
            : state.stages.every((stage) => stage.status === "done")
              ? "翻译已完成"
              : state.source.kind === "fixture"
                ? "示例漫画"
                : "已准备好"}
        </span>
        {state.source.kind === "fixture" ? (
          <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
            导入漫画
          </Button>
        ) : (
          <Button variant="primary" disabled={state.running || exporting} onClick={exportPage}>
            导出图片
          </Button>
        )}
      </footer>
    </div>
  );
}
