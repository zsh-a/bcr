import {
  Check,
  ChevronRight,
  CircleAlert,
  FileArchive,
  FileCode2,
  FileImage,
  FileText,
  Layers3,
  Link2,
  Play,
  ScanText,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import {
  documentOcrSettings,
  formatLabel,
  type DocumentCapability,
  type DocumentContentPackage,
  type DocumentContentStats,
  type DocumentFormat,
  type DocumentJob,
  type DocumentOcrAdapter,
  type DocumentOcrDevice,
  type DocumentOcrLanguage,
  type DocumentOcrSettings,
  type DocumentStageState,
  type DocumentTranslationPackage,
  type DocumentTranslationStats,
} from "@bcr/document-core";

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return "—";
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(1)} s`;
}

export function sourceIcon(format: DocumentFormat) {
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

export function ContentPackageCard(props: {
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

export function TranslationPackageCard(props: {
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

export function DocumentBlockContextCard(props: {
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

export function DocumentOcrReviewCard(props: {
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

export function TranslationReviewCard(props: {
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

export function JobCard(props: {
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

export function StageCard(props: {
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

export function StageInspector(props: {
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
