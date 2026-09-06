import {
  RUNTIME_NAVIGATION_EVENT,
  RuntimeProvider,
  useLocationSearch,
  usePublishRunningCount,
  useRuntime,
  useRuntimeSession,
} from "@bcr/react";
import { useEffect, useRef, useState } from "react";
import { mediaCitationTarget } from "./mediaSearchDocuments";
import { useMediaSearch } from "./search";
// 样式随模块加载：Shell 懒加载本组件时 CSS 一并注入（standalone main.tsx 的重复 import 幂等）。
import { CueEditor, UndoRedo } from "./components/CueEditor";
import { PipelineEditor } from "./components/PipelineEditor";
import { PipelinePanel } from "./components/PipelinePanel";
import { Waveform } from "./components/Waveform";
import { exportSubtitles, FORMAT_MIME, type SubtitleFormat } from "./exporters";
import { cancelGeneration, generateSubtitles, persistProject, restoreProject } from "./pipeline";
import { createRuntimeServices } from "./runtime";
import { clearProject, importSource } from "./source";
import { studio, useStudio } from "./store";
import "./styles.css";

export function App() {
  const { services, error } = useRuntimeSession(createRuntimeServices, restoreProject);

  if (error !== null) {
    return <div className="p-8 text-[var(--color-danger)]">Runtime 启动失败：{error}</div>;
  }
  if (services === null) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-muted)]">
        正在组装 Compute Runtime…
      </div>
    );
  }
  return (
    <RuntimeProvider services={services}>
      <Studio />
    </RuntimeProvider>
  );
}

function Studio() {
  useMediaSearch();
  const services = useRuntime();
  const source = useStudio((state) => state.source);
  const mediaInfo = useStudio((state) => state.mediaInfo);
  const settings = useStudio((state) => state.settings);
  const running = useStudio((state) => state.running);
  usePublishRunningCount("media", running ? 1 : 0);
  const cues = useStudio((state) => state.cues);
  const engineUsed = useStudio((state) => state.engineUsed);
  const logs = useStudio((state) => state.logs);
  const view = useStudio((state) => state.view);
  const graph = useStudio((state) => state.graph);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const locationSearch = useLocationSearch();
  const [citationError, setCitationError] = useState("");
  const [citationSelection, setCitationSelection] = useState<
    { index: number; quote: string; sequence: number } | undefined
  >();
  const seekedCitationRef = useRef("");
  const [citationNavigation, setCitationNavigation] = useState(0);
  useEffect(() => {
    const navigate = () => setCitationNavigation((value) => value + 1);
    window.addEventListener(RUNTIME_NAVIGATION_EVENT, navigate);
    return () => window.removeEventListener(RUNTIME_NAVIGATION_EVENT, navigate);
  }, []);
  useEffect(() => {
    if (window.location.pathname !== "/media") return;
    const target = mediaCitationTarget(locationSearch, source?.ref.id, cues);
    setCitationError(
      target.error ?? (target.relocated ? "字幕已变化，已根据保存的原文重新定位。" : ""),
    );
    setCitationSelection(
      target.cueIndex === undefined
        ? undefined
        : { index: target.cueIndex, quote: target.quote ?? "", sequence: citationNavigation },
    );
    const video = videoRef.current;
    if (target.time === undefined || !video) return;
    const seekKey = `${locationSearch}|${source?.ref.id}|${citationNavigation}|${target.cueIndex}|${target.time}`;
    if (seekedCitationRef.current === seekKey) return;
    const seekToCitation = () => {
      if (Number.isFinite(video.duration) && target.time! > video.duration) {
        setCitationError("引用时间超出当前媒体长度");
        return;
      }
      video.currentTime = target.time!;
      seekedCitationRef.current = seekKey;
    };
    if (video.readyState >= 1) seekToCitation();
    else video.addEventListener("loadedmetadata", seekToCitation, { once: true });
    return () => video.removeEventListener("loadedmetadata", seekToCitation);
  }, [locationSearch, source?.ref.id, source?.objectUrl, citationNavigation, cues]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 字幕编辑自动持久化（800ms 防抖；仅在用户改动过时写）
  const cuesRef = useRef(cues);
  cuesRef.current = cues;
  useEffect(() => {
    if (!studio.getSnapshot().dirty) return;
    const timer = window.setTimeout(() => void persistProject(services), 800);
    return () => window.clearTimeout(timer);
  }, [cues, services]);

  // 流水线图改动自动持久化（800ms 防抖，拖动节点时合并写入）
  useEffect(() => {
    const timer = window.setTimeout(() => void persistProject(services), 800);
    return () => window.clearTimeout(timer);
  }, [graph, services]);

  // 编辑快捷键：Ctrl/Cmd+Z 撤销，Shift（或 Ctrl+Y）重做——输入框聚焦时同样生效
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        studio.undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        studio.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const generate = () => {
    void generateSubtitles(services);
  };

  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (video !== null) video.currentTime = seconds;
  };

  const download = (format: SubtitleFormat) => {
    const baseName = source?.name.replace(/\.[^.]+$/, "") ?? "subtitles";
    // ASS：任一 cue 带词级时间戳时自动启用卡拉 OK 标签
    const karaoke = cues.some((cue) => cue.words !== undefined && cue.words.length > 0);
    const content = exportSubtitles(cues, format, source?.name, { karaoke });
    const blob = new Blob([content], { type: FORMAT_MIME[format] });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${baseName}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
    studio.log(
      "ok",
      `export · ${format.toUpperCase()} · ${cues.length} cues${karaoke ? " · karaoke" : ""}`,
    );
  };

  return (
    <div className="media-studio flex h-full flex-col">
      {citationError && (
        <p
          role="alert"
          className="border-b border-[var(--color-border)] p-3 text-[var(--color-danger)]"
        >
          {citationError}
        </p>
      )}
      {/* 顶栏 */}
      <header className="media-header flex items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
        <span className="media-brand font-mono text-[16px] font-semibold">
          BCR / Media Studio <span className="text-[var(--color-faint)]">· subtitle</span>
        </span>
        <span className="media-settings ml-2 flex items-center gap-2 text-[11px] text-[var(--color-faint)]">
          <select
            value={settings.model}
            onChange={(event) => studio.setSettings({ model: event.target.value })}
            title="Whisper 模型（参与缓存键）"
          >
            <option value="Xenova/whisper-tiny">whisper-tiny</option>
            <option value="Xenova/whisper-base">whisper-base</option>
          </select>
          <select
            value={settings.engine}
            onChange={(event) =>
              studio.setSettings({ engine: event.target.value as typeof settings.engine })
            }
            title="识别引擎"
          >
            <option value="auto">引擎：自动回退</option>
            <option value="whisper">引擎：仅 Whisper</option>
            <option value="demo">引擎：演示</option>
          </select>
          <select
            value={settings.language}
            onChange={(event) => studio.setSettings({ language: event.target.value })}
            title="音频语言（Whisper 不做自动检测，未指定按英语转写）"
          >
            <option value="auto">语言：未指定(en)</option>
            <option value="zh">语言：中文</option>
            <option value="en">语言：English</option>
            <option value="ja">语言：日本語</option>
            <option value="ko">语言：한국어</option>
            <option value="de">语言：Deutsch</option>
            <option value="fr">语言：Français</option>
            <option value="es">语言：Español</option>
            <option value="ru">语言：Русский</option>
          </select>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={settings.translate}
              onChange={(event) => studio.setSettings({ translate: event.target.checked })}
            />
            双语翻译
          </label>
          {settings.translate && (
            <select
              value={settings.direction}
              onChange={(event) =>
                studio.setSettings({
                  direction: event.target.value as typeof settings.direction,
                })
              }
              title="opus-mt 翻译方向"
            >
              <option value="en-zh">英→中</option>
              <option value="zh-en">中→英</option>
            </select>
          )}
        </span>
        <span className="media-actions ml-auto flex items-center gap-2">
          <UndoRedo />
          {engineUsed !== null && (
            <span className="rounded border border-[var(--color-border-strong)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted)]">
              {engineUsed}
            </span>
          )}
          {(["srt", "vtt", "ass"] as const).map((format) => (
            <button
              key={format}
              className="btn font-mono"
              disabled={cues.length === 0}
              onClick={() => download(format)}
            >
              {format.toUpperCase()}
            </button>
          ))}
          {running ? (
            <button
              className="btn text-[var(--color-danger)]"
              onClick={() => void cancelGeneration()}
            >
              取消
            </button>
          ) : (
            <button className="btn btn-primary" disabled={source === null} onClick={generate}>
              生成字幕
            </button>
          )}
        </span>
      </header>

      <div className="media-layout flex min-h-0 flex-1">
        {/* 左栏 */}
        <aside className="media-sidebar flex w-[340px] shrink-0 flex-col gap-6 overflow-y-auto border-r border-[var(--color-border)] p-5">
          <section>
            <div className="mb-3 text-[11px] tracking-wider text-[var(--color-faint)]">SOURCE</div>
            <div
              data-testid="dropzone"
              className="media-dropzone flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] px-5 py-6 text-center hover:border-[var(--color-accent)]"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file !== undefined) void importSource(services, file);
              }}
            >
              {source !== null ? (
                <>
                  <div className="font-mono text-[13px]">{source.name}</div>
                  <div className="text-[11px] text-[var(--color-faint)]">
                    {(source.size / 1024 / 1024).toFixed(1)} MB · opfs
                    {mediaInfo !== null && ` · ${mediaInfo.durationS.toFixed(1)}s · 16kHz mono`}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[13px]">拖入 音频 / 视频文件</div>
                  <div className="text-[11px] text-[var(--color-faint)]">
                    wav / mp3 / m4a / mp4 / webm
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void importSource(services, file);
              }}
            />
            {source !== null && (
              <button
                className="btn mt-2 w-full justify-center text-[10px]"
                onClick={() => void clearProject(services)}
              >
                清空项目
              </button>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center text-[11px] tracking-wider text-[var(--color-faint)]">
              PIPELINE · DAG
              <button
                type="button"
                className="ml-auto normal-case tracking-normal hover:text-[var(--color-accent)]"
                onClick={() => studio.setView("pipeline")}
              >
                自定义编排 →
              </button>
            </div>
            <PipelinePanel />
          </section>

          <section>
            <div className="mb-3 text-[11px] tracking-wider text-[var(--color-faint)]">CONSOLE</div>
            <div className="h-48 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-[11px] leading-relaxed">
              {logs.map((entry, index) => (
                <div
                  key={index}
                  className={
                    entry.level === "error"
                      ? "text-[var(--color-danger)]"
                      : entry.level === "ok"
                        ? "text-[var(--color-accent)]"
                        : entry.level === "warn"
                          ? "text-[var(--color-amber)]"
                          : "text-[var(--color-muted)]"
                  }
                >
                  {entry.message}
                </div>
              ))}
            </div>
          </section>
        </aside>

        {/* 右侧：字幕 / 流水线 DAG 页签 */}
        <main className="media-main flex min-w-0 flex-1 flex-col">
          <div className="media-tabs flex items-center gap-2 border-b border-[var(--color-border)] px-5 pt-3">
            {(
              [
                ["subtitles", "字幕"],
                ["pipeline", "流水线 DAG"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-testid={`tab-${id}`}
                onClick={() => studio.setView(id)}
                className={`-mb-px min-h-11 border-b px-4 pb-2 text-[12px] transition-colors ${
                  view === id
                    ? "border-[var(--color-accent)] text-[var(--color-text)]"
                    : "border-transparent text-[var(--color-faint)] hover:text-[var(--color-muted)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {view === "pipeline" ? (
            <PipelineEditor />
          ) : (
            <div className="media-content flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
              {source?.objectUrl != null && (
                <video
                  ref={videoRef}
                  src={source.objectUrl}
                  controls
                  className="max-h-48 self-start rounded border border-[var(--color-border)] bg-black"
                />
              )}
              <Waveform videoRef={videoRef} onSeek={seek} />
              <CueEditor
                onSeek={seek}
                getTime={() => videoRef.current?.currentTime ?? 0}
                citation={citationSelection}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
