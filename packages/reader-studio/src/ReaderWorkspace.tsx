import {
  Check,
  ChevronRight,
  Menu,
  PanelLeftClose,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import {
  readerAcceptAttribute,
  type ReaderBook,
  type ReaderLocator,
  type SearchHit,
} from "@bcr/reader-core";
import { activeBook, readerUsesPagedText, readingStatus, type ReaderReadingStatus } from "./model";
import { AnnotationComposer, ReaderToolbar } from "./ReaderControls";
import { ReadingView } from "./ReadingView";
import { formatBadge, formatBytes, percent, sourceIcon } from "./readerPresentation";
import { loadReaderSelection } from "./readingPosition";
import { openSearchHit } from "./readerSearchNavigation";
import type { ReaderRuntime } from "./runtime";
import { reader, useReader } from "./store";
import { useReaderFullscreen } from "./useReaderPlatform";
import { persistReaderSnapshot } from "./useReaderRuntime";
import { ReaderSheet } from "./ReaderSheet";
import { useReaderMobile } from "./useReaderMobile";
import { ReaderHistoryBar } from "./ReaderHistoryBar";
import { ReaderProgressScrubber } from "./ReaderProgressScrubber";
import { ReaderSelectionCapture } from "./ReaderSelectionCapture";
import { ReaderLibraryBookActions } from "./ReaderLibraryBookActions";

const ReaderBackupPanel = lazy(() =>
  import("./ReaderBackupPanel").then((module) => ({ default: module.ReaderBackupPanel })),
);

export function ReaderWorkspace(props: {
  workspaceCollections: boolean;
  runtime: ReaderRuntime;
  onImport: (files: ReadonlyArray<File>) => void;
  onOpenDocument: () => void;
  documentHandoffBusy: boolean;
  onNotice: (message: string) => void;
  onToggleMobileChrome: () => void;
  onInstall: () => void;
  showInstall: boolean;
}) {
  const mobile = useReaderMobile();
  const sidebarOpen = useReader((state) => state.sidebarOpen);
  const searchOpen = useReader((state) => state.searchOpen);
  const settings = useReader((state) => state.settings);
  const active = useReader((state) => activeBook(state));
  const searchHits = useReader((state) => state.searchHits);
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [annotationLocator, setAnnotationLocator] = useState<ReaderLocator | null>(null);
  const readerMainRef = useRef<HTMLElement>(null);
  const fullscreen = useReaderFullscreen(readerMainRef, props.onNotice);
  if (active === undefined) return null;
  const openAnnotationComposer = async (selected?: ReaderLocator) => {
    const result = selected
      ? { value: selected }
      : await loadReaderSelection(active, (locator) => locator);
    if (result.error) {
      props.onNotice(result.error);
      return;
    }
    setAnnotationDraft("");
    setAnnotationLocator(result.value ?? null);
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
      {!mobile && (
        <aside className="reader-sidebar" aria-label="本地书库">
          {sidebarOpen && <LibraryPanel runtime={props.runtime} onImport={props.onImport} />}
        </aside>
      )}
      {mobile && (
        <ReaderSheet
          open={sidebarOpen}
          labelId="reader-library-title"
          onClose={() => reader.toggleSidebar()}
        >
          <section className="reader-mobile-sheet reader-library-sheet">
            <LibraryPanel runtime={props.runtime} onImport={props.onImport} />
          </section>
        </ReaderSheet>
      )}
      <main id="reader-content" ref={readerMainRef} className="reader-main" aria-label="阅读内容">
        {!readerUsesPagedText(active, settings) && (
          <button
            type="button"
            className="reader-mobile-chrome-reveal"
            onClick={props.onToggleMobileChrome}
            aria-label="显示阅读工具栏"
            title="显示阅读工具栏"
          >
            <Menu className="reader-icon" />
          </button>
        )}
        {searchOpen && <SearchPanel hits={searchHits} />}
        <ReaderToolbar
          book={active}
          settings={active.source.format === "pdf" ? { ...settings, layout: "scroll" } : settings}
          onAddAnnotation={openAnnotationComposer}
          onOpenDocument={props.onOpenDocument}
          documentHandoffBusy={props.documentHandoffBusy}
          fullscreen={fullscreen}
          onInstall={props.onInstall}
          showInstall={props.showInstall}
          onFocusReading={props.onToggleMobileChrome}
        />
        <ReaderSaveNotice runtime={props.runtime} />
        <ReaderSelectionCapture
          book={active}
          runtime={props.runtime}
          onNotice={props.onNotice}
          workspaceCollections={props.workspaceCollections}
        />
        <AnnotationComposer
          open={annotationOpen}
          value={annotationDraft}
          onChange={setAnnotationDraft}
          anchor={annotationLocator}
          onCancel={() => {
            setAnnotationLocator(null);
            setAnnotationOpen(false);
          }}
          onSubmit={submitAnnotation}
        />
        <ReaderProgressScrubber book={active} />
        <ReadingView
          runtime={props.runtime}
          book={active}
          onToggleMobileChrome={props.onToggleMobileChrome}
          onImport={props.onImport}
        />
        {(settings.books?.[active.id]?.comic ??
          (active.source.format === "cbz" || active.rendition?.layout === "pre-paginated")) && (
          <ReaderHistoryBar />
        )}
      </main>
    </div>
  );
}

function ReaderSaveNotice(props: { runtime: ReaderRuntime }) {
  const error = useReader((state) => state.saveError);
  const [busy, setBusy] = useState(false);
  if (error === null) return null;
  return (
    <div className="reader-save-notice" role="alert">
      <span>尚未保存：{error}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void persistReaderSnapshot(props.runtime, { durableLibrary: true }).finally(() =>
            setBusy(false),
          );
        }}
      >
        {busy ? "保存中…" : "重试保存"}
      </button>
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
  const [filter, setFilter] = useState<ReaderReadingStatus | "all">("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [titleFilter, setTitleFilter] = useState("");
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [batchConfirm, setBatchConfirm] = useState(false);
  const sourceErrors = useReader((state) => state.sourceErrorsByBook);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const sortedLibrary = library
    .filter(
      (book) =>
        (filter === "all" || readingStatus(progressByBook[book.id]?.percentage) === filter) &&
        (!favoritesOnly || book.favorite) &&
        `${book.title}\n${book.author ?? ""}`
          .toLocaleLowerCase()
          .includes(titleFilter.trim().toLocaleLowerCase()),
    )
    .sort((left, right) => {
      if (sortMode === "title") return left.title.localeCompare(right.title, "zh-CN");
      if (sortMode === "imported") return right.importedAt - left.importedAt;
      if (sortMode === "favorite") {
        const difference = Number(Boolean(right.favorite)) - Number(Boolean(left.favorite));
        if (difference) return difference;
      }
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
  const selectedBooks = library.filter((book) => selected.has(book.id));
  const toggleSelection = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="reader-library-panel">
      <div className="reader-sidebar-heading">
        <div>
          <span className="ui-section-label">YOUR LIBRARY</span>
          <strong id="reader-library-title">{library.length} 本读物</strong>
        </div>
        <button
          type="button"
          className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
          onClick={() => reader.toggleSidebar()}
          aria-label="收起书库"
        >
          <PanelLeftClose className="reader-icon" />
        </button>
      </div>
      <input
        className="reader-library-filter"
        type="search"
        aria-label="筛选书名或作者"
        placeholder="筛选书名或作者…"
        value={titleFilter}
        onChange={(event) => setTitleFilter(event.target.value)}
      />
      <div className="reader-library-toolbar">
        <select
          aria-label="阅读状态筛选"
          value={filter}
          onChange={(event) => setFilter(event.target.value as ReaderReadingStatus | "all")}
        >
          <option value="all">全部读物</option>
          <option value="unread">未读</option>
          <option value="reading">在读</option>
          <option value="finished">读完</option>
        </select>
        <span className="ui-section-label">SORT BY</span>
        <select
          aria-label="书库排序"
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as LibrarySortMode)}
        >
          <option value="recent">最近阅读</option>
          <option value="title">标题</option>
          <option value="progress">阅读进度</option>
          <option value="imported">最近添加</option>
          <option value="favorite">收藏优先</option>
        </select>
      </div>
      <div className="reader-library-management">
        <label>
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(event) => setFavoritesOnly(event.target.checked)}
          />
          仅收藏
        </label>
        <button
          type="button"
          className="ui-btn ui-btn-default"
          aria-pressed={managing}
          onClick={() => {
            setManaging(!managing);
            setSelected(new Set());
            setConfirmingId(null);
          }}
        >
          {managing ? "完成管理" : "管理书库"}
        </button>
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
        className="ui-sr-only"
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
      <button type="button" className="reader-library-add" onClick={() => setBackupOpen(true)}>
        备份与恢复
      </button>
      <Suspense fallback={backupOpen ? <p role="status">正在打开备份工具…</p> : null}>
        <ReaderBackupPanel
          open={backupOpen}
          runtime={props.runtime}
          onClose={() => setBackupOpen(false)}
        />
      </Suspense>
      {managing && (
        <div className="reader-library-batch">
          <span role="status">已选择 {selectedBooks.length} 本</span>
          <button
            type="button"
            className="ui-btn ui-btn-default"
            disabled={!sortedLibrary.length}
            onClick={() =>
              setSelected(
                (current) => new Set([...current, ...sortedLibrary.map((book) => book.id)]),
              )
            }
          >
            选择当前列表
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-default"
            disabled={!selectedBooks.length}
            onClick={() => setSelected(new Set())}
          >
            取消选择
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-default"
            disabled={!selectedBooks.length}
            onClick={() => setBatchConfirm(true)}
          >
            移除所选…
          </button>
        </div>
      )}
      <ReaderSheet
        open={batchConfirm}
        labelId="reader-batch-remove-title"
        onClose={() => setBatchConfirm(false)}
      >
        <section className="reader-mobile-sheet reader-data-sheet">
          <header className="reader-data-heading">
            <h2 id="reader-batch-remove-title">移除 {selectedBooks.length} 本读物？</h2>
            <button
              type="button"
              className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
              aria-label="关闭批量移除"
              onClick={() => setBatchConfirm(false)}
            >
              <X className="reader-icon" />
            </button>
          </header>
          <p>将从本机书库移除以下读物，以及它们的阅读进度、书签和笔记。</p>
          <ul className="reader-batch-remove-list">
            {selectedBooks.map((book) => (
              <li key={book.id}>{book.title}</li>
            ))}
          </ul>
          <div className="reader-data-actions">
            <button
              type="button"
              className="ui-btn ui-btn-lg ui-btn-default"
              onClick={() => setBatchConfirm(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-lg ui-btn-primary"
              disabled={!selectedBooks.length}
              onClick={() => {
                for (const book of selectedBooks) props.runtime.indexSession?.removeBook(book.id);
                reader.removeBooks(selectedBooks.map((book) => book.id));
                void persistReaderSnapshot(props.runtime, { durableLibrary: true });
                setSelected(new Set());
                setBatchConfirm(false);
              }}
            >
              确认移除所选读物
            </button>
          </div>
        </section>
      </ReaderSheet>
      <div className="reader-library-list">
        {sortedLibrary.map((book) => (
          <LibraryBookCard
            key={book.id}
            book={book}
            active={book.id === activeBookId}
            progress={progressByBook[book.id]?.percentage ?? 0}
            favorite={book.favorite ?? false}
            managing={managing}
            selected={selected.has(book.id)}
            onSelect={() => toggleSelection(book.id)}
            missingSource={
              Boolean(sourceErrors[book.id]) ||
              (book.source.format === "pdf" && !book.source.ref && !book.source.objectUrl)
            }
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
        {sortedLibrary.length === 0 && <p role="status">此分类还没有读物。</p>}
      </div>
      <div className="reader-sidebar-footer">
        <span>
          <span className="ui-dot ui-dot-running" /> LOCAL ONLY
        </span>
        <span>
          OPFS · FTS5 · {props.runtime.parserMode === "worker" ? "PARSER WORKER" : "PARSER MAIN"}
        </span>
      </div>
      <a className="reader-library-home ui-btn ui-btn-lg ui-btn-default" href="/">
        返回工作区主页
      </a>
    </div>
  );
}

type LibrarySortMode = "recent" | "title" | "progress" | "imported" | "favorite";

function LibraryBookCard(props: {
  book: ReaderBook;
  active: boolean;
  progress: number;
  favorite: boolean;
  managing: boolean;
  selected: boolean;
  onSelect: () => void;
  missingSource: boolean;
  confirming: boolean;
  onRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}) {
  return (
    <div className="reader-book-entry">
      <button
        type="button"
        className={`reader-book-card ${props.active ? "is-active" : ""} ${props.managing ? "is-managing" : ""} ${props.selected ? "is-selected" : ""}`}
        onClick={() => {
          if (props.managing) {
            props.onSelect();
            return;
          }
          reader.openBook(props.book.id);
          if (window.matchMedia("(max-width: 860px)").matches) reader.toggleSidebar();
        }}
        aria-current={props.active ? "page" : undefined}
        aria-pressed={props.managing ? props.selected : undefined}
        aria-label={props.managing ? `选择 ${props.book.title}` : undefined}
      >
        {props.managing && (
          <span className="reader-book-selection" aria-hidden="true">
            {props.selected && <Check className="reader-icon" />}
          </span>
        )}
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
          <strong>
            {props.favorite && (
              <Star className="reader-book-favorite" fill="currentColor" aria-label="已收藏" />
            )}
            {props.book.title}
          </strong>
          {props.book.tags.includes("DEMO") && <small>示例读物 · 可从右上角导入你的文件</small>}
          {props.missingSource && <small role="status">缺少源文件 · 请重新导入</small>}
          <span>{props.book.author ?? "本地文档"}</span>
          <div className="reader-book-meta">
            <span>{formatBadge(props.book.source.format)}</span>
            <span>
              {formatBytes(props.book.source.size)} ·{" "}
              {readingStatus(props.progress) === "finished"
                ? "100% · 已读完"
                : props.progress > 0
                  ? `${percent(props.progress)} · 在读`
                  : "未读"}
            </span>
          </div>
          <div className="reader-book-progress">
            <span style={{ width: `${Math.round(props.progress * 100)}%` }} />
          </div>
        </div>
        {props.active && <ChevronRight className="reader-book-active-icon" />}
      </button>
      {!props.managing && (
        <>
          <button
            type="button"
            className="reader-book-remove"
            aria-label={`移除 ${props.book.title}`}
            onClick={props.onRemove}
          >
            <Trash2 className="reader-icon" />
          </button>
          <ReaderLibraryBookActions
            book={props.book}
            favorite={props.favorite}
            onRemove={props.onRemove}
          />
        </>
      )}
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
  const scope = useReader((state) => state.searchScope);
  const searchBusy = useReader((state) => state.searchBusy);
  const searchError = useReader((state) => state.searchError);
  const searchTruncated = useReader((state) => state.searchTruncated);
  const searchActiveIndex = useReader((state) => state.searchActiveIndex);
  const activeResultRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeResultRef.current?.scrollIntoView({ block: "nearest" });
  }, [searchActiveIndex]);
  return (
    <section className="reader-search-panel" aria-label="搜索结果">
      <div className="reader-search-panel-top">
        <div>
          <span className="ui-section-label">SEARCH</span>
          <strong>
            {searchBusy
              ? "正在搜索…"
              : searchError
                ? "搜索遇到问题"
                : `${props.hits.length} 个命中${searchTruncated ? " · 已截断" : ""}`}
          </strong>
        </div>
        <span className="reader-search-query">{query ? `“${query}”` : "输入关键词查找原文"}</span>
        <button
          type="button"
          className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
          onClick={() => reader.setSearchOpen(false)}
          aria-label="关闭搜索结果"
        >
          <X className="reader-icon" />
        </button>
      </div>
      <div className="reader-search-scope" role="group" aria-label="搜索范围">
        <button
          type="button"
          aria-pressed={scope === "book"}
          onClick={() => reader.setSearchScope("book")}
        >
          当前读物
        </button>
        <button
          type="button"
          aria-pressed={scope === "library"}
          onClick={() => reader.setSearchScope("library")}
        >
          整个书库 · {library.length}
        </button>
        {searchTruncated && (
          <small>
            {scope === "library"
              ? "显示 80 次出现，已按读物分配结果；请缩小范围或细化关键词。"
              : "显示前 80 次出现，请缩小范围或细化关键词。"}
          </small>
        )}
      </div>
      {searchError && (
        <div className="reader-search-empty" role="alert">
          <span>{searchError}</span>
          <button type="button" onClick={() => reader.retrySearch()}>
            重试搜索
          </button>
        </div>
      )}
      {props.hits.length === 0 && !searchBusy && !searchError && (
        <div className="reader-search-empty">
          <Search className="reader-icon" />
          {query ? "没有找到匹配内容，试试更短的关键词。" : "输入关键词，定位后可返回原处。"}
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
              <em>
                {hit.snippetMatchStart === undefined ? (
                  hit.snippet
                ) : (
                  <>
                    {hit.snippet.slice(0, hit.snippetMatchStart)}
                    <mark>
                      {hit.snippet.slice(
                        hit.snippetMatchStart,
                        hit.snippetMatchStart + (hit.snippetMatchLength ?? 0),
                      )}
                    </mark>
                    {hit.snippet.slice(hit.snippetMatchStart + (hit.snippetMatchLength ?? 0))}
                  </>
                )}
              </em>
            </span>
            <ChevronRight className="reader-icon" />
          </button>
        ))}
      </div>
    </section>
  );
}
