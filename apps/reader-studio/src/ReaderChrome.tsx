import {
  ArrowLeft,
  BookOpen,
  CircleAlert,
  Download,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useRef, type RefObject } from "react";
import { readerAcceptAttribute, type ReaderBook } from "@bcr/reader-core";
import type { ReaderRestoreDiagnostics } from "./runtime";
import { percent } from "./readerPresentation";
import { openSearchHit } from "./readerSearchNavigation";
import { getReaderState, reader, useReader } from "./store";
import { ReaderSheet } from "./ReaderSheet";

export function ReaderUpdateNotice(props: {
  readonly applying: boolean;
  readonly blocked: boolean;
  readonly onApply: () => void;
  readonly onDismiss: () => void;
}) {
  const { applying, blocked, onApply, onDismiss } = props;
  return (
    <section className="reader-update-notice" aria-label="应用更新" role="status">
      <span className="reader-update-mark" aria-hidden="true">
        <RefreshCw className={`reader-icon${applying ? " is-spinning" : ""}`} />
      </span>
      <div className="reader-update-copy">
        <span className="reader-eyebrow">APP UPDATE</span>
        <strong>新版本已准备好</strong>
        <span>
          {blocked
            ? "当前任务完成后即可安全更新。"
            : "更新前会保存阅读进度，刷新后从当前位置继续。"}
        </span>
      </div>
      <div className="reader-update-actions">
        <button type="button" disabled={applying} onClick={onDismiss}>
          稍后
        </button>
        <button
          className="is-primary"
          type="button"
          disabled={applying || blocked}
          onClick={onApply}
        >
          {applying ? "正在保存…" : blocked ? "任务完成后更新" : "立即更新"}
        </button>
      </div>
    </section>
  );
}

export function ReaderRecoveryBanner(props: { recovery: ReaderRestoreDiagnostics }) {
  const { recovery } = props;
  return (
    <section className="reader-recovery-banner" aria-label="书库恢复检查" role="status">
      <div className="reader-recovery-heading">
        <span className="reader-eyebrow">RECOVERY CHECK</span>
        <strong>
          已恢复 {recovery.restoredBooks}/{recovery.attemptedBooks} 本读物
        </strong>
      </div>
      <span className="reader-recovery-copy">
        {recovery.skippedBooks.length} 个出版物无法从本地 Artifact 重建，原有进度不会被覆盖。
      </span>
      <details className="reader-recovery-details">
        <summary>查看恢复问题</summary>
        <ul>
          {recovery.skippedBooks.map((issue) => (
            <li key={issue.bookId}>
              <strong>{issue.name}</strong>
              <span>{issue.reason}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export interface ImportJob {
  readonly total: number;
  readonly completed: number;
  readonly current: string;
  readonly cancelled: boolean;
  readonly settled: boolean;
  readonly errors: number;
  readonly failedFiles: ReadonlyArray<ImportFailure>;
}

export interface ImportFailure {
  readonly file: File;
  readonly error: string;
}

export function BootScreen(props: { error: string | null }) {
  return (
    <div className="reader-boot">
      <div className="reader-boot-card">
        <div className="reader-logo">
          <BookOpen className="reader-icon" />
        </div>
        <div>
          <strong>READER STUDIO</strong>
          <span>
            {props.error === null ? "正在打开本地书库 · OPFS / SQLite / FTS5" : props.error}
          </span>
        </div>
        {props.error !== null && <CircleAlert className="reader-boot-alert" />}
      </div>
    </div>
  );
}

export function ReaderHeader(props: {
  book: ReaderBook;
  searchRef: RefObject<HTMLInputElement | null>;
  onExit: () => void;
  onImport: (files: ReadonlyArray<File>) => void;
  notice: string | null;
  importJob: ImportJob | null;
  onCancelImport: () => void;
  onRetryFailed: () => void;
  onRecoverHandoff?: (() => void) | undefined;
  showInstall: boolean;
  installAvailable: boolean;
  onInstall: () => void;
}) {
  const query = useReader((state) => state.query);
  const searchOpen = useReader((state) => state.searchOpen);
  const searchHits = useReader((state) => state.searchHits);
  const searchActiveIndex = useReader((state) => state.searchActiveIndex);
  const progress = useReader((state) => state.progressByBook[props.book.id]?.percentage ?? 0);
  const fileInput = useRef<HTMLInputElement>(null);
  const onSearch = (value: string) => {
    reader.setSearchOpen(true);
    // The query is kept in the external store so the search panel and header
    // share the same source of truth without prop drilling.
    reader.setSearch(value, getReaderState().searchHits, getReaderState().searchBookId);
  };
  return (
    <header className={`reader-header ${searchOpen ? "is-searching" : ""}`}>
      <button
        type="button"
        className="reader-icon-button reader-mobile-exit"
        onClick={props.onExit}
        aria-label="返回工作区主页"
        title="返回工作区主页"
      >
        <ArrowLeft className="reader-icon" />
      </button>
      <div className="reader-brand">
        <div className="reader-brand-mark">
          <BookOpen className="reader-icon" />
        </div>
        <div>
          <div className="reader-brand-title">
            Reader <span>Studio</span>
          </div>
          <div className="reader-brand-subtitle">LOCAL PUBLICATION SPACE</div>
        </div>
      </div>
      <div className="reader-header-divider" />
      <div className="reader-now-reading">
        <span className="reader-eyebrow">NOW READING</span>
        <strong>{props.book.title}</strong>
      </div>
      <div className="reader-header-spacer" />
      <div className={`reader-search ${searchOpen ? "is-open" : ""}`}>
        <Search className="reader-icon" />
        <input
          ref={props.searchRef}
          value={query}
          onChange={(event) => onSearch(event.target.value)}
          onFocus={() => reader.setSearchOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              reader.moveSearch(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              reader.moveSearch(-1);
            } else if (event.key === "Enter") {
              const hit = searchHits[searchActiveIndex];
              if (hit !== undefined) {
                event.preventDefault();
                openSearchHit(hit);
              }
            }
          }}
          placeholder="在书库中搜索…"
          aria-label="在书库中搜索"
          role="combobox"
          aria-expanded={searchOpen}
          aria-controls={searchOpen ? "reader-search-results" : undefined}
          aria-activedescendant={
            searchOpen && searchActiveIndex >= 0
              ? `reader-search-hit-${searchActiveIndex}`
              : undefined
          }
        />
        {query && (
          <button
            type="button"
            className="reader-icon-button reader-search-clear"
            onClick={() => onSearch("")}
            aria-label="清空搜索"
          >
            <X className="reader-icon" />
          </button>
        )}
        <kbd>⌘F</kbd>
        <button
          type="button"
          className="reader-icon-button reader-mobile-search-close"
          aria-label="退出搜索"
          onClick={() => reader.setSearchOpen(false)}
        >
          <X className="reader-icon" />
        </button>
      </div>
      <div className="reader-header-progress" title={`当前进度 ${percent(progress)}`}>
        <div className="reader-progress-ring">
          <span>{percent(progress)}</span>
        </div>
      </div>
      {props.showInstall && (
        <button
          type="button"
          className="reader-button reader-install-button"
          onClick={props.onInstall}
          aria-label={props.installAvailable ? "安装 Reader 应用" : "查看 Reader 安装方式"}
          title={props.installAvailable ? "安装 Reader 应用" : "查看 Reader 安装方式"}
        >
          <Download className="reader-icon" />
          <span>安装</span>
        </button>
      )}
      <input
        ref={fileInput}
        className="reader-visually-hidden"
        type="file"
        multiple
        accept={readerAcceptAttribute()}
        aria-label="导入阅读文件"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          props.onImport(files);
        }}
      />
      <button
        type="button"
        className="reader-button reader-button-primary"
        onClick={() => fileInput.current?.click()}
      >
        <Upload className="reader-icon" /> <span>导入</span>
      </button>
      {props.notice !== null && props.importJob === null && (
        <div className="reader-toast" role="status" aria-live="polite">
          <span>{props.notice}</span>
          {props.onRecoverHandoff !== undefined && (
            <button type="button" onClick={props.onRecoverHandoff}>
              打开 Document
            </button>
          )}
        </div>
      )}
      {props.importJob !== null && (
        <div className="reader-import-progress" role="status" aria-live="polite">
          <div className="reader-import-progress-copy">
            <strong>
              {props.importJob.cancelled
                ? "导入已取消"
                : props.importJob.settled
                  ? props.importJob.errors > 0
                    ? `导入完成 · ${props.importJob.errors} 个失败`
                    : "导入完成"
                  : "正在导入"}
            </strong>
            <span>
              {props.importJob.current || `${props.importJob.completed}/${props.importJob.total}`}
            </span>
          </div>
          <progress
            max={props.importJob.total}
            value={props.importJob.completed}
            aria-label="导入进度"
          />
          {!props.importJob.cancelled && !props.importJob.settled && (
            <button type="button" className="reader-import-cancel" onClick={props.onCancelImport}>
              取消
            </button>
          )}
          {props.importJob.settled && props.importJob.failedFiles.length > 0 && (
            <>
              <div className="reader-import-errors" role="alert">
                {props.importJob.failedFiles.slice(0, 3).map((failure) => (
                  <span key={`${failure.file.name}:${failure.error}`}>
                    {failure.file.name}：{failure.error}
                  </span>
                ))}
              </div>
              <button type="button" className="reader-import-retry" onClick={props.onRetryFailed}>
                {props.importJob.cancelled ? "继续导入" : "重试失败"} (
                {props.importJob.failedFiles.length})
              </button>
            </>
          )}
        </div>
      )}
    </header>
  );
}

export function ReaderInstallHelp(props: { open: boolean; isIos: boolean; onClose: () => void }) {
  if (!props.open) return null;
  const steps = props.isIos
    ? ["点击浏览器的分享按钮", "选择“添加到主屏幕”", "确认添加，从主屏幕打开 Reader"]
    : ["打开浏览器菜单", "选择“安装应用”或“添加到主屏幕”", "确认后从主屏幕启动 Reader"];
  return (
    <ReaderSheet
      onClose={props.onClose}
      labelId="reader-install-title"
      className="reader-install-layer"
    >
      <section
        className="reader-install-card"
        aria-labelledby="reader-install-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="reader-install-card-heading">
          <div>
            <span className="reader-eyebrow">READ ON THE GO</span>
            <strong id="reader-install-title">把 Reader 放到手机桌面</strong>
          </div>
          <button
            type="button"
            className="reader-icon-button"
            onClick={props.onClose}
            aria-label="关闭安装说明"
          >
            <X className="reader-icon" />
          </button>
        </div>
        <p>安装后可以从桌面直接打开本地书库，阅读界面会进入更专注的独立窗口。</p>
        <ol>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <button
          type="button"
          className="reader-button reader-button-primary"
          onClick={props.onClose}
        >
          知道了
        </button>
      </section>
    </ReaderSheet>
  );
}
