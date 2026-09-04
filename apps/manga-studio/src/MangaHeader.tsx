import { ArrowUpRight, FileText, FileUp, ListChecks, PanelRight, Play, Square } from "lucide-react";
import type { RefObject } from "react";
import { cancelMangaPipeline, cancelMangaQueue } from "./pipeline";
import type { MangaState } from "./model";
import { sourceLabel } from "./mangaPresentation";

interface MangaHeaderProps {
  readonly state: MangaState;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly mobileToolsOpen: boolean;
  readonly batchRunning: boolean;
  readonly batchPaused: boolean;
  readonly batchError: boolean;
  readonly documentHandoffBusy: boolean;
  readonly pendingPages: number;
  readonly resumableCurrentPage: boolean;
  readonly onOpenTools: () => void;
  readonly onImportFiles: (files: ReadonlyArray<File>) => void;
  readonly onHandoffDocument: () => void;
  readonly onRunPage: () => void;
  readonly onRunQueue: () => void;
}

export function MangaHeader({
  state,
  fileInputRef,
  mobileToolsOpen,
  batchRunning,
  batchPaused,
  batchError,
  documentHandoffBusy,
  pendingPages,
  resumableCurrentPage,
  onOpenTools,
  onImportFiles,
  onHandoffDocument,
  onRunPage,
  onRunQueue,
}: MangaHeaderProps) {
  return (
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
          className="manga-button manga-button-secondary manga-mobile-tools-button"
          onClick={onOpenTools}
          aria-expanded={mobileToolsOpen}
          aria-controls="manga-mobile-tools-panel"
        >
          <PanelRight className="size-4" />
          工具
        </button>
        <button
          type="button"
          className="manga-button manga-button-secondary"
          disabled={state.running || batchRunning || documentHandoffBusy}
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp className="size-4" />
          导入文件
        </button>
        <button
          type="button"
          className="manga-button manga-button-secondary"
          disabled={
            state.running || batchRunning || documentHandoffBusy || state.source.ref === undefined
          }
          onClick={onHandoffDocument}
          aria-label="交给 Document Studio"
          title={state.source.ref === undefined ? "请先导入原始图片" : "交给 Document Studio"}
        >
          <FileText className="size-4" />
          {documentHandoffBusy ? "交接中…" : "交给 Document"}
          <ArrowUpRight className="size-3.5" />
        </button>
        {batchRunning ? (
          <button
            type="button"
            className="manga-button manga-button-danger"
            onClick={cancelMangaQueue}
          >
            <Square className="size-3.5" />
            暂停队列
          </button>
        ) : state.running ? (
          <button
            type="button"
            className="manga-button manga-button-danger"
            onClick={cancelMangaPipeline}
          >
            <Square className="size-3.5" />
            停止处理
          </button>
        ) : (
          <button type="button" className="manga-button manga-button-primary" onClick={onRunPage}>
            <Play className="size-4" />
            {resumableCurrentPage ? "继续当前页" : "翻译当前页"}
          </button>
        )}
        {state.pages.length > 1 &&
          !state.running &&
          !batchRunning &&
          (pendingPages > 0 || batchPaused || batchError) && (
            <button
              type="button"
              className="manga-button manga-button-secondary"
              onClick={onRunQueue}
            >
              <ListChecks className="size-4" />
              {batchPaused ? "继续队列" : batchError ? "重试队列" : "处理队列"}
            </button>
          )}
        <input
          ref={fileInputRef}
          type="file"
          aria-label="导入漫画图片或压缩包"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,application/vnd.comicbook+zip,application/zip,application/json,.pdf,.cbz,.zip,.json"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            if (files.length > 0) onImportFiles(files);
            event.currentTarget.value = "";
          }}
        />
      </div>
    </header>
  );
}
