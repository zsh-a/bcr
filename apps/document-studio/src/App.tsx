import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  FileArchive,
  FileCode2,
  FileImage,
  FileText,
  Files,
  FolderOpen,
  ImagePlus,
  Layers3,
  Link2,
  Play,
  ScanText,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useArtifact, useLocationSearch, useOptionalRuntime, useRuntime } from "@bcr/react";
import type { SearchDocument } from "@bcr/core";
import {
  DOCUMENT_HANDOFF_EVENT,
  consumeDocumentHandoff,
  createDocumentJob,
  decodeDocumentContentPackage,
  decodeDocumentTranslationPackage,
  documentContentStats,
  documentOcrSettings,
  type DocumentExportFormat,
  documentTranslationStats,
  formatForName,
  formatLabel,
  getDocumentHandoffMarker,
  listDocumentHandoffs,
  markDocumentHandoffExpired,
  markReadyStages,
  publishDocumentHandoff,
  stageById,
  type DocumentCapability,
  type DocumentFormat,
  type DocumentJob,
  type DocumentStageState,
  type DocumentHandoffRecord,
  type DocumentContentPackage,
  type DocumentContentStats,
  type DocumentOcrAdapter,
  type DocumentOcrDevice,
  type DocumentOcrLanguage,
  type DocumentOcrSettings,
  type DocumentTranslationPackage,
  type DocumentTranslationStats,
} from "@bcr/document-core";
import { activeDocument, documents, useDocumentStudio } from "./store";
import {
  cancelDocumentStage,
  canRunDocumentStage,
  importDocumentExportBundle,
  importDocumentHandoff,
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

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return "—";
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(1)} s`;
}

function sourceIcon(format: DocumentFormat) {
  if (format === "image") return <FileImage className="document-icon" />;
  if (format === "epub" || format === "cbz") return <FileArchive className="document-icon" />;
  if (format === "markdown" || format === "html" || format === "docx" || format === "fb2") {
    return <FileCode2 className="document-icon" />;
  }
  return <FileText className="document-icon" />;
}

function capabilityLabel(capability: DocumentCapability): string {
  if (capability === "ready") return "READY";
  if (capability === "adapter") return "ADAPTER";
  return "PLANNED";
}

function stageTone(stage: DocumentStageState): string {
  if (stage.status === "done") return "is-done";
  if (stage.status === "blocked") return "is-blocked";
  if (stage.status === "error") return "is-error";
  if (stage.status === "running") return "is-running";
  return "is-idle";
}

function stageIcon(stage: DocumentStageState) {
  if (stage.status === "done") return <Check className="document-icon" />;
  if (stage.id === "ocr") return <ScanText className="document-icon" />;
  if (stage.id === "translate") return <WandSparkles className="document-icon" />;
  if (stage.id === "typeset") return <Layers3 className="document-icon" />;
  return <span className="document-stage-dot" />;
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
  const hostServices = useOptionalRuntime();
  const routeSearch = useLocationSearch();
  const routeJobId = new URLSearchParams(routeSearch).get("job");
  const routeHandoffId = new URLSearchParams(routeSearch).get("handoff");
  const routeBlockId = new URLSearchParams(routeSearch).get("block");
  const extractRef =
    stageById(active.stages, "extract")?.artifact ??
    stageById(active.stages, "ocr")?.artifact ??
    null;
  const extractBytes = useArtifact(extractRef);
  const contentPackage = useMemo(() => {
    if (extractBytes === undefined) return undefined;
    try {
      return decodeDocumentContentPackage(
        JSON.parse(new TextDecoder().decode(extractBytes)) as unknown,
      );
    } catch {
      return undefined;
    }
  }, [extractBytes]);
  const contentStats = useMemo<DocumentContentStats | undefined>(
    () => (contentPackage === undefined ? undefined : documentContentStats(contentPackage)),
    [contentPackage],
  );
  const translationRef = stageById(active.stages, "translate")?.artifact ?? null;
  const translationBytes = useArtifact(translationRef);
  const translationPackage = useMemo(() => {
    if (translationBytes === undefined) return undefined;
    try {
      return decodeDocumentTranslationPackage(
        JSON.parse(new TextDecoder().decode(translationBytes)) as unknown,
      );
    } catch {
      return undefined;
    }
  }, [translationBytes]);
  const translationStats = useMemo<DocumentTranslationStats | undefined>(
    () =>
      translationPackage === undefined ? undefined : documentTranslationStats(translationPackage),
    [translationPackage],
  );

  useEffect(() => {
    if (translationPackage === undefined) {
      setReviewDrafts({});
      return;
    }
    setReviewDrafts(
      Object.fromEntries(
        translationPackage.blocks.map((block) => [block.id, block.translatedText]),
      ),
    );
  }, [translationPackage]);

  useEffect(() => {
    if (contentPackage === undefined || active.format !== "image") {
      setOcrReviewDrafts({});
      return;
    }
    setOcrReviewDrafts(
      Object.fromEntries(contentPackage.blocks.map((block) => [block.id, block.text])),
    );
  }, [active.format, contentPackage]);

  const appliedRouteRef = useRef("");
  const appliedHandoffRef = useRef("");
  const [handoffHistory, setHandoffHistory] = useState<ReadonlyArray<DocumentHandoffRecord>>(() =>
    listDocumentHandoffs(),
  );
  const [reviewDrafts, setReviewDrafts] = useState<Readonly<Record<string, string>>>({});
  const [ocrReviewDrafts, setOcrReviewDrafts] = useState<Readonly<Record<string, string>>>({});
  const [savingReview, setSavingReview] = useState(false);
  const [savingOcrReview, setSavingOcrReview] = useState(false);
  const [ocrPreloading, setOcrPreloading] = useState(false);
  const [exportBusy, setExportBusy] = useState<DocumentExportFormat | null>(null);

  useEffect(() => {
    documents.connectMetadata(services.metadata);
  }, [services.metadata]);

  useEffect(() => {
    const search = hostServices?.search;
    if (search === undefined) return;
    const records: SearchDocument[] = state.jobs.map((job) => {
      const done = job.stages.filter((stage) => stage.status === "done").length;
      const body = [
        job.sourceTextPreview ?? "",
        ...job.stages.map((stage) => `${stage.label} ${stage.status} ${stage.detail}`),
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 24_000);
      return {
        id: `document:${job.id}`,
        source: "documents",
        kind: "document",
        title: job.name,
        subtitle: `${formatLabel(job.format)} · ${done}/${job.stages.length} stages ready`,
        ...(body.length === 0 ? {} : { body }),
        tags: ["document", job.format],
        route: `/documents?job=${encodeURIComponent(job.id)}`,
        updatedAt: job.updatedAt,
      };
    });
    if (contentPackage !== undefined) {
      for (const block of contentPackage.blocks) {
        records.push({
          id: `document:block:${active.id}:${block.id}`,
          source: "documents",
          kind: "document",
          title: block.label,
          subtitle: `${active.name} · ${formatLabel(active.format)} · 原文`,
          body: block.text,
          tags: ["document", active.format, "content", block.kind],
          route: `/documents?job=${encodeURIComponent(active.id)}&block=${encodeURIComponent(block.id)}`,
          updatedAt: active.updatedAt,
        });
      }
    }
    if (translationPackage !== undefined) {
      for (const block of translationPackage.blocks) {
        const body = [block.text, block.translatedText].filter(Boolean).join(" ");
        records.push({
          id: `document:translation:${active.id}:${block.id}`,
          source: "documents",
          kind: "document",
          title: `${block.label} · 译文`,
          subtitle: `${active.name} · ${translationPackage.targetLanguage}`,
          ...(body.length === 0 ? {} : { body }),
          tags: ["document", active.format, "translation", block.status],
          route: `/documents?job=${encodeURIComponent(active.id)}&block=${encodeURIComponent(block.id)}`,
          updatedAt: active.updatedAt,
        });
      }
    }
    search.replaceSource("documents", records);
  }, [active, contentPackage, hostServices?.search, state.jobs, translationPackage]);

  useEffect(() => {
    if (routeJobId === null || appliedRouteRef.current === routeJobId) return;
    if (state.jobs.some((job) => job.id === routeJobId)) {
      appliedRouteRef.current = routeJobId;
      documents.selectJob(routeJobId);
    }
  }, [routeJobId, state.jobs]);

  useEffect(() => {
    if (routeHandoffId === null || appliedHandoffRef.current === routeHandoffId) return;
    appliedHandoffRef.current = routeHandoffId;
    const handoff = consumeDocumentHandoff(routeHandoffId, "document");
    if (handoff === undefined) {
      const marker = getDocumentHandoffMarker();
      markDocumentHandoffExpired(routeHandoffId, "document");
      documents.setNotice(
        marker?.id !== routeHandoffId || marker.target !== "document"
          ? "Document handoff 已过期；请从来源工作台重新交接"
          : `Document handoff「${marker.name}」已过期；请从来源工作台重新交接`,
      );
      void navigate({ to: "/documents" });
      return;
    }
    void importDocumentHandoff(services, handoff)
      .then(({ job, file }) => {
        const resolvedJobId = documents.addJob(job, file);
        void navigate({ to: "/documents", search: { job: resolvedJobId } });
      })
      .catch((reason: unknown) => {
        documents.setNotice(
          `接收 ${handoff.name} 失败：${reason instanceof Error ? reason.message : String(reason)}`,
        );
        void navigate({ to: "/documents" });
      });
  }, [navigate, routeHandoffId, services]);

  useEffect(() => {
    const refresh = () => setHandoffHistory(listDocumentHandoffs());
    window.addEventListener(DOCUMENT_HANDOFF_EVENT, refresh);
    return () => window.removeEventListener(DOCUMENT_HANDOFF_EVENT, refresh);
  }, []);

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

function ContentPackageCard(props: {
  content: DocumentContentPackage;
  stats: DocumentContentStats;
}) {
  return (
    <section className="document-content-card" aria-label="标准化内容包摘要">
      <div className="document-content-card-heading">
        <div>
          <span className="document-eyebrow">CONTENT PACKAGE / V1</span>
          <strong>结构化内容已就绪</strong>
        </div>
        <span className="document-content-version">V{props.content.version}</span>
      </div>
      <div className="document-content-meta">
        <span>{props.content.provenance.adapter}</span>
        <span title={props.content.id}>{props.content.blocks.length} blocks</span>
      </div>
      <div className="document-content-stats" aria-label="内容统计">
        <div>
          <strong>{props.stats.textBlockCount}</strong>
          <span>文本块</span>
        </div>
        <div>
          <strong>{props.stats.characterCount.toLocaleString("zh-CN")}</strong>
          <span>字符</span>
        </div>
        <div>
          <strong>{props.stats.wordCount.toLocaleString("zh-CN")}</strong>
          <span>词项</span>
        </div>
        <div>
          <strong>{props.stats.pageCount || "—"}</strong>
          <span>页</span>
        </div>
      </div>
      <p className="document-content-hint">Reader、翻译和搜索将共用这份标准输入。</p>
    </section>
  );
}

function TranslationPackageCard(props: {
  package: DocumentTranslationPackage;
  stats: DocumentTranslationStats;
}) {
  return (
    <section className="document-translation-card" aria-label="翻译包摘要">
      <div className="document-content-card-heading">
        <div>
          <span className="document-eyebrow">TRANSLATION PACKAGE / V1</span>
          <strong>译文已生成，等待审校</strong>
        </div>
        <span className="document-translation-target">{props.package.targetLanguage}</span>
      </div>
      <div className="document-content-meta">
        <span>{props.package.provenance.adapter}</span>
        <span title={props.package.sourceContentId}>{props.stats.blockCount} blocks</span>
      </div>
      <div className="document-content-stats document-translation-stats">
        <div>
          <strong>{props.stats.translatedCount}</strong>
          <span>已确认</span>
        </div>
        <div>
          <strong>{props.stats.reviewCount}</strong>
          <span>待审校</span>
        </div>
        <div>
          <strong>{props.stats.sourceCharacterCount.toLocaleString("zh-CN")}</strong>
          <span>原文字符</span>
        </div>
        <div>
          <strong>{props.stats.translatedCharacterCount.toLocaleString("zh-CN")}</strong>
          <span>译文字符</span>
        </div>
      </div>
      <p className="document-content-hint">Block ID 与原文保持一致，Typeset 可直接接续。</p>
    </section>
  );
}

function DocumentBlockContextCard(props: {
  content: DocumentContentPackage;
  translation: DocumentTranslationPackage | undefined;
  focusBlockId?: string | undefined;
}) {
  const translatedById = new Map(
    props.translation?.blocks.map((block) => [block.id, block.translatedText]) ?? [],
  );
  const focused =
    props.focusBlockId === undefined
      ? undefined
      : props.content.blocks.find((block) => block.id === props.focusBlockId);
  const blocks =
    focused === undefined
      ? props.content.blocks.slice(0, 3)
      : [focused, ...props.content.blocks.filter((block) => block.id !== focused.id).slice(0, 2)];
  return (
    <section className="document-block-context" aria-label="内容块上下文">
      <div className="document-block-context-heading">
        <div>
          <span className="document-eyebrow">BLOCK CONTEXT</span>
          <strong>{props.translation === undefined ? "抽取内容" : "原文 · 译文"}</strong>
        </div>
        <span>{props.content.blocks.length} total</span>
      </div>
      <div className="document-block-context-list">
        {blocks.map((block, index) => {
          const translated = translatedById.get(block.id);
          return (
            <div
              className={`document-block-context-item ${block.id === focused?.id ? "is-focused" : ""}`}
              key={block.id}
            >
              <span className="document-block-context-label">
                {String(index + 1).padStart(2, "0")} · {block.label}
              </span>
              <p>{block.text}</p>
              {translated !== undefined && translated.length > 0 && <p>{translated}</p>}
            </div>
          );
        })}
      </div>
      {props.content.blocks.length > blocks.length && (
        <span className="document-block-context-more">
          + {props.content.blocks.length - blocks.length} blocks 已加入全局搜索
        </span>
      )}
    </section>
  );
}

function DocumentOcrReviewCard(props: {
  content: DocumentContentPackage;
  drafts: Readonly<Record<string, string>>;
  saving: boolean;
  onChange: (id: string, value: string) => void;
  onSave: () => void;
}) {
  const blocks = props.content.blocks.slice(0, 5);
  const changed = blocks.some(
    (block) => props.drafts[block.id] !== undefined && props.drafts[block.id] !== block.text,
  );
  return (
    <section className="document-ocr-review" aria-label="OCR 文本审校">
      <div className="document-block-context-heading">
        <div>
          <span className="document-eyebrow">OCR REVIEW</span>
          <strong>识别文本审校</strong>
        </div>
        <span>{props.content.blocks.length} regions</span>
      </div>
      <p className="document-ocr-review-hint">
        保留区域几何，只修正文案；保存后翻译、排版和导出会回到待运行。
      </p>
      <div className="document-ocr-review-list">
        {blocks.map((block, index) => (
          <label className="document-ocr-review-item" key={block.id}>
            <span>
              {String(index + 1).padStart(2, "0")} · {block.label}
            </span>
            <small>
              {block.geometry === undefined
                ? "geometry —"
                : `${Math.round(block.geometry.x)}%, ${Math.round(block.geometry.y)}% · ${Math.round(block.geometry.width)}×${Math.round(block.geometry.height)}%`}
              {block.confidence === undefined
                ? ""
                : ` · ${Math.round(block.confidence * 100)}% confidence`}
            </small>
            <textarea
              rows={2}
              value={props.drafts[block.id] ?? block.text}
              aria-label={`编辑 ${block.label} 的 OCR 文本`}
              onChange={(event) => props.onChange(block.id, event.target.value)}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="document-ocr-review-save"
        onClick={props.onSave}
        disabled={!changed || props.saving}
      >
        {props.saving ? "保存中…" : changed ? "保存 OCR 修订" : "暂无未保存修改"}
      </button>
      {props.content.blocks.length > blocks.length && (
        <span className="document-block-context-more">
          仅展示前 {blocks.length} 个区域；完整包仍会保留全部 OCR blocks
        </span>
      )}
    </section>
  );
}

function TranslationReviewCard(props: {
  package: DocumentTranslationPackage;
  drafts: Readonly<Record<string, string>>;
  saving: boolean;
  onChange: (id: string, value: string) => void;
  onSave: () => void;
}) {
  const blocks = props.package.blocks.slice(0, 5);
  const changed = blocks.some(
    (block) =>
      props.drafts[block.id] !== undefined && props.drafts[block.id] !== block.translatedText,
  );
  return (
    <section className="document-translation-review" aria-label="译文审校">
      <div className="document-block-context-heading">
        <div>
          <span className="document-eyebrow">REVIEW QUEUE</span>
          <strong>快速审校</strong>
        </div>
        <span>{props.package.targetLanguage}</span>
      </div>
      <div className="document-translation-review-list">
        {blocks.map((block, index) => (
          <label className="document-translation-review-item" key={block.id}>
            <span>
              {String(index + 1).padStart(2, "0")} · {block.label}
            </span>
            <small>{block.text}</small>
            <textarea
              rows={2}
              value={props.drafts[block.id] ?? block.translatedText}
              aria-label={`编辑 ${block.label} 的译文`}
              onChange={(event) => props.onChange(block.id, event.target.value)}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="document-review-save"
        onClick={props.onSave}
        disabled={!changed || props.saving}
      >
        {props.saving ? "保存中…" : changed ? "保存人工修订" : "暂无未保存修改"}
      </button>
      {props.package.blocks.length > blocks.length && (
        <span className="document-block-context-more">
          仅展示前 {blocks.length} 个 block；完整包仍可由后续审校器处理
        </span>
      )}
    </section>
  );
}

function JobCard(props: {
  job: DocumentJob;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const done = props.job.stages.filter((stage) => stage.status === "done").length;
  return (
    <div className={`document-job-card ${props.active ? "is-active" : ""}`}>
      <button
        type="button"
        className="document-job-select"
        onClick={props.onSelect}
        aria-current={props.active ? "page" : undefined}
      >
        <span className={`document-job-icon document-format-${props.job.format}`}>
          {sourceIcon(props.job.format)}
        </span>
        <span className="document-job-copy">
          <strong>{props.job.name}</strong>
          <span>
            {formatLabel(props.job.format)} · {done}/7 READY
          </span>
        </span>
        <ChevronRight className="document-icon document-job-arrow" />
      </button>
      <button
        type="button"
        className="document-job-remove"
        aria-label={`移除 ${props.job.name}`}
        onClick={props.onRemove}
      >
        <Trash2 className="document-icon" />
      </button>
    </div>
  );
}

function StageCard(props: {
  stage: DocumentStageState;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`document-stage-card ${stageTone(props.stage)} ${props.active ? "is-selected" : ""}`}
      onClick={props.onSelect}
      aria-current={props.active ? "step" : undefined}
    >
      <span className="document-stage-index">{String(props.index + 1).padStart(2, "0")}</span>
      <span className="document-stage-icon">{stageIcon(props.stage)}</span>
      <span className="document-stage-copy">
        <strong>{props.stage.label}</strong>
        <span>{props.stage.detail}</span>
      </span>
      <span className="document-stage-badge">{capabilityLabel(props.stage.capability)}</span>
      <span className="document-stage-status">{props.stage.status.toUpperCase()}</span>
      {props.index < 6 && <ChevronRight className="document-stage-next" />}
    </button>
  );
}

const DOCUMENT_OCR_MODELS: Readonly<Record<DocumentOcrAdapter, string>> = {
  "vision.onnx": "Xenova/trocr-small-printed",
  "manga.onnx": "onnx-community/manga-ocr-base-ONNX",
};

function DocumentOcrSettingsCard(props: {
  settings: DocumentOcrSettings;
  onChange: (patch: Partial<DocumentOcrSettings>) => void;
  disabled?: boolean;
  onPreload?: (() => void) | undefined;
  preloading?: boolean;
}) {
  const modelLabel =
    props.settings.adapter === "manga.onnx" ? "Manga OCR / 日文" : "TrOCR / Latin 印刷体";
  const languageMismatch =
    (props.settings.adapter === "manga.onnx" && props.settings.sourceLanguage !== "ja") ||
    (props.settings.adapter === "vision.onnx" && props.settings.sourceLanguage !== "en");
  return (
    <section className="document-ocr-settings" aria-label="视觉 OCR 设置">
      <div className="document-ocr-settings-heading">
        <div>
          <span className="document-eyebrow">LOCAL VISION OCR</span>
          <strong>整页识别配置</strong>
        </div>
        <ScanText className="document-icon" />
      </div>
      <label>
        <span>识别模型</span>
        <select
          aria-label="文档 OCR 模型"
          value={props.settings.adapter}
          disabled={props.disabled}
          onChange={(event) => {
            const adapter = event.target.value as DocumentOcrAdapter;
            props.onChange({
              adapter,
              model: DOCUMENT_OCR_MODELS[adapter],
              sourceLanguage: adapter === "manga.onnx" ? "ja" : "en",
            });
          }}
        >
          <option value="vision.onnx">TrOCR / Latin 印刷体</option>
          <option value="manga.onnx">Manga OCR / 日本語</option>
        </select>
      </label>
      <label>
        <span>源语言</span>
        <select
          aria-label="文档 OCR 源语言"
          value={props.settings.sourceLanguage}
          disabled={props.disabled}
          onChange={(event) =>
            props.onChange({ sourceLanguage: event.target.value as DocumentOcrLanguage })
          }
        >
          <option value="en">English / Latin</option>
          <option value="ja">日本語 / Japanese</option>
        </select>
      </label>
      <label>
        <span>运行设备</span>
        <select
          aria-label="文档 OCR 运行设备"
          value={props.settings.device}
          disabled={props.disabled}
          onChange={(event) => props.onChange({ device: event.target.value as DocumentOcrDevice })}
        >
          <option value="auto">Auto / 自动降级</option>
          <option value="webgpu">WebGPU / 优先 GPU</option>
          <option value="wasm">WASM / 兼容模式</option>
        </select>
      </label>
      <label>
        <span>模型地址</span>
        <input
          aria-label="文档 OCR 模型地址"
          value={props.settings.model}
          disabled={props.disabled}
          onChange={(event) => props.onChange({ model: event.target.value })}
          spellCheck={false}
        />
      </label>
      <p>
        {modelLabel} 按整页建立一个稳定区域；首次运行会在 Worker 中懒加载模型并写入浏览器缓存。
        密集气泡、竖排混排或多页文件请交给 Manga Studio。
      </p>
      {props.onPreload !== undefined && (
        <button
          type="button"
          className="document-ocr-preload"
          onClick={props.onPreload}
          disabled={props.disabled || props.preloading}
        >
          <Sparkles className="document-icon" />
          {props.preloading ? "模型预热中…" : "预热模型到本地缓存"}
        </button>
      )}
      {languageMismatch && (
        <p className="document-ocr-settings-warning">
          当前模型主要支持 {props.settings.adapter === "manga.onnx" ? "日文" : "Latin 英文"}；
          不匹配的语言会在 Worker 中拒绝运行，请切换模型或源语言。
        </p>
      )}
    </section>
  );
}

function StageInspector(props: {
  stage: DocumentStageState;
  job: DocumentJob;
  onRun: () => void;
  onCancel: () => void;
  canRunStage: boolean;
  onOcrSettingsChange: (patch: Partial<DocumentOcrSettings>) => void;
  onPreloadOcr: () => void;
  ocrPreloading: boolean;
}) {
  const isDone = props.stage.status === "done";
  const isPlanned = props.stage.capability === "planned" && !isDone;
  const isRunning = props.stage.status === "running";
  const formatBlocked =
    props.stage.status === "blocked" && (props.stage.id === "extract" || props.stage.id === "ocr");
  const ocr =
    props.stage.id === "ocr" && props.job.format === "image"
      ? documentOcrSettings(props.job.ocr)
      : undefined;
  const canRun = props.canRunStage && !isRunning;
  const stageActionLabel = isDone ? `重新运行 ${props.stage.label}` : `运行 ${props.stage.label}`;
  return (
    <div className="document-stage-inspector">
      <div className={`document-inspector-status ${stageTone(props.stage)}`}>
        {stageIcon(props.stage)}
        <span>
          {isDone
            ? "已完成"
            : isPlanned
              ? "等待能力接入"
              : formatBlocked
                ? props.stage.id === "ocr"
                  ? "该格式跳过 OCR"
                  : "由目标适配器处理"
                : props.canRunStage
                  ? "可在本地运行"
                  : "等待上游 Artifact"}
        </span>
      </div>
      <p>{props.stage.detail}。阶段状态随任务保存，失败时可从当前阶段重试。</p>
      <dl>
        <div>
          <dt>FORMAT</dt>
          <dd>{formatLabel(props.job.format)}</dd>
        </div>
        <div>
          <dt>CAPABILITY</dt>
          <dd>{capabilityLabel(props.stage.capability)}</dd>
        </div>
        <div>
          <dt>PROGRESS</dt>
          <dd>{Math.round(props.stage.progress * 100)}%</dd>
        </div>
        <div>
          <dt>ATTEMPTS</dt>
          <dd>{props.stage.attempts ?? 0}</dd>
        </div>
        <div>
          <dt>DURATION</dt>
          <dd>{formatDuration(props.stage.durationMs)}</dd>
        </div>
        <div>
          <dt>RUNTIME</dt>
          <dd>{props.stage.execution?.runtime?.toUpperCase() ?? "—"}</dd>
        </div>
        <div>
          <dt>CACHE</dt>
          <dd>{props.stage.execution?.cache?.toUpperCase() ?? "—"}</dd>
        </div>
        {props.stage.execution !== undefined && (
          <div>
            <dt>OPERATION</dt>
            <dd title={props.stage.execution.operation}>{props.stage.execution.operation}</dd>
          </div>
        )}
        {props.stage.artifact !== undefined && (
          <div>
            <dt>ARTIFACT</dt>
            <dd title={props.stage.artifact.id}>READY</dd>
          </div>
        )}
      </dl>
      {props.stage.error !== undefined && (
        <div className="document-inspector-error" role="alert">
          <CircleAlert className="document-icon" />
          <span>{props.stage.error}</span>
        </div>
      )}
      {canRun && (
        <button type="button" className="document-inspector-run" onClick={props.onRun}>
          <Play className="document-icon" />
          {stageActionLabel}
        </button>
      )}
      {isRunning && (
        <button type="button" className="document-inspector-cancel" onClick={props.onCancel}>
          <X className="document-icon" />
          停止 {props.stage.label}
        </button>
      )}
      {ocr !== undefined && (
        <DocumentOcrSettingsCard
          settings={ocr}
          onChange={props.onOcrSettingsChange}
          disabled={isRunning}
          onPreload={props.onPreloadOcr}
          preloading={props.ocrPreloading}
        />
      )}
      {isPlanned ? (
        <div className="document-inspector-callout">
          <WandSparkles className="document-icon" />
          <span>该阶段会在本地模型 / Manga Studio 适配器就绪后解锁。</span>
        </div>
      ) : formatBlocked ? (
        <div className="document-inspector-callout is-neutral">
          <Link2 className="document-icon" />
          <span>
            {props.stage.id === "ocr"
              ? "文本格式不需要视觉识别；Extract 已生成的内容会直接进入翻译。"
              : "这是二进制出版物；由 Reader / Manga 直接解析，避免把压缩包当作纯文本。"}
          </span>
        </div>
      ) : props.canRunStage ? (
        <div className="document-inspector-callout is-neutral">
          <Play className="document-icon" />
          <span>{props.stage.adapter ?? "Local adapter"} · 可重入执行，不会覆盖源文件。</span>
        </div>
      ) : (
        <div className="document-inspector-callout is-neutral">
          <Link2 className="document-icon" />
          <span>完成前置阶段后解锁；不会覆盖源文件。</span>
        </div>
      )}
    </div>
  );
}
