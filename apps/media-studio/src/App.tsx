import { useEffect, useRef, useState } from "react";
import { RuntimeProvider, useRuntime, type RuntimeServices } from "@bcr/react";
// 样式随模块加载：Shell 懒加载本组件时 CSS 一并注入（standalone main.tsx 的重复 import 幂等）。
import "./styles.css";
import { createRuntimeServices } from "./runtime";
import { cancelGeneration, generateSubtitles, persistProject, restoreProject } from "./pipeline";
import { clearProject, importSource } from "./source";
import { studio, useStudio } from "./store";
import { CueEditor, UndoRedo } from "./components/CueEditor";
import { PipelineEditor } from "./components/PipelineEditor";
import { PipelinePanel } from "./components/PipelinePanel";
import { Waveform } from "./components/Waveform";
import { exportSubtitles, FORMAT_MIME, type SubtitleFormat } from "./exporters";

export function App() {
  const [services, setServices] = useState<RuntimeServices | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void createRuntimeServices().then((runtime) => {
      setServices(runtime);
      void restoreProject(runtime);
    }, setError);
  }, []);

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
  const services = useRuntime();
  const source = useStudio((state) => state.source);
  const mediaInfo = useStudio((state) => state.mediaInfo);
  const settings = useStudio((state) => state.settings);
  const running = useStudio((state) => state.running);
  const cues = useStudio((state) => state.cues);
  const engineUsed = useStudio((state) => state.engineUsed);
  const logs = useStudio((state) => state.logs);
  const view = useStudio((state) => state.view);
  const graph = useStudio((state) => state.graph);
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
        <span className="font-mono text-[13px] font-semibold">
          BCR / Media Studio <span className="text-[var(--color-faint)]">· subtitle</span>
        </span>
        <span className="ml-2 flex items-center gap-2 text-[10px] text-[var(--color-faint)]">
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
        <span className="ml-auto flex items-center gap-2">
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

      <div className="flex min-h-0 flex-1">
        {/* 左栏 */}
        <aside className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-[var(--color-border)] p-3">
          <section>
            <div className="mb-1.5 text-[10px] tracking-wider text-[var(--color-faint)]">
              SOURCE
            </div>
            <div
              data-testid="dropzone"
              className="flex cursor-pointer flex-col items-center gap-1 rounded border border-dashed border-[var(--color-border-strong)] px-3 py-5 text-center hover:border-[var(--color-accent)]"
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
                  <div className="font-mono text-[11px]">{source.name}</div>
                  <div className="text-[10px] text-[var(--color-faint)]">
                    {(source.size / 1024 / 1024).toFixed(1)} MB · opfs
                    {mediaInfo !== null && ` · ${mediaInfo.durationS.toFixed(1)}s · 16kHz mono`}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[11px]">拖入 音频 / 视频文件</div>
                  <div className="text-[10px] text-[var(--color-faint)]">
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
                onClick={() => void clearProject()}
              >
                清空项目
              </button>
            )}
          </section>

          <section>
            <div className="mb-1.5 flex items-center text-[10px] tracking-wider text-[var(--color-faint)]">
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
            <div className="mb-1.5 text-[10px] tracking-wider text-[var(--color-faint)]">
              CONSOLE
            </div>
            <div className="h-40 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 font-mono text-[10px] leading-relaxed">
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
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3 pt-2">
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
                className={`-mb-px border-b px-2.5 pb-1.5 text-[11px] transition-colors ${
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
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              {source?.objectUrl != null && (
                <video
                  ref={videoRef}
                  src={source.objectUrl}
                  controls
                  className="max-h-48 self-start rounded border border-[var(--color-border)] bg-black"
                />
              )}
              <Waveform videoRef={videoRef} onSeek={seek} />
              <CueEditor onSeek={seek} getTime={() => videoRef.current?.currentTime ?? 0} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
