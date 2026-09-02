import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
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
  createDocumentJob,
  decodeDocumentContentPackage,
  documentContentStats,
  formatForName,
  formatLabel,
  listDocumentHandoffs,
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
} from "@bcr/document-core";
import { activeDocument, documents, useDocumentStudio } from "./store";
import {
  cancelDocumentStage,
  canRunDocumentStage,
  importDocumentFile,
  runDocumentStage,
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
  const routeJobId = new URLSearchParams(useLocationSearch()).get("job");
  const extractRef = stageById(active.stages, "extract")?.artifact ?? null;
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
  const appliedRouteRef = useRef("");
  const [handoffHistory, setHandoffHistory] = useState<ReadonlyArray<DocumentHandoffRecord>>(() =>
    listDocumentHandoffs(),
  );

  useEffect(() => {
    documents.connectMetadata(services.metadata);
  }, [services.metadata]);

  useEffect(() => {
    const search = hostServices?.search;
    if (search === undefined) return;
    const records: ReadonlyArray<SearchDocument> = state.jobs.map((job) => {
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
    search.replaceSource("documents", records);
  }, [hostServices?.search, state.jobs]);

  useEffect(() => {
    if (routeJobId === null || appliedRouteRef.current === routeJobId) return;
    if (state.jobs.some((job) => job.id === routeJobId)) {
      appliedRouteRef.current = routeJobId;
      documents.selectJob(routeJobId);
    }
  }, [routeJobId, state.jobs]);

  useEffect(() => {
    const refresh = () => setHandoffHistory(listDocumentHandoffs());
    window.addEventListener(DOCUMENT_HANDOFF_EVENT, refresh);
    return () => window.removeEventListener(DOCUMENT_HANDOFF_EVENT, refresh);
  }, []);

  const importFiles = async (files: ReadonlyArray<File>): Promise<void> => {
    for (const [index, file] of files.entries()) {
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
    documents.setNotice("已刷新阶段能力；OCR 等待视觉模型，Translate / Typeset 可运行本地适配器");
  };

  const runSelectedStage = () => {
    if (selected === undefined) return;
    void runDocumentStage(services, active, selected.id);
  };

  const cancelSelectedStage = () => {
    if (selected === undefined) return;
    void cancelDocumentStage(active.id, selected.id);
  };

  const handoffReader = () => {
    const file = documents.sourceFile(active.id);
    if (file === undefined) {
      documents.setNotice(`${active.name} 的源文件句柄已离开当前标签页，请重新导入后再交给 Reader`);
      void navigate({ to: "/reader" });
      return;
    }
    const handoffId = publishDocumentHandoff({
      jobId: active.id,
      target: "reader",
      name: active.name,
      format: active.format,
      file,
      ...(contentPackage === undefined ? {} : { content: contentPackage }),
    });
    documents.setNotice(`${active.name} 正在交给 Reader Studio；Reader 会接管源文件托管`);
    void navigate({ to: "/reader", search: { document: handoffId } });
  };

  const handoffManga = () => {
    const file = documents.sourceFile(active.id);
    if (file === undefined) {
      documents.setNotice(`${active.name} 的源文件句柄已离开当前标签页，请重新导入后再交给 Manga`);
      void navigate({ to: "/manga" });
      return;
    }
    const handoffId = publishDocumentHandoff({
      jobId: active.id,
      target: "manga",
      name: active.name,
      format: active.format,
      file,
      ...(contentPackage === undefined ? {} : { content: contentPackage }),
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
        accept=".txt,.md,.markdown,.mdown,.html,.htm,.docx,.fb2,.epub,.pdf,.cbz,.png,.jpg,.jpeg,.webp,.avif"
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
            <span>TXT · EPUB · PDF · CBZ · IMAGE</span>
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
                      {record.target === "reader" ? "READER" : "MANGA"}
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
            />
          )}
          {contentPackage !== undefined && contentStats !== undefined && (
            <ContentPackageCard content={contentPackage} stats={contentStats} />
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

function StageInspector(props: {
  stage: DocumentStageState;
  job: DocumentJob;
  onRun: () => void;
  onCancel: () => void;
  canRunStage: boolean;
}) {
  const isPlanned = props.stage.capability === "planned";
  const isDone = props.stage.status === "done";
  const isRunning = props.stage.status === "running";
  const formatBlocked = props.stage.status === "blocked" && props.stage.id === "extract";
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
                ? "由目标适配器处理"
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
      {isPlanned ? (
        <div className="document-inspector-callout">
          <WandSparkles className="document-icon" />
          <span>该阶段会在本地模型 / Manga Studio 适配器就绪后解锁。</span>
        </div>
      ) : formatBlocked ? (
        <div className="document-inspector-callout is-neutral">
          <Link2 className="document-icon" />
          <span>这是二进制出版物；由 Reader / Manga 直接解析，避免把压缩包当作纯文本。</span>
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
