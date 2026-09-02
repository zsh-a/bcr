import {
  Archive,
  Bookmark,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Columns2,
  FileText,
  Leaf,
  List,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  locatorAtPercentage,
  type ReaderBook,
  type ReaderSection,
  type SearchHit,
} from "@bcr/reader-core";
import {
  createReaderRuntime,
  importReaderFile,
  indexBook,
  persistReader,
  restoreReader,
  searchIndexed,
  type ReaderRuntime,
} from "./runtime";
import { activeBook, type ReaderSettings, type ReaderTheme } from "./model";
import { getReaderState, reader, useReader } from "./store";
import "./styles.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatBadge(format: ReaderBook["source"]["format"]): string {
  return format === "markdown" ? "MD" : format.toUpperCase();
}

function themeIcon(theme: ReaderTheme) {
  if (theme === "night") return <Moon className="reader-icon" />;
  if (theme === "sage") return <Leaf className="reader-icon" />;
  return <Sun className="reader-icon" />;
}

function themeLabel(theme: ReaderTheme): string {
  if (theme === "night") return "夜间";
  if (theme === "sage") return "松石";
  return "纸张";
}

function sourceIcon(format: ReaderBook["source"]["format"]) {
  return format === "cbz" ? (
    <Archive className="reader-icon" />
  ) : (
    <FileText className="reader-icon" />
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scrollToReaderSection(sectionId: string, behavior: ScrollBehavior = "smooth"): void {
  const container = document.querySelector<HTMLElement>(".reader-reading-scroll");
  const target = container?.querySelector<HTMLElement>(
    `[data-reader-section="${CSS.escape(sectionId)}"]`,
  );
  if (container === null || target === null || target === undefined) return;
  container.scrollTo({ top: Math.max(0, target.offsetTop - 28), behavior });
}

let readerPersistenceQueue: Promise<void> = Promise.resolve();

function persistReaderSnapshot(runtime: ReaderRuntime): void {
  const state = getReaderState();
  if (state.status !== "ready") return;
  readerPersistenceQueue = readerPersistenceQueue
    .catch(() => undefined)
    .then(() => persistReader(runtime, state))
    .then(() => reader.markSaved())
    .catch(() => undefined);
}

function isAbortError(reason: unknown): boolean {
  return (
    (reason instanceof DOMException && reason.name === "AbortError") ||
    (reason instanceof Error && reason.name === "AbortError")
  );
}

function useDebouncedPersist(runtime: ReaderRuntime | null): void {
  const library = useReader((state) => state.library);
  const progressByBook = useReader((state) => state.progressByBook);
  const settings = useReader((state) => state.settings);
  useEffect(() => {
    if (runtime === null || getReaderState().status !== "ready") return;
    const handle = window.setTimeout(() => {
      persistReaderSnapshot(runtime);
    }, 900);
    return () => window.clearTimeout(handle);
  }, [runtime, library, progressByBook, settings]);

  useEffect(() => {
    if (runtime === null) return;
    const flush = () => persistReaderSnapshot(runtime);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [runtime]);
}

function useReaderSearch(runtime: ReaderRuntime | null): void {
  const query = useReader((state) => state.query);
  const library = useReader((state) => state.library);
  useEffect(() => {
    if (runtime === null) return;
    const handle = window.setTimeout(() => {
      if (query.trim() === "") {
        reader.setSearch(query, [], null);
        return;
      }
      reader.setSearchBusy(true);
      try {
        reader.setSearch(query, searchIndexed(runtime, library, query), null);
      } catch {
        reader.setSearch(query, [], null);
      }
    }, 160);
    return () => window.clearTimeout(handle);
  }, [runtime, query, library]);
}

function useReaderBoot(): {
  runtime: ReaderRuntime | null;
  error: string | null;
} {
  const [runtime, setRuntime] = useState<ReaderRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void createReaderRuntime()
      .then(async (nextRuntime) => {
        if (cancelled) return;
        setRuntime(nextRuntime);
        const restored = await restoreReader(nextRuntime);
        if (cancelled) return;
        if (restored !== undefined) {
          reader.hydrate(restored.books, restored.progressByBook, restored.settings);
          await Promise.all(restored.books.map((book) => indexBook(nextRuntime, book)));
        } else {
          reader.setReady();
          await indexBook(nextRuntime, getReaderState().library[0]!);
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        reader.setError(reason);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { runtime, error };
}

export function App() {
  const { runtime, error: runtimeError } = useReaderBoot();
  useDebouncedPersist(runtime);
  useReaderSearch(runtime);
  const status = useReader((state) => state.status);
  const stateError = useReader((state) => state.error);
  const active = useReader((state) => activeBook(state));
  const settings = useReader((state) => state.settings);
  const searchOpen = useReader((state) => state.searchOpen);
  const sidebarOpen = useReader((state) => state.sidebarOpen);
  const searchRef = useRef<HTMLInputElement>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const importDismissRef = useRef<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importJob, setImportJob] = useState<ImportJob | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        reader.setSearchOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (event.key === "Escape") {
        if (searchOpen) reader.setSearchOpen(false);
        else if (sidebarOpen) reader.toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, sidebarOpen]);

  const cancelImport = useCallback(() => {
    importAbortRef.current?.abort();
  }, []);

  useEffect(
    () => () => {
      importAbortRef.current?.abort();
      if (importDismissRef.current !== null) window.clearTimeout(importDismissRef.current);
    },
    [],
  );

  const importFiles = useCallback(
    async (files: ReadonlyArray<File>) => {
      if (runtime === null || files.length === 0 || importAbortRef.current !== null) return;
      if (importDismissRef.current !== null) {
        window.clearTimeout(importDismissRef.current);
        importDismissRef.current = null;
      }
      const controller = new AbortController();
      importAbortRef.current = controller;
      setImportJob({
        total: files.length,
        completed: 0,
        current: "",
        cancelled: false,
        errors: 0,
      });
      let errors = 0;
      for (const [index, file] of files.entries()) {
        if (controller.signal.aborted) break;
        setImportJob((previous) =>
          previous === null ? previous : { ...previous, current: file.name },
        );
        try {
          const book = await importReaderFile(runtime, file, controller.signal);
          if (controller.signal.aborted) break;
          const added = reader.addBook(book);
          if (added) {
            await indexBook(runtime, book);
            setNotice(`${book.title} 已加入书库`);
          } else {
            setNotice(`${file.name} 已在书库`);
          }
        } catch (reason) {
          if (isAbortError(reason)) break;
          errors += 1;
          setNotice(reason instanceof Error ? reason.message : String(reason));
        } finally {
          setImportJob((previous) =>
            previous === null
              ? previous
              : { ...previous, completed: index + 1, current: "", errors },
          );
        }
      }
      const cancelled = controller.signal.aborted;
      setImportJob((previous) =>
        previous === null ? previous : { ...previous, current: "", cancelled, errors },
      );
      importAbortRef.current = null;
      setNotice(
        cancelled ? "导入已取消" : errors > 0 ? `导入完成，${errors} 个文件失败` : "导入完成",
      );
      importDismissRef.current = window.setTimeout(
        () => {
          setNotice(null);
          setImportJob(null);
          importDismissRef.current = null;
        },
        cancelled ? 1800 : 2400,
      );
    },
    [runtime],
  );

  if (status === "booting" || runtime === null) {
    return <BootScreen error={runtimeError} />;
  }
  if (active === undefined) {
    return <BootScreen error={stateError ?? runtimeError ?? "没有可阅读的内容"} />;
  }
  return (
    <div className={`reader-studio reader-theme-${settings.theme}`}>
      <a className="reader-skip-link" href="#reader-content">
        跳到正文
      </a>
      <ReaderHeader
        book={active}
        searchRef={searchRef}
        onImport={(files) => void importFiles(files)}
        notice={notice}
        importJob={importJob}
        onCancelImport={cancelImport}
      />
      <ReaderWorkspace runtime={runtime} onImport={(files) => void importFiles(files)} />
    </div>
  );
}

interface ImportJob {
  readonly total: number;
  readonly completed: number;
  readonly current: string;
  readonly cancelled: boolean;
  readonly errors: number;
}

function BootScreen(props: { error: string | null }) {
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

function openSearchHit(hit: SearchHit): void {
  reader.openBook(hit.bookId, hit.sectionId);
  reader.setSearchOpen(false);
}

function ReaderHeader(props: {
  book: ReaderBook;
  searchRef: RefObject<HTMLInputElement | null>;
  onImport: (files: ReadonlyArray<File>) => void;
  notice: string | null;
  importJob: ImportJob | null;
  onCancelImport: () => void;
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
    <header className="reader-header">
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
          aria-expanded={searchOpen && query.length > 0}
          aria-controls="reader-search-results"
          aria-activedescendant={
            searchActiveIndex >= 0 ? `reader-search-hit-${searchActiveIndex}` : undefined
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
      </div>
      <div className="reader-header-progress" title={`当前进度 ${percent(progress)}`}>
        <div className="reader-progress-ring">
          <span>{percent(progress)}</span>
        </div>
      </div>
      <input
        ref={fileInput}
        className="reader-visually-hidden"
        type="file"
        multiple
        accept=".txt,.md,.markdown,.html,.htm,.epub,.pdf,.cbz,.fb2"
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
          {props.notice}
        </div>
      )}
      {props.importJob !== null && (
        <div className="reader-import-progress" role="status" aria-live="polite">
          <div className="reader-import-progress-copy">
            <strong>{props.importJob.cancelled ? "导入已取消" : "正在导入"}</strong>
            <span>
              {props.importJob.current || `${props.importJob.completed}/${props.importJob.total}`}
            </span>
          </div>
          <progress
            max={props.importJob.total}
            value={props.importJob.completed}
            aria-label="导入进度"
          />
          {!props.importJob.cancelled && (
            <button type="button" className="reader-import-cancel" onClick={props.onCancelImport}>
              取消
            </button>
          )}
        </div>
      )}
    </header>
  );
}

function ReaderWorkspace(props: {
  runtime: ReaderRuntime;
  onImport: (files: ReadonlyArray<File>) => void;
}) {
  const sidebarOpen = useReader((state) => state.sidebarOpen);
  const searchOpen = useReader((state) => state.searchOpen);
  const settings = useReader((state) => state.settings);
  const active = useReader((state) => activeBook(state));
  const query = useReader((state) => state.query);
  const searchHits = useReader((state) => state.searchHits);
  if (active === undefined) return null;
  return (
    <div className={`reader-workspace ${sidebarOpen ? "sidebar-visible" : "sidebar-hidden"}`}>
      <aside className="reader-sidebar" aria-label="本地书库">
        <LibraryPanel onImport={props.onImport} />
      </aside>
      {sidebarOpen && (
        <button
          type="button"
          className="reader-sidebar-scrim"
          aria-label="关闭书库"
          onClick={() => reader.toggleSidebar()}
        />
      )}
      <main id="reader-content" className="reader-main" aria-label="阅读内容">
        {searchOpen && query.length > 0 && <SearchPanel hits={searchHits} />}
        <ReaderToolbar book={active} settings={settings} />
        <ReadingView runtime={props.runtime} book={active} />
      </main>
    </div>
  );
}

function LibraryPanel(props: { onImport: (files: ReadonlyArray<File>) => void }) {
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
        <small>TXT · MD · HTML · EPUB · PDF · CBZ</small>
      </div>
      <input
        ref={fileInput}
        className="reader-visually-hidden"
        type="file"
        multiple
        accept=".txt,.md,.markdown,.html,.htm,.epub,.pdf,.cbz,.fb2"
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
              reader.removeBook(book.id);
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
        <span>OPFS · FTS5</span>
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
            onClick={() => openSearchHit(hit)}
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

function ReaderToolbar(props: { book: ReaderBook; settings: ReaderSettings }) {
  const activeSectionId = useReader((state) => state.activeSectionId);
  const progress = useReader((state) => state.progressByBook[props.book.id]?.percentage ?? 0);
  const current =
    props.book.sections.find((section) => section.id === activeSectionId) ?? props.book.sections[0];
  return (
    <div className="reader-toolbar">
      <div className="reader-toolbar-title">
        <button
          type="button"
          className="reader-icon-button reader-sidebar-toggle"
          onClick={() => reader.toggleSidebar()}
          aria-label="切换书库"
        >
          <PanelLeftOpen className="reader-icon" />
        </button>
        <div>
          <span className="reader-eyebrow">READING SESSION</span>
          <strong>{current?.label ?? "正文"}</strong>
        </div>
      </div>
      <div className="reader-toolbar-actions">
        <span className="reader-locator">
          <Bookmark className="reader-icon" /> {percent(progress)}
        </span>
        <ThemeMenu settings={props.settings} />
        <LayoutMenu settings={props.settings} />
        <FontSizeMenu settings={props.settings} />
      </div>
    </div>
  );
}

function ThemeMenu(props: { settings: ReaderSettings }) {
  const themes: ReadonlyArray<ReaderTheme> = ["paper", "sage", "night"];
  return (
    <div className="reader-segmented" role="group" aria-label="阅读主题">
      {themes.map((theme) => (
        <button
          type="button"
          key={theme}
          className={props.settings.theme === theme ? "is-active" : ""}
          onClick={() => reader.setSettings({ theme })}
          title={themeLabel(theme)}
        >
          {themeIcon(theme)}
          <span className="reader-control-label">{themeLabel(theme)}</span>
        </button>
      ))}
    </div>
  );
}

function LayoutMenu(props: { settings: ReaderSettings }) {
  return (
    <div className="reader-segmented" role="group" aria-label="阅读布局">
      <button
        type="button"
        className={props.settings.layout === "scroll" ? "is-active" : ""}
        onClick={() => reader.setSettings({ layout: "scroll" })}
        title="连续滚动"
      >
        <List className="reader-icon" />
        <span className="reader-control-label">连续</span>
      </button>
      <button
        type="button"
        className={props.settings.layout === "paged" ? "is-active" : ""}
        onClick={() => reader.setSettings({ layout: "paged" })}
        title="分页阅读"
      >
        <Columns2 className="reader-icon" />
        <span className="reader-control-label">分页</span>
      </button>
    </div>
  );
}

function FontSizeMenu(props: { settings: ReaderSettings }) {
  return (
    <div className="reader-segmented reader-font-size-menu" role="group" aria-label="字号大小">
      <button
        type="button"
        onClick={() =>
          reader.setSettings({
            fontSize: clamp(props.settings.fontSize - 1, 15, 26),
          })
        }
        disabled={props.settings.fontSize <= 15}
        aria-label="减小字号"
        title="减小字号"
      >
        <Minus className="reader-icon" />
      </button>
      <span className="reader-font-size-value">{props.settings.fontSize}</span>
      <button
        type="button"
        onClick={() =>
          reader.setSettings({
            fontSize: clamp(props.settings.fontSize + 1, 15, 26),
          })
        }
        disabled={props.settings.fontSize >= 26}
        aria-label="增大字号"
        title="增大字号"
      >
        <Plus className="reader-icon" />
      </button>
    </div>
  );
}

function ReadingView(props: { runtime: ReaderRuntime; book: ReaderBook }) {
  const settings = useReader((state) => state.settings);
  const activeSectionId = useReader((state) => state.activeSectionId);
  const progress = useReader((state) => state.progressByBook[props.book.id]?.percentage ?? 0);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const lastScrollUpdateRef = useRef(0);
  const userScrollRef = useRef(false);
  const updateLocator = useCallback(() => {
    const container = containerRef.current;
    if (container === null || props.book.sections.length === 0) return;
    const max = Math.max(1, container.scrollHeight - container.clientHeight);
    const percentage = clamp(container.scrollTop / max, 0, 1);
    reader.setLocator(locatorAtPercentage(props.book, percentage), percentage);
  }, [props.book]);
  useEffect(() => {
    if (activeSectionId === null || containerRef.current === null) return;
    if (userScrollRef.current) {
      userScrollRef.current = false;
      return;
    }
    if (progress > 0) {
      const max = Math.max(
        1,
        containerRef.current.scrollHeight - containerRef.current.clientHeight,
      );
      if (activeSectionId === props.book.sections[0]?.id) {
        containerRef.current.scrollTo({
          top: max * progress,
          behavior: "auto",
        });
      } else {
        scrollToReaderSection(activeSectionId);
      }
    }
  }, [activeSectionId, props.book]);
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );
  return (
    <div
      className={`reader-reading-frame reader-layout-${settings.layout} reader-width-${settings.contentWidth}`}
      style={
        {
          "--reader-reader-font-size": `${settings.fontSize}px`,
          "--reader-reader-line-height": settings.lineHeight,
        } as CSSProperties
      }
    >
      <div
        className="reader-reading-scroll"
        ref={containerRef}
        onScroll={() => {
          if (frameRef.current !== null) return;
          const flush = () => {
            const elapsed = performance.now() - lastScrollUpdateRef.current;
            if (elapsed < 120) {
              frameRef.current = requestAnimationFrame(flush);
              return;
            }
            frameRef.current = null;
            lastScrollUpdateRef.current = performance.now();
            userScrollRef.current = true;
            updateLocator();
          };
          frameRef.current = requestAnimationFrame(flush);
        }}
      >
        <div className="reader-reading-column">
          <ReadingIntro book={props.book} progress={progress} />
          {props.book.source.format === "pdf" ? (
            <PdfReaderView book={props.book} />
          ) : (
            props.book.sections.map((section) => <SectionView key={section.id} section={section} />)
          )}
          <ReadingEnd book={props.book} />
        </div>
      </div>
      <ChapterRail book={props.book} />
    </div>
  );
}

function ReadingIntro(props: { book: ReaderBook; progress: number }) {
  return (
    <section className="reader-reading-intro">
      <div className="reader-intro-kicker">
        <span className="reader-live-dot" /> {formatBadge(props.book.source.format)} ·{" "}
        {props.book.sections.length} 个章节
      </div>
      <h1>{props.book.title}</h1>
      <p className="reader-intro-author">{props.book.author ?? "本地出版物"}</p>
      <div className="reader-intro-line">
        <span />
        {props.progress > 0 ? `从 ${percent(props.progress)} 继续` : "从头开始阅读"}
        <span />
      </div>
    </section>
  );
}

function SectionView(props: { section: ReaderSection }) {
  return (
    <section className="reader-section" data-reader-section={props.section.id}>
      <div className="reader-section-index">{String(props.section.order + 1).padStart(2, "0")}</div>
      <div className="reader-section-body">
        <div className="reader-section-label">{props.section.label}</div>
        {props.section.kind === "image" && props.section.imageUrl ? (
          <img
            className="reader-section-image"
            src={props.section.imageUrl}
            alt={props.section.imageAlt ?? props.section.label}
            loading="lazy"
          />
        ) : props.section.html ? (
          <div className="reader-prose" dangerouslySetInnerHTML={{ __html: props.section.html }} />
        ) : (
          <p className="reader-prose">{props.section.text}</p>
        )}
      </div>
    </section>
  );
}

function PdfReaderView(props: { book: ReaderBook }) {
  const activeSectionId = useReader((state) => state.activeSectionId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentPage =
    props.book.sections.find((section) => section.id === activeSectionId)?.pageNumber ?? 1;
  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      if (props.book.source.objectUrl === undefined || canvasRef.current === null) {
        setError("PDF 源文件未恢复");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        const document = await pdfjs.getDocument(props.book.source.objectUrl).promise;
        const page = await document.getPage(currentPage);
        const viewport = page.getViewport({ scale: 1.28 });
        const canvas = canvasRef.current;
        if (canvas === null || cancelled) return;
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("Canvas 2D 不可用");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        await document.cleanup();
        if (!cancelled) setLoading(false);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [currentPage, props.book.source.objectUrl]);
  return (
    <div className="reader-pdf-view" data-reader-section={`page-${currentPage}`}>
      <div className="reader-pdf-meta">
        <span>PDF PAGE {String(currentPage).padStart(3, "0")}</span>
        <span>{props.book.sections.length} 页</span>
      </div>
      {loading && <div className="reader-media-loading">正在渲染页面…</div>}
      {error !== null && (
        <div className="reader-media-error">
          <CircleAlert className="reader-icon" />
          {error}
        </div>
      )}
      <canvas ref={canvasRef} className="reader-pdf-canvas" />
    </div>
  );
}

function ReadingEnd(props: { book: ReaderBook }) {
  return (
    <div className="reader-reading-end">
      <Check className="reader-icon" />
      <strong>读到这里</strong>
      <span>{props.book.title} · 进度已保存在当前设备</span>
    </div>
  );
}

function ChapterRail(props: { book: ReaderBook }) {
  const activeSectionId = useReader((state) => state.activeSectionId);
  return (
    <aside className="reader-chapter-rail" aria-label="章节目录">
      <div className="reader-rail-heading">
        <List className="reader-icon" />
        <span>目录</span>
      </div>
      {props.book.sections.map((section) => (
        <button
          type="button"
          key={section.id}
          className={section.id === activeSectionId ? "is-active" : ""}
          aria-current={section.id === activeSectionId ? "page" : undefined}
          onClick={() => reader.openBook(props.book.id, section.id)}
        >
          <span>{String(section.order + 1).padStart(2, "0")}</span>
          <strong>{section.label}</strong>
        </button>
      ))}
      <div className="reader-rail-footer">
        <Settings2 className="reader-icon" />
        <span>阅读设置由本地配置驱动</span>
      </div>
    </aside>
  );
}
