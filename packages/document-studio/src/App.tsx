import { ActionMenu, Drawer, Toast, AppToolbar, useMediaQuery } from "@bcr/react";
import { ArrowUpRight, BookOpen, Download, Files, ImagePlus, Sparkles, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { StatusDot, useRuntime, useLocationSearch } from "@bcr/react";
import {
  createDocumentJob,
  documentOcrSettings,
  type DocumentExportFormat,
  formatForName,
  formatLabel,
  markReadyStages,
  publishDocumentHandoff,
  stageById,
  type DocumentFormat,
  type DocumentHandoffRecord,
} from "@bcr/document-core";
import {
  ContentPackageCard,
  DocumentBlockContextCard,
  DocumentOcrReviewCard,
  JobCard,
  StageCard,
  StageInspector,
  TranslationPackageCard,
  TranslationReviewCard,
  sourceIcon,
} from "./DocumentCards";
import { activeDocument, documents } from "./store";
import { useDocumentStudio } from "./useDocumentStudio";
import { useDocumentArtifacts } from "./useDocumentArtifacts";
import { useDocumentIntegration } from "./useDocumentIntegration";
import {
  cancelDocumentStage,
  canRunDocumentStage,
  importDocumentExportBundle,
  importDocumentFile,
  preloadDocumentOcrModel,
  runDocumentStage,
  exportDocumentPackage,
  saveDocumentOcrReview,
  saveDocumentTranslationReview,
} from "./runtime";
import "./styles.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function canOpenInReader(format: DocumentFormat): boolean {
  return ["txt", "markdown", "html", "docx", "fb2", "epub", "pdf", "cbz"].includes(format);
}

function canOpenInManga(format: DocumentFormat): boolean {
  return format === "image";
}

function handoffStatusLabel(status: DocumentHandoffRecord["status"]): string {
  if (status === "consumed") return "已接收";
  if (status === "expired") return "需重试";
  return "待接收";
}

function formatHandoffTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function App() {
  const state = useDocumentStudio((snapshot) => snapshot);
  const active = activeDocument(state);
  const selected = stageById(active.stages, state.selectedStageId) ?? active.stages[0];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const navigate = useNavigate();
  const services = useRuntime();
  const citationParams = new URLSearchParams(useLocationSearch());
  const artifacts = useDocumentArtifacts(active);
  const {
    contentRef: extractRef,
    contentPackage,
    contentStats,
    translationRef,
    translationPackage,
    translationStats,
    translationDrafts: reviewDrafts,
    setTranslationDrafts: setReviewDrafts,
    ocrDrafts: ocrReviewDrafts,
    setOcrDrafts: setOcrReviewDrafts,
  } = artifacts;
  const { routeBlockId, handoffHistory } = useDocumentIntegration(services, state.jobs);
  const [savingReview, setSavingReview] = useState(false);
  const [savingOcrReview, setSavingOcrReview] = useState(false);
  const [ocrPreloading, setOcrPreloading] = useState(false);
  const [exportBusy, setExportBusy] = useState<DocumentExportFormat | null>(null);
  const compact = useMediaQuery("(max-width: 720px)");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const sourceAvailable =
    active.sourceRef !== undefined || documents.sourceFile(active.id) !== undefined;
  const feedback = useMemo(
    () => (state.notice === null ? null : { message: state.notice, tone: state.noticeTone }),
    [state.notice, state.noticeTone],
  );

  const importFiles = async (files: ReadonlyArray<File>): Promise<void> => {
    for (const [index, file] of files.entries()) {
      const isExportBundle =
        /\.json$/iu.test(file.name) || file.type.toLocaleLowerCase().startsWith("application/json");
      if (isExportBundle) {
        try {
          const imported = await importDocumentExportBundle(services, file);
          documents.addJob(imported.job, imported.file);
          documents.setNotice(`${imported.job.name} 已从 Export Bundle 恢复`);
        } catch (reason) {
          documents.setNotice(
            `${file.name} 导入失败：${reason instanceof Error ? reason.message : String(reason)}`,
            "error",
          );
        }
        continue;
      }
      const format = formatForName(file.name, file.type);
      if (format === "unknown") {
        documents.setNotice(`${file.name}：暂不支持的格式`, "warning");
        continue;
      }
      let sourceTextPreview: string | undefined;
      if (["txt", "markdown", "html", "docx", "fb2"].includes(format)) {
        try {
          // Preview only the first window; the full source stays in the Worker data plane.
          sourceTextPreview = (await file.slice(0, 64 * 1024).text())
            .replace(/\s+/gu, " ")
            .trim()
            .slice(0, 240);
        } catch {
          sourceTextPreview = undefined;
        }
      }
      try {
        const sourceRef = await importDocumentFile(services, file);
        const sourceUrl = format === "image" ? URL.createObjectURL(file) : undefined;
        const job = markReadyStages(
          createDocumentJob({
            id: `document-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            format,
            size: file.size,
            sourceRef,
            sourceUrl,
            sourceTextPreview,
          }),
        );
        documents.addJob(job, file);
      } catch (reason) {
        documents.setNotice(
          `${file.name} 导入失败：${reason instanceof Error ? reason.message : String(reason)}`,
          "error",
        );
      }
    }
  };

  const openImport = () => fileInputRef.current?.click();

  const refreshAvailableStages = () => {
    documents.replaceJob(markReadyStages(active));
    documents.setNotice("已刷新阶段能力；图片可运行本地 OCR，复杂版面建议交给 Manga");
  };

  const runSelectedStage = () => {
    if (selected === undefined) return;
    void runDocumentStage(services, active, selected.id);
  };

  const cancelSelectedStage = () => {
    if (selected === undefined) return;
    void cancelDocumentStage(active.id, selected.id);
  };

  const saveReview = () => {
    if (translationPackage === undefined || savingReview) return;
    setSavingReview(true);
    void saveDocumentTranslationReview(services, active, translationPackage, reviewDrafts)
      .catch((reason: unknown) => {
        documents.setNotice(
          `人工修订保存失败：${reason instanceof Error ? reason.message : String(reason)}`,
          "error",
        );
      })
      .finally(() => setSavingReview(false));
  };

  const saveOcrReview = () => {
    if (contentPackage === undefined || savingOcrReview || active.format !== "image") return;
    setSavingOcrReview(true);
    void saveDocumentOcrReview(services, active, contentPackage, ocrReviewDrafts)
      .catch((reason: unknown) => {
        documents.setNotice(
          `OCR 修订保存失败：${reason instanceof Error ? reason.message : String(reason)}`,
          "error",
        );
      })
      .finally(() => setSavingOcrReview(false));
  };

  const preloadOcr = () => {
    if (ocrPreloading || active.format !== "image") return;
    setOcrPreloading(true);
    const settings = documentOcrSettings(active.ocr);
    void preloadDocumentOcrModel(services, settings)
      .then(() => documents.setNotice(`${settings.model} 已预热到本地模型缓存`))
      .catch((reason: unknown) => {
        documents.setNotice(
          `OCR 模型预热失败：${reason instanceof Error ? reason.message : String(reason)}`,
          "error",
        );
      })
      .finally(() => setOcrPreloading(false));
  };

  const downloadExport = (format: DocumentExportFormat): void => {
    if (contentPackage === undefined || exportBusy !== null) return;
    const view = translationPackage === undefined ? "source" : "bilingual";
    setExportBusy(format);
    void exportDocumentPackage(services, active, contentPackage, translationPackage, format, view)
      .then(({ bytes, fileName, mime }) => {
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        documents.setNotice(`${fileName} 已导出并保存在本机`, "success");
      })
      .catch((reason: unknown) => {
        documents.setNotice(
          `${active.name} 导出失败：${reason instanceof Error ? reason.message : String(reason)}`,
          "error",
        );
      })
      .finally(() => setExportBusy(null));
  };

  const handoffReader = () => {
    const file = documents.sourceFile(active.id);
    if (file === undefined && active.sourceRef === undefined) {
      documents.setNotice(`${active.name} 的源文件句柄已离开当前标签页，请重新导入后再交给 Reader`);
      void navigate({ to: "/reader" });
      return;
    }
    const handoffId = publishDocumentHandoff({
      jobId: active.id,
      target: "reader",
      name: active.name,
      format: active.format,
      ...(file === undefined ? {} : { file }),
      size: active.size,
      ...(active.sourceRef === undefined ? {} : { sourceRef: active.sourceRef }),
      ...(extractRef === null ? {} : { contentRef: extractRef }),
      ...(translationRef === null ? {} : { translationRef }),
      ...(contentPackage === undefined ? {} : { content: contentPackage }),
      ...(translationPackage === undefined ? {} : { translation: translationPackage }),
    });
    documents.setNotice(`${active.name} 正在交给 Reader Studio；Reader 会接管源文件托管`);
    void navigate({ to: "/reader", search: { document: handoffId } });
  };

  const handoffManga = () => {
    const file = documents.sourceFile(active.id);
    if (file === undefined && active.sourceRef === undefined) {
      documents.setNotice(`${active.name} 的源文件句柄已离开当前标签页，请重新导入后再交给 Manga`);
      void navigate({ to: "/manga" });
      return;
    }
    const handoffId = publishDocumentHandoff({
      jobId: active.id,
      target: "manga",
      name: active.name,
      format: active.format,
      ...(file === undefined ? {} : { file }),
      size: active.size,
      ...(active.sourceRef === undefined ? {} : { sourceRef: active.sourceRef }),
      ...(extractRef === null ? {} : { contentRef: extractRef }),
      ...(translationRef === null ? {} : { translationRef }),
      ...(contentPackage === undefined ? {} : { content: contentPackage }),
      ...(translationPackage === undefined ? {} : { translation: translationPackage }),
    });
    documents.setNotice(`${active.name} 正在交给 Manga Studio；图片区域将在翻译工作台审校`);
    void navigate({ to: "/manga", search: { document: handoffId } });
  };

  const inspectorContent = (
    <>
      <div className="document-inspector-heading">
        <span className="ui-section-label document-eyebrow">处理详情</span>
        <strong>{selected?.label ?? "Stage"}</strong>
      </div>
      {selected !== undefined && (
        <StageInspector
          stage={selected}
          job={active}
          onRun={runSelectedStage}
          onCancel={cancelSelectedStage}
          canRunStage={canRunDocumentStage(active, selected.id)}
          onOcrSettingsChange={(patch) => documents.updateOcrSettings(active.id, patch)}
          onPreloadOcr={preloadOcr}
          ocrPreloading={ocrPreloading}
        />
      )}
      {contentPackage !== undefined && contentStats !== undefined && (
        <ContentPackageCard content={contentPackage} stats={contentStats} />
      )}
      {contentPackage !== undefined && (
        <DocumentBlockContextCard
          jobId={active.id}
          content={contentPackage}
          translation={translationPackage}
          focusBlockId={routeBlockId ?? undefined}
        />
      )}
      {contentPackage !== undefined && active.format === "image" && (
        <DocumentOcrReviewCard
          content={contentPackage}
          drafts={ocrReviewDrafts}
          saving={savingOcrReview}
          onChange={(id, value) => setOcrReviewDrafts((current) => ({ ...current, [id]: value }))}
          onSave={saveOcrReview}
        />
      )}
      {translationPackage !== undefined && translationStats !== undefined && (
        <TranslationPackageCard package={translationPackage} stats={translationStats} />
      )}
      {translationPackage !== undefined && (
        <TranslationReviewCard
          package={translationPackage}
          drafts={reviewDrafts}
          saving={savingReview}
          onChange={(id, value) => setReviewDrafts((current) => ({ ...current, [id]: value }))}
          onSave={saveReview}
        />
      )}
      <div className="document-preview-card">
        <div className="document-preview-heading">
          <span className="ui-section-label document-eyebrow">SOURCE PREVIEW</span>
          <span>{formatLabel(active.format)}</span>
        </div>
        {active.sourceUrl !== undefined ? (
          <img src={active.sourceUrl} alt={`${active.name} 预览`} />
        ) : active.sourceTextPreview !== undefined ? (
          <p>{active.sourceTextPreview}</p>
        ) : (
          <div className="document-preview-empty">
            {sourceIcon(active.format)}
            <span>源文件由目标工作台按需读取</span>
          </div>
        )}
      </div>
      <div className="document-inspector-footer">
        <span>已保存到本机</span>
        <span>元数据保存在本地浏览器</span>
      </div>
    </>
  );

  return (
    <div className="document-studio">
      {citationParams.has("cite") &&
        citationParams.get("job") !== active.id &&
        !state.jobs.some((job) => job.id === citationParams.get("job")) && (
          <p className="document-notice" role="status">
            引用来源尚未载入或已移除，请恢复原资料后重试。
          </p>
        )}
      {citationParams.has("cite") &&
        citationParams.get("job") === active.id &&
        contentPackage === undefined && (
          <p className="document-notice" role="status">
            引用正文尚未载入或已不可用，请检查文档处理结果。
          </p>
        )}
      <a className="document-skip-link" href="#document-canvas">
        跳到流水线
      </a>
      <AppToolbar className="document-header">
        <div className="document-brand">
          <div className="document-brand-mark">
            <Files className="document-icon" />
          </div>
          <div>
            <div className="document-brand-title">
              Document <span>Studio</span>
            </div>
            <div className="document-brand-subtitle">整理、处理与阅读</div>
          </div>
        </div>
        <div className="document-header-divider" />
        <div className="document-header-context">
          <span className="ui-section-label document-eyebrow">文档工作区</span>
          <strong>
            {state.jobs.length} 个本地任务 · {formatLabel(active.format)}
          </strong>
        </div>
        <div className="document-header-spacer" />
        <span className="document-runtime-chip">
          <StatusDot status="completed" /> 本地处理
        </span>
        <button
          type="button"
          className="ui-btn ui-btn-primary document-header-button"
          onClick={openImport}
        >
          <Upload className="document-icon" />
          <span>导入文件</span>
        </button>
      </AppToolbar>

      <input
        ref={fileInputRef}
        className="ui-sr-only"
        type="file"
        multiple
        accept=".txt,.md,.markdown,.mdown,.html,.htm,.docx,.fb2,.epub,.pdf,.cbz,.png,.jpg,.jpeg,.webp,.avif,.json,application/json"
        aria-label="导入文档或图片文件"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          void importFiles(files);
        }}
      />

      <div className="document-workspace">
        <aside className="document-inbox" aria-label="文档队列">
          <details className="document-inbox-disclosure" open={!compact}>
            <summary>文档列表 · {state.jobs.length}</summary>
            <div className="document-inbox-body">
              <div className="document-panel-heading">
                <div>
                  <span className="ui-section-label document-eyebrow">文档列表</span>
                  <strong>{state.jobs.length} 个任务</strong>
                </div>
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost ui-icon-btn"
                  aria-label="导入文件"
                  onClick={openImport}
                >
                  <Upload className="document-icon" />
                </button>
              </div>
              <button
                type="button"
                className={`document-dropzone ${dragging ? "is-dragging" : ""}`}
                onClick={openImport}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  void importFiles([...event.dataTransfer.files]);
                }}
              >
                <span className="document-dropzone-symbol">
                  <Upload className="document-icon" />
                </span>
                <strong>拖入文档或图片</strong>
                <span>TXT · EPUB · PDF · CBZ · IMAGE · EXPORT JSON</span>
              </button>
              <div className="document-queue-label">
                <span>队列</span>
                <span>{state.jobs.length.toString().padStart(2, "0")}</span>
              </div>
              <div className="document-job-list">
                {state.jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    active={job.id === active.id}
                    onSelect={() => documents.selectJob(job.id)}
                    onRemove={() => {
                      if (job.sourceUrl !== undefined) URL.revokeObjectURL(job.sourceUrl);
                      documents.removeJob(job.id);
                    }}
                  />
                ))}
              </div>
              <div className="document-inbox-footer">
                <span>
                  <StatusDot status="running" /> 保存在本机
                </span>
                <span>当前设备</span>
              </div>
            </div>
          </details>
        </aside>

        <main id="document-canvas" className="document-canvas" aria-label="文档流水线">
          <div className="document-canvas-topline">
            <div>
              <span className="ui-section-label document-eyebrow">
                {sourceAvailable ? "当前文档" : "示例文档"}
              </span>
              <h1 title={active.name}>{active.name}</h1>
              <p>
                {formatBytes(active.size)} · {formatLabel(active.format)} ·{" "}
                {new Date(active.updatedAt).toLocaleString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                更新
              </p>
            </div>
            <div className="document-canvas-actions">
              <ActionMenu label="更多文档操作">
                {compact && (
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost"
                    onClick={() => setInspectorOpen(true)}
                  >
                    处理详情
                  </button>
                )}
                <button
                  type="button"
                  className="ui-btn ui-btn-default"
                  onClick={refreshAvailableStages}
                >
                  <Sparkles className="document-icon" /> 刷新就绪阶段
                </button>
                {contentPackage !== undefined && (
                  <>
                    <button
                      type="button"
                      className="ui-btn ui-btn-default"
                      onClick={() => downloadExport("json")}
                      disabled={exportBusy !== null}
                    >
                      <Download className="document-icon" />
                      {exportBusy === "json" ? "导出中…" : "JSON"}
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn-default"
                      onClick={() => downloadExport("markdown")}
                      disabled={exportBusy !== null}
                    >
                      <Download className="document-icon" />
                      {exportBusy === "markdown" ? "导出中…" : "Markdown"}
                    </button>
                  </>
                )}
              </ActionMenu>
            </div>
          </div>

          <Toast notice={feedback} onDismiss={() => documents.setNotice(null)} />

          <section className="document-handoff-strip">
            <div className="document-handoff-copy">
              <span className="ui-section-label document-eyebrow">下一步</span>
              <strong>
                {!sourceAvailable
                  ? "从一份文档开始"
                  : canOpenInReader(active.format)
                    ? "开始阅读这份文档"
                    : "翻译与编辑这张图片"}
              </strong>
              <span>
                {sourceAvailable
                  ? "内容和编辑进度保存在当前设备。"
                  : "导入自己的文件，开始整理、处理和阅读。"}
              </span>
            </div>
            <div className="document-handoff-actions">
              {!sourceAvailable && (
                <button type="button" className="ui-btn ui-btn-primary" onClick={openImport}>
                  <Upload className="document-icon" />
                  导入文档
                </button>
              )}

              {sourceAvailable && canOpenInReader(active.format) && (
                <button type="button" className="ui-btn ui-btn-primary" onClick={handoffReader}>
                  <BookOpen className="document-icon" /> 打开 Reader
                  <ArrowUpRight className="document-icon" />
                </button>
              )}
              {sourceAvailable && canOpenInManga(active.format) && (
                <button type="button" className="ui-btn ui-btn-default" onClick={handoffManga}>
                  <ImagePlus className="document-icon" /> 打开 Manga
                  <ArrowUpRight className="document-icon" />
                </button>
              )}
            </div>
          </section>

          {compact && sourceAvailable && (active.sourceTextPreview || active.sourceUrl) && (
            <section className="document-overview" aria-label="文档预览">
              <span className="ui-section-label document-eyebrow">内容预览</span>
              {active.sourceUrl ? (
                <img src={active.sourceUrl} alt={active.name} />
              ) : (
                <p>{active.sourceTextPreview}</p>
              )}
            </section>
          )}

          <details className="document-process-disclosure" open={!compact}>
            <summary>
              处理阶段 · {active.stages.filter((stage) => stage.status === "done").length} /{" "}
              {active.stages.length} 已完成
            </summary>
            <section className="document-pipeline" aria-label="处理阶段">
              {active.stages.map((stage, index) => (
                <StageCard
                  key={stage.id}
                  stage={stage}
                  index={index}
                  active={stage.id === selected?.id}
                  onSelect={() => {
                    documents.selectStage(stage.id);
                    if (compact) setInspectorOpen(true);
                  }}
                />
              ))}
            </section>
          </details>

          {handoffHistory.length > 0 && (
            <section className="document-handoff-history" aria-label="最近工作台交接">
              <div className="document-handoff-history-heading">
                <div>
                  <span className="ui-section-label document-eyebrow">最近使用</span>
                  <strong>最近的工作台交接</strong>
                </div>
                <span>仅保存状态，不保存文件内容</span>
              </div>
              <div className="document-handoff-history-list" aria-live="polite">
                {handoffHistory.slice(0, 4).map((record) => (
                  <div
                    className={`document-handoff-record is-${record.status}`}
                    key={record.id}
                    data-handoff-status={record.status}
                  >
                    <span className="document-handoff-record-target">
                      {record.target === "reader"
                        ? "READER"
                        : record.target === "manga"
                          ? "MANGA"
                          : "DOCUMENT"}
                    </span>
                    <strong>{record.name}</strong>
                    <span className="document-handoff-record-status">
                      {handoffStatusLabel(record.status)} ·{" "}
                      {formatHandoffTime(record.completedAt ?? record.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        {!compact && (
          <aside className="document-inspector" aria-label="阶段详情">
            {inspectorContent}
          </aside>
        )}
        <Drawer
          open={compact && inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          title="处理详情"
          className="document-inspector-drawer"
        >
          {compact && inspectorContent}
        </Drawer>
      </div>
    </div>
  );
}
