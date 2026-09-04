import { ChevronRight, Menu, PanelLeftClose, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  readerAcceptAttribute,
  type ReaderBook,
  type ReaderLocator,
  type SearchHit,
} from "@bcr/reader-core";
import { activeBook } from "./model";
import { AnnotationComposer, ReaderToolbar } from "./ReaderControls";
import { ReadingView } from "./ReadingView";
import { formatBadge, formatBytes, percent, sourceIcon } from "./readerPresentation";
import { readerSelectionLocator } from "./readingPosition";
import { openSearchHit } from "./readerSearchNavigation";
import type { ReaderRuntime } from "./runtime";
import { reader, useReader } from "./store";
import { useReaderFullscreen } from "./useReaderPlatform";
import { persistReaderSnapshot } from "./useReaderRuntime";

export function ReaderWorkspace(props: {
  runtime: ReaderRuntime;
  onImport: (files: ReadonlyArray<File>) => void;
  onOpenDocument: () => void;
  documentHandoffBusy: boolean;
  onNotice: (message: string) => void;
  onToggleMobileChrome: () => void;
}) {
  const sidebarOpen = useReader((state) => state.sidebarOpen);
  const searchOpen = useReader((state) => state.searchOpen);
  const settings = useReader((state) => state.settings);
  const active = useReader((state) => activeBook(state));
  const query = useReader((state) => state.query);
  const searchHits = useReader((state) => state.searchHits);
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [annotationLocator, setAnnotationLocator] = useState<ReaderLocator | null>(null);
  const readerMainRef = useRef<HTMLElement>(null);
  const fullscreen = useReaderFullscreen(readerMainRef, props.onNotice);
  if (active === undefined) return null;
  const openAnnotationComposer = () => {
    setAnnotationDraft("");
    setAnnotationLocator(readerSelectionLocator(active) ?? null);
    setAnnotationOpen(true);
  };
  const submitAnnotation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (annotationDraft.trim().length === 0) return;
    reader.addAnnotation(annotationDraft, annotationLocator ?? undefined);
    setAnnotationDraft("");
    setAnnotationLocator(null);
    setAnnotationOpen(false);
  };
  return (
    <div className={`reader-workspace ${sidebarOpen ? "sidebar-visible" : "sidebar-hidden"}`}>
      <aside className="reader-sidebar" aria-label="本地书库">
        <LibraryPanel runtime={props.runtime} onImport={props.onImport} />
      </aside>
      {sidebarOpen && (
        <button
          type="button"
          className="reader-sidebar-scrim"
          aria-label="关闭书库"
          onClick={() => reader.toggleSidebar()}
        />
      )}
      <main id="reader-content" ref={readerMainRef} className="reader-main" aria-label="阅读内容">
        <button
          type="button"
          className="reader-mobile-chrome-reveal"
          onClick={props.onToggleMobileChrome}
          aria-label="显示阅读工具栏"
          title="显示阅读工具栏"
        >
          <Menu className="reader-icon" />
        </button>
        {searchOpen && query.length > 0 && <SearchPanel hits={searchHits} />}
        <ReaderToolbar
          book={active}
          settings={settings}
          onAddAnnotation={openAnnotationComposer}
          onOpenDocument={props.onOpenDocument}
          documentHandoffBusy={props.documentHandoffBusy}
          fullscreen={fullscreen}
        />
        {annotationOpen && (
          <AnnotationComposer
            value={annotationDraft}
            onChange={setAnnotationDraft}
            anchor={annotationLocator}
            onCancel={() => {
              setAnnotationLocator(null);
              setAnnotationOpen(false);
            }}
            onSubmit={submitAnnotation}
          />
        )}
        <ReadingView
          runtime={props.runtime}
          book={active}
          onToggleMobileChrome={props.onToggleMobileChrome}
        />
      </main>
    </div>
  );
}

function LibraryPanel(props: {
  runtime: ReaderRuntime;
  onImport: (files: ReadonlyArray<File>) => void;
}) {
  const library = useReader((state) => state.library);
  const activeBookId = useReader((state) => state.activeBookId);
  const progressByBook = useReader((state) => state.progressByBook);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [sortMode, setSortMode] = useState<LibrarySortMode>("recent");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const sortedLibrary = [...library].sort((left, right) => {
    if (sortMode === "title") return left.title.localeCompare(right.title, "zh-CN");
    if (sortMode === "progress") {
      return (
        (progressByBook[right.id]?.percentage ?? 0) - (progressByBook[left.id]?.percentage ?? 0)
      );
    }
    return (
      (progressByBook[right.id]?.updatedAt ?? right.updatedAt) -
      (progressByBook[left.id]?.updatedAt ?? left.updatedAt)
    );
  });
  return (
    <div className="reader-library-panel">
      <div className="reader-sidebar-heading">
        <div>
          <span className="reader-eyebrow">YOUR LIBRARY</span>
          <strong>{library.length} 本读物</strong>
        </div>
        <button
          type="button"
          className="reader-icon-button"
          onClick={() => reader.toggleSidebar()}
          aria-label="收起书库"
        >
          <PanelLeftClose className="reader-icon" />
        </button>
      </div>
      <div className="reader-library-toolbar">
        <span className="reader-eyebrow">SORT BY</span>
        <select
          aria-label="书库排序"
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as LibrarySortMode)}
        >
          <option value="recent">最近阅读</option>
          <option value="title">标题</option>
          <option value="progress">阅读进度</option>
        </select>
      </div>
      <div
        className={`reader-dropzone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          props.onImport([...event.dataTransfer.files]);
        }}
      >
        <Upload className="reader-dropzone-icon" />
        <span>拖入文件到这里</span>
        <small>TXT · MD · HTML · DOCX · EPUB · PDF · CBZ</small>
      </div>
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
        className="reader-library-add"
        onClick={() => fileInput.current?.click()}
      >
        <Plus className="reader-icon" /> 添加本地读物
      </button>
      <div className="reader-library-list">
        {sortedLibrary.map((book) => (
          <LibraryBookCard
            key={book.id}
            book={book}
            active={book.id === activeBookId}
            progress={progressByBook[book.id]?.percentage ?? 0}
            confirming={confirmingId === book.id}
            onRemove={() => setConfirmingId(book.id)}
            onConfirmRemove={() => {
              props.runtime.indexSession?.removeBook(book.id);
              reader.removeBook(book.id);
              void persistReaderSnapshot(props.runtime, { durableLibrary: true });
              setConfirmingId(null);
            }}
            onCancelRemove={() => setConfirmingId(null)}
          />
        ))}
      </div>
      <div className="reader-sidebar-footer">
        <span>
          <span className="reader-live-dot" /> LOCAL ONLY
        </span>
        <span>
          OPFS · FTS5 · {props.runtime.parserMode === "worker" ? "PARSER WORKER" : "PARSER MAIN"}
        </span>
      </div>
    </div>
  );
}

type LibrarySortMode = "recent" | "title" | "progress";

function LibraryBookCard(props: {
  book: ReaderBook;
  active: boolean;
  progress: number;
  confirming: boolean;
  onRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}) {
  return (
    <div className="reader-book-entry">
      <button
        type="button"
        className={`reader-book-card ${props.active ? "is-active" : ""}`}
        onClick={() => reader.openBook(props.book.id)}
        aria-current={props.active ? "page" : undefined}
      >
        <div className={`reader-book-cover reader-cover-${props.book.source.format}`}>
          {props.book.coverUrl ? (
            <img src={props.book.coverUrl} alt="" />
          ) : (
            <>
              {sourceIcon(props.book.source.format)}
              <span>{formatBadge(props.book.source.format)}</span>
            </>
          )}
        </div>
        <div className="reader-book-card-copy">
          <strong>{props.book.title}</strong>
          <span>{props.book.author ?? "本地文档"}</span>
          <div className="reader-book-meta">
            <span>{formatBadge(props.book.source.format)}</span>
            <span>
              {formatBytes(props.book.source.size)} ·{" "}
              {props.progress > 0 ? `${percent(props.progress)} · 继续阅读` : "未开始"}
            </span>
          </div>
          <div className="reader-book-progress">
            <span style={{ width: `${Math.round(props.progress * 100)}%` }} />
          </div>
        </div>
        {props.active && <ChevronRight className="reader-book-active-icon" />}
      </button>
      <button
        type="button"
        className="reader-book-remove"
        aria-label={`移除 ${props.book.title}`}
        onClick={props.onRemove}
      >
        <Trash2 className="reader-icon" />
      </button>
      {props.confirming && (
        <div className="reader-book-confirm" role="alert">
          <span>从本地书库移除？</span>
          <div>
            <button type="button" onClick={props.onConfirmRemove}>
              确认
            </button>
            <button type="button" onClick={props.onCancelRemove}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchPanel(props: { hits: ReadonlyArray<SearchHit> }) {
  const library = useReader((state) => state.library);
  const query = useReader((state) => state.query);
  const searchBusy = useReader((state) => state.searchBusy);
  const searchActiveIndex = useReader((state) => state.searchActiveIndex);
  const activeResultRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeResultRef.current?.scrollIntoView({ block: "nearest" });
  }, [searchActiveIndex]);
  return (
    <section className="reader-search-panel" aria-label="搜索结果">
      <div className="reader-search-panel-top">
        <div>
          <span className="reader-eyebrow">SEARCH</span>
          <strong>{searchBusy ? "正在索引…" : `${props.hits.length} 个命中`}</strong>
        </div>
        <span className="reader-search-query">
          “{query}” · {library.length} 本读物
        </span>
        <button
          type="button"
          className="reader-icon-button"
          onClick={() => reader.setSearchOpen(false)}
          aria-label="关闭搜索结果"
        >
          <X className="reader-icon" />
        </button>
      </div>
      {props.hits.length === 0 && !searchBusy && (
        <div className="reader-search-empty">
          <Search className="reader-icon" />
          没有找到匹配内容，试试更短的关键词。
        </div>
      )}
      <div id="reader-search-results" className="reader-search-results" role="listbox">
        {props.hits.map((hit, index) => (
          <button
            type="button"
            ref={index === searchActiveIndex ? activeResultRef : undefined}
            id={`reader-search-hit-${index}`}
            role="option"
            aria-selected={index === searchActiveIndex}
            className={`reader-search-result ${index === searchActiveIndex ? "is-active" : ""}`}
            key={`${hit.bookId}-${hit.sectionId}-${index}`}
            onMouseEnter={() => reader.setSearchActiveIndex(index)}
            onClick={() => openSearchHit(hit, index)}
          >
            <span className="reader-search-result-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="reader-search-result-copy">
              <strong>{library.find((book) => book.id === hit.bookId)?.title ?? "未知读物"}</strong>
              <span>{hit.label}</span>
              <em>{hit.snippet}</em>
            </span>
            <ChevronRight className="reader-icon" />
          </button>
        ))}
      </div>
    </section>
  );
}
