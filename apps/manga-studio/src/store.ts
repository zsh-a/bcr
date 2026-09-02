import { useSyncExternalStore } from "react";
import type { Graph } from "@bcr/graph";
import { defaultGraph } from "./operations";
import { fixtureRegions, fixtureSource } from "./fixture";
import type {
  MangaLogEntry,
  MangaBatchJob,
  MangaBatchStatus,
  MangaPage,
  MangaSettings,
  MangaSource,
  MangaStageId,
  MangaState,
  OutputMode,
  StageState,
  TextRegion,
} from "./model";

export const STAGES: ReadonlyArray<StageState> = [
  { id: "import", label: "Import", detail: "建立页面清单", status: "done", progress: 1 },
  { id: "normalize", label: "Normalize", detail: "图像标准化", status: "idle", progress: 0 },
  { id: "detect", label: "Detect", detail: "寻找文字区域", status: "idle", progress: 0 },
  { id: "ocr", label: "OCR", detail: "识别文字与方向", status: "idle", progress: 0 },
  { id: "reading-order", label: "Order", detail: "建立阅读顺序", status: "idle", progress: 0 },
  { id: "translate", label: "Translate", detail: "生成中文译文", status: "idle", progress: 0 },
  { id: "remove-text", label: "Clean", detail: "擦除原文", status: "idle", progress: 0 },
  { id: "typeset", label: "Typeset", detail: "译文排版", status: "idle", progress: 0 },
  { id: "export", label: "Export", detail: "准备 PNG 输出", status: "idle", progress: 0 },
];

export const DEFAULT_SETTINGS: MangaSettings = {
  sourceLanguage: "ja",
  targetLanguage: "zh",
  engine: "fixture",
  ocrAdapter: "review.manual",
  ocrModel: "Xenova/trocr-small-printed",
  ocrDevice: "auto",
  cleanMode: "fill",
  fontSize: 1,
};

function freshStages(): ReadonlyArray<StageState> {
  return STAGES.map((stage, index) =>
    index === 0 ? stage : { ...stage, status: "idle", progress: 0 },
  );
}

const initialPage: MangaPage = {
  id: fixtureSource.id,
  source: fixtureSource,
  stages: freshStages(),
  regions: fixtureRegions,
  activeRegionId: fixtureRegions[0]?.id ?? null,
  outputMode: "translated",
  outputReady: true,
  dirty: false,
};

class MangaStore {
  private state: MangaState = {
    source: initialPage.source,
    pages: [initialPage],
    activePageId: initialPage.id,
    graph: defaultGraph(DEFAULT_SETTINGS),
    stages: initialPage.stages,
    regions: initialPage.regions,
    activeRegionId: initialPage.activeRegionId,
    outputMode: initialPage.outputMode,
    settings: DEFAULT_SETTINGS,
    running: false,
    outputReady: initialPage.outputReady,
    dirty: initialPage.dirty,
    batch: undefined,
    logs: [
      {
        ts: Date.now(),
        level: "info",
        message: "fixture page ready · OCR/translation adapter is explicit offline demo",
      },
    ],
  };

  private readonly listeners = new Set<() => void>();

  getSnapshot = (): MangaState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(partial: Partial<MangaState>): void {
    let next: MangaState = { ...this.state, ...partial };
    // Keep the active page as the durable source of page-level state.  Calls
    // that replace `pages` already provide a complete page snapshot and skip
    // this projection to avoid writing the previous page into the new slot.
    const projectsPage =
      "source" in partial ||
      "stages" in partial ||
      "regions" in partial ||
      "activeRegionId" in partial ||
      "outputMode" in partial ||
      "outputReady" in partial ||
      "dirty" in partial ||
      "activePageId" in partial;
    if (!("pages" in partial) && projectsPage) {
      const index = next.pages.findIndex((page) => page.id === next.activePageId);
      const current = next.pages[index];
      if (current !== undefined) {
        const page: MangaPage = {
          ...current,
          source: next.source,
          stages: next.stages,
          regions: next.regions,
          activeRegionId: next.activeRegionId,
          outputMode: next.outputMode,
          outputReady: next.outputReady,
          dirty: next.dirty,
        };
        const pages = [...next.pages];
        pages[index] = page;
        next = { ...next, pages };
      }
    }
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  log(level: MangaLogEntry["level"], message: string): void {
    this.set({ logs: [...this.state.logs, { ts: Date.now(), level, message }].slice(-80) });
  }

  setSource(source: MangaSource, regions: ReadonlyArray<TextRegion>): void {
    const previousSource = this.state.source;
    if (previousSource.kind === "image" && previousSource.objectUrl !== source.objectUrl) {
      URL.revokeObjectURL(previousSource.objectUrl);
    }
    this.set({
      source,
      regions,
      activeRegionId: regions[0]?.id ?? null,
      stages: freshStages(),
      outputReady: source.kind === "fixture",
      outputMode: source.kind === "fixture" ? "translated" : "original",
      dirty: false,
    });
    this.log("info", `source · ${source.name} · ${source.width}×${source.height}`);
  }

  addPage(page: MangaPage, activate = true): void {
    if (this.state.pages.some((candidate) => candidate.id === page.id)) {
      this.log("warn", `page · ${page.source.name} already in queue`);
      return;
    }
    const pages = [...this.state.pages, page];
    if (!activate) {
      this.set({ pages });
      return;
    }
    this.set({
      pages,
      activePageId: page.id,
      source: page.source,
      stages: page.stages,
      regions: page.regions,
      activeRegionId: page.activeRegionId,
      outputMode: page.outputMode,
      outputReady: page.outputReady,
      dirty: page.dirty,
    });
    this.log("info", `page queue · ${pages.length} page(s)`);
  }

  addSource(source: MangaSource, regions: ReadonlyArray<TextRegion>): void {
    const page: MangaPage = {
      id: source.id,
      source,
      stages: freshStages(),
      regions,
      activeRegionId: regions[0]?.id ?? null,
      outputMode: "original",
      outputReady: false,
      dirty: false,
    };
    // The built-in fixture is a launch affordance, not a user page.  Replace
    // it on the first import so a real project starts with a clean queue.
    if (this.state.pages.length === 1 && this.state.pages[0]?.source.kind === "fixture") {
      this.setPages([page], page.id);
      this.log("info", `source · ${source.name} · replaced demo page`);
      return;
    }
    this.addPage(page, true);
  }

  selectPage(pageId: string): void {
    const page = this.state.pages.find((candidate) => candidate.id === pageId);
    if (page === undefined || page.id === this.state.activePageId) return;
    this.set({
      activePageId: page.id,
      source: page.source,
      stages: page.stages,
      regions: page.regions,
      activeRegionId: page.activeRegionId,
      outputMode: page.outputMode,
      outputReady: page.outputReady,
      dirty: page.dirty,
    });
    this.log("info", `page · ${page.source.name} · selected`);
  }

  removePage(pageId: string): void {
    if (this.state.pages.length <= 1) {
      this.log("warn", "page queue · at least one page is required");
      return;
    }
    const removed = this.state.pages.find((page) => page.id === pageId);
    const removedIndex = this.state.pages.findIndex((page) => page.id === pageId);
    const pages = this.state.pages.filter((page) => page.id !== pageId);
    if (pages.length === this.state.pages.length) return;
    if (removed?.source.kind === "image") URL.revokeObjectURL(removed.source.objectUrl);
    if (pageId !== this.state.activePageId) {
      this.set({ pages });
      return;
    }
    const page = pages[Math.min(Math.max(removedIndex, 0), pages.length - 1)] ?? pages[0];
    if (page === undefined) return;
    this.set({
      pages,
      activePageId: page.id,
      source: page.source,
      stages: page.stages,
      regions: page.regions,
      activeRegionId: page.activeRegionId,
      outputMode: page.outputMode,
      outputReady: page.outputReady,
      dirty: page.dirty,
    });
    this.log("info", `page queue · removed · ${page.source.name}`);
  }

  setPages(pages: ReadonlyArray<MangaPage>, activePageId?: string): void {
    const nextPages = pages.length > 0 ? pages : [initialPage];
    const active =
      nextPages.find((page) => page.id === activePageId) ?? nextPages[0] ?? initialPage;
    this.set({
      pages: nextPages,
      activePageId: active.id,
      source: active.source,
      stages: active.stages,
      regions: active.regions,
      activeRegionId: active.activeRegionId,
      outputMode: active.outputMode,
      outputReady: active.outputReady,
      dirty: active.dirty,
    });
  }

  setGraph(graph: Graph): void {
    this.set({ graph, dirty: true });
  }

  /** Restore project configuration without turning hydration into an edit. */
  restoreConfig(settings: MangaSettings, graph: Graph): void {
    this.set({ settings: { ...DEFAULT_SETTINGS, ...settings }, graph });
  }

  setSettings(patch: Partial<MangaSettings>): void {
    const settings = { ...this.state.settings, ...patch };
    this.set({ settings, graph: defaultGraph(settings), dirty: true });
  }

  setOutputMode(outputMode: OutputMode): void {
    this.set({ outputMode });
  }

  setActiveRegion(activeRegionId: string | null): void {
    this.set({ activeRegionId });
  }

  patchRegion(id: string, patch: Partial<TextRegion>): void {
    this.set({
      regions: this.state.regions.map((region) =>
        region.id === id ? { ...region, ...patch, status: "reviewed" } : region,
      ),
      dirty: true,
      outputReady: false,
    });
  }

  /** Pipeline output does not create an edit history entry or mark the project dirty. */
  setRegionsForPipeline(regions: ReadonlyArray<TextRegion>): void {
    this.set({ regions, activeRegionId: regions[0]?.id ?? null });
  }

  addRegion(region: TextRegion): void {
    this.set({
      regions: [...this.state.regions, region],
      activeRegionId: region.id,
      dirty: true,
      outputReady: false,
    });
    this.log("info", `${region.label.toLowerCase()} · manual region added`);
  }

  removeRegion(id: string): void {
    const regions = this.state.regions.filter((region) => region.id !== id);
    this.set({
      regions,
      activeRegionId: regions[0]?.id ?? null,
      dirty: true,
      outputReady: false,
    });
  }

  beginRun(): void {
    this.set({ running: true, stages: freshStages(), outputReady: false });
    this.log(
      "info",
      `pipeline · ${this.state.source.name} · OCR ${this.state.settings.ocrAdapter} · translate ${this.state.settings.engine}`,
    );
  }

  updateStage(id: MangaStageId, patch: Partial<StageState>): void {
    this.set({
      stages: this.state.stages.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)),
    });
  }

  finishRun(): void {
    this.set({ running: false, outputReady: true, outputMode: "translated", dirty: false });
    this.log("ok", `pipeline complete · ${this.state.regions.length} text regions · output ready`);
  }

  cancelRun(): void {
    this.set({ running: false });
    this.log("warn", "pipeline cancelled · completed artifacts remain available");
  }

  failRun(message: string): void {
    this.set({ running: false });
    this.log("error", `pipeline failed · ${message}`);
  }

  startBatch(pageIds: ReadonlyArray<string>, resume = false): void {
    const current = this.state.batch;
    const validIds = [...new Set(pageIds)];
    const completedPageIds =
      resume && current?.status === "paused"
        ? current.completedPageIds.filter((id) => validIds.includes(id))
        : [];
    const now = Date.now();
    const batch: MangaBatchJob = {
      id: resume && current?.status === "paused" ? current.id : `manga-batch-${now.toString(36)}`,
      pageIds: validIds,
      completedPageIds,
      activePageId: null,
      status: "running",
      startedAt: resume && current?.status === "paused" ? current.startedAt : now,
      updatedAt: now,
    };
    this.set({ batch });
    this.log(
      "info",
      `batch · ${completedPageIds.length}/${validIds.length} page(s) · ${resume ? "resumed" : "queued"}`,
    );
  }

  setBatchActivePage(activePageId: string): void {
    const batch = this.state.batch;
    if (batch === undefined || batch.status !== "running") return;
    this.set({ batch: { ...batch, activePageId, updatedAt: Date.now() } });
  }

  completeBatchPage(pageId: string): void {
    const batch = this.state.batch;
    if (batch === undefined) return;
    const completedPageIds = batch.completedPageIds.includes(pageId)
      ? batch.completedPageIds
      : [...batch.completedPageIds, pageId];
    this.set({
      batch: {
        ...batch,
        completedPageIds,
        activePageId: null,
        updatedAt: Date.now(),
      },
    });
  }

  finishBatch(): void {
    const batch = this.state.batch;
    if (batch === undefined) return;
    this.set({
      batch: { ...batch, activePageId: null, status: "completed", updatedAt: Date.now() },
    });
    this.log("ok", `batch · ${batch.pageIds.length} page(s) · complete`);
  }

  pauseBatch(): void {
    const batch = this.state.batch;
    if (batch === undefined || batch.status !== "running") return;
    this.set({
      batch: { ...batch, status: "paused", updatedAt: Date.now() },
    });
    this.log(
      "warn",
      `batch · paused · ${batch.completedPageIds.length}/${batch.pageIds.length} page(s) complete`,
    );
  }

  failBatch(message: string): void {
    const batch = this.state.batch;
    if (batch === undefined) return;
    this.set({
      batch: { ...batch, status: "error", updatedAt: Date.now(), error: message },
    });
    this.log("error", `batch · failed · ${message}`);
  }

  restoreBatch(batch: MangaBatchJob | undefined): void {
    if (batch === undefined) {
      this.set({ batch: undefined });
      return;
    }
    const status: MangaBatchStatus = batch.status === "running" ? "paused" : batch.status;
    this.set({
      batch: {
        ...batch,
        status,
        updatedAt: Date.now(),
        ...(batch.status === "running" && batch.error === undefined
          ? { error: "刷新后队列已暂停，可继续处理" }
          : {}),
      },
    });
  }
}

export const manga = new MangaStore();

export function useMangaStudio<T>(selector: (state: MangaState) => T): T {
  return useSyncExternalStore(manga.subscribe, () => selector(manga.getSnapshot()));
}
