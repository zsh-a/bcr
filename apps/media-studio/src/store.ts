import { useSyncExternalStore } from "react";
import type { ArtifactRef } from "@bcr/core";
import type { MediaInfo, SubtitleCue } from "./subtitles";

/**
 * Subtitle Studio 应用状态（§12 状态分层：Runtime 事件投影 + 编辑态；不建巨型 store）。
 */

export type NodeStatus = "pending" | "running" | "done" | "failed" | "cached";

export interface PipelineNodeState {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  status: NodeStatus;
  progress: number;
  error?: string | undefined;
}

export type EngineMode = "auto" | "whisper" | "demo";

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
}

export interface AppState {
  readonly source: SourceState | null;
  readonly mediaInfo: MediaInfo | null;
  readonly peaks: Float32Array | null;
  readonly nodes: ReadonlyArray<PipelineNodeState>;
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

const NODE_DEFS: ReadonlyArray<{ id: string; label: string; detail: string }> = [
  { id: "decode", label: "Decode", detail: "解码 → 16kHz 单声道 PCM" },
  { id: "wave", label: "Waveform", detail: "RMS/峰值包络（WASM）" },
  { id: "asr", label: "ASR", detail: "Whisper 语音识别" },
  { id: "segment", label: "Segment", detail: "字幕分段规范化" },
  { id: "translate", label: "Translate", detail: "Whisper translate → 双语" },
];

const MAX_LOGS = 500;

class StudioStore {
  private state: AppState = {
    source: null,
    mediaInfo: null,
    peaks: null,
    nodes: NODE_DEFS.map((def) => ({ ...def, status: "pending", progress: 0 })),
    cues: [],
    engineUsed: null,
    settings: { model: "Xenova/whisper-tiny", engine: "auto", translate: false },
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
      nodes: NODE_DEFS.map((def) => ({ ...def, status: "pending", progress: 0 })),
    });
  }

  setSettings(partial: Partial<StudioSettings>): void {
    this.set({ settings: { ...this.state.settings, ...partial } });
  }

  setMediaInfo(mediaInfo: MediaInfo | null): void {
    this.set({ mediaInfo });
  }

  setPeaks(peaks: Float32Array | null): void {
    this.set({ peaks });
  }

  resetNodes(): void {
    this.set({
      nodes: NODE_DEFS.map((def) =>
        def.id === "translate" && !this.state.settings.translate
          ? { ...def, status: "pending" as const, progress: 0, detail: "未启用" }
          : { ...def, status: "pending" as const, progress: 0 },
      ),
      running: true,
    });
  }

  patchNode(id: string, patch: Partial<PipelineNodeState>): void {
    this.set({
      nodes: this.state.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    });
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
