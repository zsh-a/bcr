import {
  ArrowUpRight,
  BookOpen,
  CircleAlert,
  Download,
  Files,
  FolderOpen,
  ImagePlus,
  Layers3,
  Link2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useRuntime } from "@bcr/react";
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
import { activeDocument, documents, useDocumentStudio } from "./store";
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
          );
        }
        continue;
      }
      const format = formatForName(file.name, file.type);
      if (format === "unknown") {
        documents.setNotice(`${file.name}：暂不支持的格式`);
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
        documents.setNotice(`${fileName} 已导出；Artifact 已写入本地存储`);
      })
      .catch((reason: unknown) => {
        documents.setNotice(
          `${active.name} 导出失败：${reason instanceof Error ? reason.message : String(reason)}`,
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

  return (
    <div className="document-studio">
      <a className="document-skip-link" href="#document-canvas">
        跳到流水线
      </a>
      <header className="document-header">
        <div className="document-brand">
          <div className="document-brand-mark">
            <Files className="document-icon" />
          </div>
          <div>
            <div className="document-brand-title">
              Document <span>Studio</span>
            </div>
            <div className="document-brand-subtitle">INGEST · NORMALIZE · HANDOFF</div>
          </div>
        </div>
        <div className="document-header-divider" />
        <div className="document-header-context">
          <span className="document-eyebrow">LOCAL DOCUMENT PIPELINE</span>
          <strong>
            {state.jobs.length} 个本地任务 · {formatLabel(active.format)}
          </strong>
        </div>
        <div className="document-header-spacer" />
        <span className="document-runtime-chip">
          <span className="document-live-dot" /> LOCAL-FIRST
        </span>
        <button type="button" className="document-header-button" onClick={openImport}>
          <Upload className="document-icon" />
          <span>导入文件</span>
        </button>
      </header>

      <input
        ref={fileInputRef}
        className="document-visually-hidden"
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
          <div className="document-panel-heading">
            <div>
              <span className="document-eyebrow">DOCUMENT INBOX</span>
              <strong>{state.jobs.length} 个任务</strong>
            </div>
            <button
              type="button"
              className="document-icon-button"
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
            <span>QUEUE</span>
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
              <span className="document-live-dot" /> BROWSER STORAGE
            </span>
            <span>LOCAL / V1</span>
          </div>
        </aside>

        <main id="document-canvas" className="document-canvas" aria-label="文档流水线">
          <div className="document-canvas-topline">
            <div>
              <span className="document-eyebrow">PIPELINE MAP / {active.id.slice(-8)}</span>
              <h1>{active.name}</h1>
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
              <button
                type="button"
                className="document-button document-button-secondary"
                onClick={refreshAvailableStages}
              >
                <Sparkles className="document-icon" /> 刷新就绪阶段
              </button>
              {contentPackage !== undefined && (
                <>
                  <button
                    type="button"
                    className="document-button document-button-secondary"
                    onClick={() => downloadExport("json")}
                    disabled={exportBusy !== null}
                  >
                    <Download className="document-icon" />
                    {exportBusy === "json" ? "导出中…" : "JSON"}
                  </button>
                  <button
                    type="button"
                    className="document-button document-button-secondary"
                    onClick={() => downloadExport("markdown")}
                    disabled={exportBusy !== null}
                  >
                    <Download className="document-icon" />
                    {exportBusy === "markdown" ? "导出中…" : "Markdown"}
                  </button>
                </>
              )}
              <button
                type="button"
                className="document-button document-button-primary"
                onClick={openImport}
              >
                <FolderOpen className="document-icon" /> 添加到队列
              </button>
            </div>
          </div>

          {state.notice !== null && (
            <div className="document-notice" role="status" aria-live="polite">
              <CircleAlert className="document-icon" />
              <span>{state.notice}</span>
              <button type="button" aria-label="关闭提示" onClick={() => documents.setNotice(null)}>
                <X className="document-icon" />
              </button>
            </div>
          )}

          <section className="document-pipeline" aria-label="处理阶段">
            {active.stages.map((stage, index) => (
              <StageCard
                key={stage.id}
                stage={stage}
                index={index}
                active={stage.id === selected?.id}
                onSelect={() => documents.selectStage(stage.id)}
              />
            ))}
          </section>

          <section className="document-handoff-strip">
            <div className="document-handoff-copy">
              <span className="document-eyebrow">NEXT SAFE HANDOFF</span>
              <strong>
                {canOpenInReader(active.format)
                  ? "把结构化内容交给 Reader Studio"
                  : "把页面素材交给 Manga Studio"}
              </strong>
              <span>源文件不在应用之间复制；每个工作台保持自己的领域状态。</span>
            </div>
            <div className="document-handoff-actions">
              {canOpenInReader(active.format) && (
                <button
                  type="button"
                  className="document-button document-button-primary"
                  onClick={handoffReader}
                >
                  <BookOpen className="document-icon" /> 打开 Reader
                  <ArrowUpRight className="document-icon" />
                </button>
              )}
              {canOpenInManga(active.format) && (
                <button
                  type="button"
                  className="document-button document-button-secondary"
                  onClick={handoffManga}
                >
                  <ImagePlus className="document-icon" /> 打开 Manga
                  <ArrowUpRight className="document-icon" />
                </button>
              )}
            </div>
          </section>

          {handoffHistory.length > 0 && (
            <section className="document-handoff-history" aria-label="最近工作台交接">
              <div className="document-handoff-history-heading">
                <div>
                  <span className="document-eyebrow">HANDOFF HISTORY</span>
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

          <div className="document-principle-row">
            <span>
              <Link2 className="document-icon" /> Artifact boundary
            </span>
            <span>
              <Layers3 className="document-icon" /> Re-runnable stages
            </span>
            <span>
              <Files className="document-icon" /> No cloud upload
            </span>
          </div>
        </main>

        <aside className="document-inspector" aria-label="阶段详情">
          <div className="document-inspector-heading">
            <span className="document-eyebrow">INSPECTOR</span>
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
              onChange={(id, value) =>
                setOcrReviewDrafts((current) => ({ ...current, [id]: value }))
              }
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
              <span className="document-eyebrow">SOURCE PREVIEW</span>
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
            <span>STATE IS DURABLE</span>
            <span>元数据保存在本地浏览器</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
