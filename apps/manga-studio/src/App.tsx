import {
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  FileImage,
  FileUp,
  Languages,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { cancelMangaPipeline, runMangaPipeline } from "./pipeline";
import {
  createMangaRuntime,
  importImageArtifact,
  persistProject,
  restoreProject,
  type MangaRuntime,
} from "./runtime";
import { manga, useMangaStudio } from "./store";
import type { MangaSource, OutputMode, TextRegion } from "./model";
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState(0.82);
  const [exporting, setExporting] = useState(false);
  const [runtime, setRuntime] = useState<MangaRuntime | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

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
  }, [runtime, state.pages, state.graph, state.settings]);

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
      const ref = await importImageArtifact(runtime, file);
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
        "OCR adapter not loaded · run creates a review region for manual correction",
      );
    } catch (reason) {
      URL.revokeObjectURL(objectUrl);
      manga.log("error", `import · ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  const importImages = async (files: ReadonlyArray<File>): Promise<void> => {
    for (const file of files) await importImage(file);
  };

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

  const run = () => {
    void runMangaPipeline();
  };

  const exportPage = () => {
    setExporting(true);
    void exportCurrentPage()
      .catch((reason: unknown) => {
        manga.log("error", `export · ${reason instanceof Error ? reason.message : String(reason)}`);
      })
      .finally(() => setExporting(false));
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
            disabled={state.running}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="size-4" />
            导入图片
          </button>
          {state.running ? (
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
              翻译当前页
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length > 0) void importImages(files);
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
                    disabled={state.running && page.id !== state.activePageId}
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
              disabled={state.running}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const files = Array.from(event.dataTransfer.files);
                if (files.length > 0) void importImages(files);
              }}
            >
              <Upload className="size-4" />
              <span>
                <strong>拖入更多页面</strong>
                <small>PNG / JPG / WEBP</small>
              </span>
            </button>
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
                <div key={stage.id} className={`manga-stage-row ${stageTone(stage.status)}`}>
                  <span className="manga-stage-icon">{statusIcon(stage.status)}</span>
                  <span className="manga-stage-copy">
                    <span className="manga-stage-label">{stage.label}</span>
                    <span className="manga-stage-detail">{stage.detail}</span>
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
                <strong>Fixture adapter</strong>
                <small>模型接口已预留 · 结果可审校</small>
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
                <select value="zh" disabled>
                  <option value="zh">简体中文</option>
                </select>
              </label>
            </div>
            <label className="manga-config-wide">
              <span>翻译引擎</span>
              <select
                value={state.settings.engine}
                onChange={(event) =>
                  manga.setSettings({ engine: event.target.value as "fixture" | "local" })
                }
              >
                <option value="fixture">Fixture / 离线演示</option>
                <option value="local">Local model / 待接入</option>
              </select>
            </label>
            <div className="manga-config-grid manga-typeset-controls">
              <label>
                <span>原文清理</span>
                <select
                  value={state.settings.cleanMode}
                  onChange={(event) =>
                    manga.setSettings({ cleanMode: event.target.value as "fill" | "inpaint" })
                  }
                >
                  <option value="fill">填充 / MVP</option>
                  <option value="inpaint">Inpaint / 待接入</option>
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
            <div className="manga-capability-row">
              <span className="manga-capability-pill">OCR</span>
              <span className="manga-capability-pill">GLOSSARY</span>
              <span className="manga-capability-pill manga-capability-muted">INPAINT · SOON</span>
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
              <RegionInspector region={selectedRegion} />
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

function RegionInspector({ region }: { region: TextRegion }) {
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
          value={region.sourceText}
          onChange={(event) => manga.patchRegion(region.id, { sourceText: event.target.value })}
          rows={2}
        />
      </label>
      <label>
        <span>译文 / 可直接编辑</span>
        <textarea
          value={region.translatedText}
          onChange={(event) => manga.patchRegion(region.id, { translatedText: event.target.value })}
          rows={2}
        />
      </label>
      <div className="manga-inspector-grid">
        <label>
          <span>阅读方向</span>
          <select
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
      <div className="manga-glossary-hit">
        <span className="manga-glossary-dot" />
        <span>Glossary 未命中 · 可在下一版加入术语表</span>
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
