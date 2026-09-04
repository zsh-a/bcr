import { ChevronDown, ListChecks, Upload, WandSparkles } from "lucide-react";
import type { RefObject } from "react";
import type { MangaOcrAdapterResolution, MangaState } from "./model";
import { manga } from "./store";
import {
  executionLabel,
  fallbackLabel,
  formatBytes,
  stageTone,
  statusIcon,
  statusLabel,
} from "./mangaPresentation";

interface MangaProjectPanelProps {
  readonly state: MangaState;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly batchRunning: boolean;
  readonly activePageIndex: number;
  readonly totalSize: number;
  readonly batchProgress: number;
  readonly ocrResolution: MangaOcrAdapterResolution;
  readonly onImportFiles: (files: ReadonlyArray<File>) => void;
}

export function MangaProjectPanel({
  state,
  fileInputRef,
  batchRunning,
  activePageIndex,
  totalSize,
  batchProgress,
  ocrResolution,
  onImportFiles,
}: MangaProjectPanelProps) {
  return (
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
            const completedStages = page.stages.filter((stage) => stage.status === "done").length;
            const pageStatus = page.outputReady
              ? "translated"
              : page.stages.some((stage) => stage.status === "running")
                ? "processing"
                : "needs review";
            return (
              <button
                type="button"
                key={page.id}
                className={`manga-page-card ${
                  page.id === state.activePageId ? "manga-page-card-active" : ""
                }`}
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
            if (files.length > 0) onImportFiles(files);
          }}
        >
          <Upload className="size-4" />
          <span>
            <strong>拖入更多页面</strong>
            <small>PNG / JPG / WEBP / CBZ / PDF / EXPORT JSON</small>
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
                  <span className="manga-stage-execution">{executionLabel(stage.execution)}</span>
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
              {ocrResolution.execution.requestedAdapter === ocrResolution.execution.effectiveAdapter
                ? ocrResolution.manifest.label
                : `${ocrResolution.execution.requestedAdapter} → ${ocrResolution.execution.effectiveAdapter}`}
            </strong>
            <small>{ocrResolution.effectiveManifest.detail}</small>
            {ocrResolution.execution.fallbackReason !== undefined && (
              <small className="manga-config-warning">
                {fallbackLabel(ocrResolution.execution.fallbackReason)}
              </small>
            )}
          </span>
        </div>
      </section>
    </aside>
  );
}
