import { useSyncExternalStore } from "react";
import type { Graph } from "@bcr/graph";
import { defaultGraph } from "./operations";
import { fixtureRegions, fixtureSource } from "./fixture";
import type {
  MangaLogEntry,
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
  cleanMode: "fill",
  fontSize: 1,
};

function freshStages(): ReadonlyArray<StageState> {
  return STAGES.map((stage, index) =>
    index === 0 ? stage : { ...stage, status: "idle", progress: 0 },
  );
}

class MangaStore {
  private state: MangaState = {
    source: fixtureSource,
    graph: defaultGraph(DEFAULT_SETTINGS),
    stages: freshStages(),
    regions: fixtureRegions,
    activeRegionId: fixtureRegions[0]?.id ?? null,
    outputMode: "translated",
    settings: DEFAULT_SETTINGS,
    running: false,
    outputReady: true,
    dirty: false,
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
    this.state = { ...this.state, ...partial };
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

  setGraph(graph: Graph): void {
    this.set({ graph, dirty: true });
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
      `pipeline · ${this.state.source.name} · ${this.state.settings.engine} adapter`,
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
}

export const manga = new MangaStore();

export function useMangaStudio<T>(selector: (state: MangaState) => T): T {
  return useSyncExternalStore(manga.subscribe, () => selector(manga.getSnapshot()));
}
