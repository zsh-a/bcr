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

function useDebouncedPersist(runtime: ReaderRuntime | null): void {
  const library = useReader((state) => state.library);
  const progressByBook = useReader((state) => state.progressByBook);
  const settings = useReader((state) => state.settings);
  useEffect(() => {
    if (runtime === null || getReaderState().status !== "ready") return;
    const handle = window.setTimeout(() => {
      void persistReader(runtime, getReaderState())
        .then(() => reader.markSaved())
        .catch(() => undefined);
    }, 420);
    return () => window.clearTimeout(handle);
  }, [runtime, library, progressByBook, settings]);
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

function useReaderBoot(): { runtime: ReaderRuntime | null; error: string | null } {
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
  const searchRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        reader.setSearchOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (event.key === "Escape" && searchOpen) reader.setSearchOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  const importFiles = useCallback(
    async (files: ReadonlyArray<File>) => {
      if (runtime === null || files.length === 0) return;
      setNotice(`正在准备 ${files.length} 本读物…`);
      for (const file of files) {
        try {
          const book = await importReaderFile(runtime, file);
          reader.addBook(book);
          await indexBook(runtime, book);
          setNotice(`${book.title} 已加入书库`);
        } catch (reason) {
          setNotice(reason instanceof Error ? reason.message : String(reason));
        }
      }
      window.setTimeout(() => setNotice(null), 3600);
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
      <ReaderHeader
        book={active}
        searchRef={searchRef}
        onImport={(files) => void importFiles(files)}
        notice={notice}
      />
      <ReaderWorkspace runtime={runtime} onImport={(files) => void importFiles(files)} />
    </div>
  );
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

function ReaderHeader(props: {
  book: ReaderBook;
  searchRef: RefObject<HTMLInputElement | null>;
  onImport: (files: ReadonlyArray<File>) => void;
  notice: string | null;
}) {
  const query = useReader((state) => state.query);
  const searchOpen = useReader((state) => state.searchOpen);
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
          placeholder="在书库中搜索…"
          aria-label="在书库中搜索"
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
      {props.notice !== null && (
        <div className="reader-toast" role="status">
          {props.notice}
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
      <aside className="reader-sidebar">
        <LibraryPanel onImport={props.onImport} />
      </aside>
      <main className="reader-main">
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
        {library.map((book) => (
          <LibraryBookCard
            key={book.id}
            book={book}
            active={book.id === activeBookId}
            progress={progressByBook[book.id]?.percentage ?? 0}
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

function LibraryBookCard(props: { book: ReaderBook; active: boolean; progress: number }) {
  return (
    <button
      type="button"
      className={`reader-book-card ${props.active ? "is-active" : ""}`}
      onClick={() => reader.openBook(props.book.id)}
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
  );
}

function SearchPanel(props: { hits: ReadonlyArray<SearchHit> }) {
  const library = useReader((state) => state.library);
  const query = useReader((state) => state.query);
  const searchBusy = useReader((state) => state.searchBusy);
  const scrollToHit = (hit: SearchHit) => {
    reader.openBook(hit.bookId, hit.sectionId);
    reader.setSearchOpen(false);
  };
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
      </div>
      {props.hits.length === 0 && !searchBusy && (
        <div className="reader-search-empty">
          <Search className="reader-icon" />
          没有找到匹配内容，试试更短的关键词。
        </div>
      )}
      <div className="reader-search-results">
        {props.hits.map((hit, index) => (
          <button
            type="button"
            className="reader-search-result"
            key={`${hit.bookId}-${hit.sectionId}-${index}`}
            onClick={() => scrollToHit(hit)}
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
    <div className="reader-segmented" aria-label="阅读主题">
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
    <div className="reader-segmented" aria-label="阅读布局">
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
    <div className="reader-segmented reader-font-size-menu" aria-label="字号大小">
      <button
        type="button"
        onClick={() => reader.setSettings({ fontSize: clamp(props.settings.fontSize - 1, 15, 26) })}
        disabled={props.settings.fontSize <= 15}
        aria-label="减小字号"
        title="减小字号"
      >
        <Minus className="reader-icon" />
      </button>
      <span className="reader-font-size-value">{props.settings.fontSize}</span>
      <button
        type="button"
        onClick={() => reader.setSettings({ fontSize: clamp(props.settings.fontSize + 1, 15, 26) })}
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
        containerRef.current.scrollTo({ top: max * progress, behavior: "auto" });
      } else {
        scrollToReaderSection(activeSectionId);
      }
    }
  }, [activeSectionId, props.book, progress]);
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
          userScrollRef.current = true;
          if (frameRef.current !== null) return;
          frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            updateLocator();
          });
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
        {props.section.html ? (
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
    <aside className="reader-chapter-rail">
      <div className="reader-rail-heading">
        <List className="reader-icon" />
        <span>目录</span>
      </div>
      {props.book.sections.map((section) => (
        <button
          type="button"
          key={section.id}
          className={section.id === activeSectionId ? "is-active" : ""}
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
