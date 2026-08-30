import { useSyncExternalStore } from "react";
import type { ArtifactRef } from "@bcr/core";
import type { Graph, NodeRunState } from "@bcr/graph";
import { updateNodeConfig } from "@bcr/graph";
import { defaultGraph, withoutTranslate, withTranslate } from "./operations";
import type { MediaInfo, SubtitleCue } from "./subtitles";

/**
 * Subtitle Studio 应用状态（§12 状态分层：Runtime 事件投影 + 编辑态；不建巨型 store）。
 *
 * Pipeline DAG 是单一事实源：顶栏的模型/引擎/翻译开关只是对 graph 的快捷改写，
 * 自定义编排（Pipeline 编辑器）与一键生成都从同一份 graph 编译执行。
 */

export type EngineMode = "auto" | "whisper" | "demo";
export type TranslateDirection = "en-zh" | "zh-en";

export interface SourceState {
  readonly ref: ArtifactRef;
  readonly name: string;
  readonly size: number;
  /** 播放用对象 URL（导入文件或从 OPFS 恢复的 Blob）。 */
  readonly objectUrl: string | null;
}

export interface StudioSettings {
  readonly model: string;
  readonly engine: EngineMode;
  readonly translate: boolean;
  readonly direction: TranslateDirection;
}

export type StudioView = "subtitles" | "pipeline";

export interface AppState {
  readonly source: SourceState | null;
  readonly mediaInfo: MediaInfo | null;
  readonly peaks: Float32Array | null;
  /** Pipeline DAG：节点实例 + 边（跨素材保留，随项目持久化）。 */
  readonly graph: Graph;
  /** 任务事件流 → 图上节点的状态投影。 */
  readonly nodeStatus: Readonly<Record<string, NodeRunState>>;
  readonly view: StudioView;
  readonly selectedNode: string | null;
  readonly cues: ReadonlyArray<SubtitleCue>;
  /** 当前 cues 使用的识别引擎（whisper / demo）。 */
  readonly engineUsed: string | null;
  readonly settings: StudioSettings;
  readonly running: boolean;
  readonly dirty: boolean;
  readonly logs: ReadonlyArray<{
    ts: number;
    level: "info" | "ok" | "warn" | "error";
    message: string;
  }>;
}

const INITIAL_SETTINGS: StudioSettings = {
  model: "Xenova/whisper-tiny",
  engine: "auto",
  translate: false,
  direction: "en-zh",
};

const MAX_LOGS = 500;

function allPending(graph: Graph): Record<string, NodeRunState> {
  const status: Record<string, NodeRunState> = {};
  for (const node of graph.nodes) status[node.id] = { status: "pending", progress: 0 };
  return status;
}

class StudioStore {
  private state: AppState = {
    source: null,
    mediaInfo: null,
    peaks: null,
    graph: defaultGraph(INITIAL_SETTINGS),
    nodeStatus: {},
    view: "subtitles",
    selectedNode: null,
    cues: [],
    engineUsed: null,
    settings: INITIAL_SETTINGS,
    running: false,
    dirty: false,
    logs: [],
  };

  private readonly listeners = new Set<() => void>();

  getSnapshot = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  log(level: AppState["logs"][number]["level"], message: string): void {
    this.set({ logs: [...this.state.logs, { ts: Date.now(), level, message }].slice(-MAX_LOGS) });
  }

  setSource(source: SourceState | null): void {
    this.set({
      source,
      mediaInfo: null,
      peaks: null,
      cues: [],
      engineUsed: null,
      dirty: false,
      nodeStatus: {},
      // 图是用户资产，换素材不重置
      graph:
        this.state.graph.nodes.length > 0 ? this.state.graph : defaultGraph(this.state.settings),
    });
  }

  /** 顶栏快捷设置 → 同步改写 graph（模型/引擎落到节点 config，翻译开关增删节点）。 */
  setSettings(partial: Partial<StudioSettings>): void {
    const settings = { ...this.state.settings, ...partial };
    let graph = this.state.graph;
    if (partial.model !== undefined) {
      for (const node of graph.nodes) {
        if ("model" in node.config)
          graph = updateNodeConfig(graph, node.id, { model: settings.model });
      }
    }
    if (partial.engine !== undefined) {
      for (const node of graph.nodes) {
        if ("engine" in node.config)
          graph = updateNodeConfig(graph, node.id, { engine: settings.engine });
      }
    }
    if (partial.direction !== undefined) {
      for (const node of graph.nodes) {
        if ("direction" in node.config)
          graph = updateNodeConfig(graph, node.id, { direction: settings.direction });
      }
    }
    if (partial.translate !== undefined) {
      graph = settings.translate ? withTranslate(graph, settings) : withoutTranslate(graph);
    }
    this.set({ settings, graph });
  }

  setGraph(graph: Graph): void {
    this.set({ graph });
  }

  setView(view: StudioView): void {
    this.set({ view });
  }

  setSelectedNode(selectedNode: string | null): void {
    this.set({ selectedNode });
  }

  setMediaInfo(mediaInfo: MediaInfo | null): void {
    this.set({ mediaInfo });
  }

  setPeaks(peaks: Float32Array | null): void {
    this.set({ peaks });
  }

  resetRun(): void {
    this.set({ nodeStatus: allPending(this.state.graph), running: true });
  }

  patchNodeStatus(id: string, patch: Partial<NodeRunState>): void {
    const current = this.state.nodeStatus[id] ?? { status: "pending" as const, progress: 0 };
    this.set({ nodeStatus: { ...this.state.nodeStatus, [id]: { ...current, ...patch } } });
  }

  setRunning(running: boolean): void {
    this.set({ running });
  }

  setCues(cues: ReadonlyArray<SubtitleCue>, engineUsed: string | null): void {
    this.set({ cues, engineUsed, dirty: false });
  }

  patchCue(index: number, patch: Partial<SubtitleCue>): void {
    this.set({
      cues: this.state.cues.map((cue, i) => (i === index ? { ...cue, ...patch } : cue)),
      dirty: true,
    });
  }

  deleteCue(index: number): void {
    this.set({ cues: this.state.cues.filter((_, i) => i !== index), dirty: true });
  }

  splitCue(index: number, atRatio: number): void {
    const cue = this.state.cues[index];
    if (cue === undefined) return;
    const mid = cue.start + (cue.end - cue.start) * atRatio;
    const chars = Math.max(1, Math.round(cue.text.length * atRatio));
    this.set({
      cues: [
        ...this.state.cues.slice(0, index),
        { ...cue, end: mid, text: cue.text.slice(0, chars) },
        { start: mid, end: cue.end, text: cue.text.slice(chars), translation: cue.translation },
      ],
      dirty: true,
    });
  }
}

export const studio = new StudioStore();

export function useStudio<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(studio.subscribe, () => selector(studio.getSnapshot()));
}
