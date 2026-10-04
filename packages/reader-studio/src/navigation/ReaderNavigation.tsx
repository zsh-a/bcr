import { currentTxtChapter } from "../content/txtChapters";
import { VirtualSectionList } from "../reading/VirtualSectionList";
import { SECTION_WINDOW_THRESHOLD } from "../reading/VirtualPublicationSections";
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  List,
  MessageSquarePlus,
  Search,
  PanelRightClose,
  Pin,
  PinOff,
  X,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ReaderAnnotation, ReaderBook, ReaderBookmark } from "@bcr/reader-core";
import { percentageForLocator } from "@bcr/reader-core";
import { ReaderRecordEditor } from "../library/ReaderRecordEditor";
import { ReaderBookmarkExport } from "./ReaderBookmarkExport";
import { percent } from "../reading/readerPresentation";
import { getReaderState, reader } from "../state/store";
import { useReader } from "../state/useReader";
import { ReaderSheet } from "../workbench/ReaderSheet";
import { ReaderHistoryBar } from "./ReaderHistoryBar";
import { currentReaderTocItem } from "./navigation";
import { ReaderTocTree } from "./ReaderTocTree";
import { tocAncestors, tocBranches, tocMatches, visibleTocRows } from "./tocTree";
import { ReaderProgressScrubber } from "./ReaderProgressScrubber";
import { useReaderMobile } from "../workbench/useReaderMobile";
import { ReaderSearchBar } from "./ReaderSearchBar";
import { ReaderJumpBack } from "./ReaderJumpBack";
import { PdfPageBrowser } from "./PdfPageBrowser";

type NavigationPanel = "toc" | "pages" | "bookmarks" | "notes";
interface NavigationState {
  panel: NavigationPanel;
  setPanel: (panel: NavigationPanel) => void;
  open: boolean;
  docked: boolean;
  openPanel: (panel: NavigationPanel) => void;
  floatPanel: () => void;
  close: () => void;
  query: string;
  setQuery: (value: string) => void;
  collapsed: ReadonlySet<string>;
  setCollapsed: (ids: ReadonlySet<string>) => void;
}
const NavigationContext = createContext<NavigationState | null>(null);
function useReadingNavigation(): NavigationState {
  const state = useContext(NavigationContext);
  if (!state) throw new Error("Reader navigation requires ReaderNavigationProvider");
  return state;
}

function initialCollapsed(book: ReaderBook): ReadonlySet<string> {
  const items = book.toc ?? [];
  const current = currentReaderTocItem(
    book,
    visibleTocRows(items, new Set()).map((row) => row.item),
    getReaderState().activeSectionId,
  );
  const next = new Set(tocBranches(items));
  if (current) for (const id of tocAncestors(items, current.id)) next.delete(id);
  return next;
}

export function ReaderNavigationProvider(props: { book: ReaderBook; children: ReactNode }) {
  const [panel, setPanel] = useState<NavigationPanel>("toc");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    initialCollapsed(props.book),
  );
  const pinned = useReader((state) => state.settings.tocPinned ?? false);
  const mobile = useReaderMobile();
  useEffect(() => {
    setPanel("toc");
    setOpen(false);
    setQuery("");
    setCollapsed(initialCollapsed(props.book));
  }, [props.book.id, props.book.toc]);
  useEffect(() => {
    if (pinned && !mobile) setOpen(false);
  }, [pinned, mobile]);
  const state: NavigationState = {
    panel,
    setPanel,
    open,
    docked: pinned && !mobile,
    query,
    setQuery,
    collapsed,
    setCollapsed,
    openPanel: (next) => {
      setPanel(
        next === "toc" && props.book.source.format === "pdf" && !props.book.toc?.length
          ? "pages"
          : next,
      );
      if (next === "toc") {
        const current = currentReaderTocItem(
          props.book,
          visibleTocRows(props.book.toc ?? [], new Set()).map((row) => row.item),
          getReaderState().activeSectionId,
        );
        if (current)
          setCollapsed((previous) => {
            const expanded = new Set(previous);
            for (const id of tocAncestors(props.book.toc ?? [], current.id)) expanded.delete(id);
            return expanded;
          });
      }
      if (pinned && !mobile) {
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLElement>('.reader-chapter-rail [aria-label="筛选章节"]')
            ?.focus(),
        );
      } else {
        if (getReaderState().sidebarOpen) reader.toggleSidebar();
        setOpen(true);
      }
    },
    close: () => setOpen(false),
    floatPanel: () => setOpen(true),
  };
  return (
    <NavigationContext.Provider value={state}>
      {props.children}
      <ReaderSheet
        open={open}
        onClose={state.close}
        labelId="reader-mobile-navigation-title"
        className="reader-navigation-layer"
        fallbackFocus={() => document.querySelector<HTMLElement>('[aria-label="打开阅读目录"]')}
      >
        <NavigationContent book={props.book} pinned={false} />
      </ReaderSheet>
    </NavigationContext.Provider>
  );
}

export function ReaderNavigationButton({ book: _book }: { book: ReaderBook }) {
  const navigation = useReadingNavigation();
  return (
    <button
      type="button"
      className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
      aria-label="打开阅读目录"
      aria-expanded={navigation.open || navigation.docked}
      aria-controls={
        navigation.docked ? "reader-pinned-navigation" : "reader-mobile-navigation-sheet"
      }
      onClick={() => navigation.openPanel("toc")}
    >
      <List className="reader-icon" />
    </button>
  );
}

const EMPTY_BOOKMARKS: ReadonlyArray<ReaderBookmark> = [];
const EMPTY_ANNOTATIONS: ReadonlyArray<ReaderAnnotation> = [];

export function MobileReadingBar(props: {
  book: ReaderBook;
  pagination?: {
    columns?: number;
    physicalPages?: number;
    scopeLabel?: string;
    progressOnly?: boolean;
    page: number;
    pages: number;
    canPrevious: boolean;
    canNext: boolean;
    turn: (delta: number) => void;
  };
}) {
  const activeSectionId = useReader((state) => state.activeSectionId);
  const progress = useReader((state) => state.progressByBook[props.book.id]?.percentage ?? 0);
  const query = useReader((state) => state.query);
  const mobile = useReaderMobile();
  const navigation = useReadingNavigation();
  const activeIndex = Math.max(
    0,
    props.book.sections.findIndex((section) => section.id === activeSectionId),
  );
  const chapter = currentTxtChapter(props.book, activeSectionId);
  const navigationIndex = chapter ? props.book.toc!.indexOf(chapter) : activeIndex;
  const navigationCount = chapter ? props.book.toc!.length : props.book.sections.length;
  const unit =
    props.book.source.format === "pdf"
      ? "页"
      : chapter || props.book.source.format !== "txt"
        ? "章"
        : "段";
  const openAdjacent = (delta: number) => {
    if (chapter && props.book.toc) {
      const adjacent = props.book.toc[props.book.toc.indexOf(chapter) + delta];
      if (adjacent?.sectionId) reader.openBook(props.book.id, adjacent.sectionId, false);
      return;
    }
    const target = props.book.sections[activeIndex + delta];
    if (target !== undefined) reader.openBook(props.book.id, target.id, false);
  };
  const position = props.pagination?.progressOnly
    ? "全书"
    : props.pagination
      ? props.pagination.columns === 2
        ? `${props.pagination.page * 2 + 1}–${Math.min(props.pagination.physicalPages ?? 1, props.pagination.page * 2 + 2)} / ${props.pagination.physicalPages} 页`
        : `${props.pagination.page + 1} / ${props.pagination.pages} 页`
      : `${navigationIndex + 1} / ${navigationCount} ${unit}`;
  const stepUnit = props.pagination ? "页" : unit;
  return (
    <>
      <nav
        className={`reader-mobile-nav ${mobile && query.trim() ? "is-search" : ""}`}
        aria-label={mobile && query.trim() ? "搜索结果导航" : "阅读导航"}
      >
        {mobile && query.trim() ? (
          <ReaderSearchBar />
        ) : (
          <>
            <button
              type="button"
              className="reader-mobile-nav-toc"
              onClick={() => navigation.openPanel("toc")}
              aria-expanded={navigation.open || navigation.docked}
              aria-controls={
                navigation.docked ? "reader-pinned-navigation" : "reader-mobile-navigation-sheet"
              }
            >
              <List className="reader-icon" />
              <span>目录</span>
            </button>
            <button
              type="button"
              className="reader-mobile-nav-step"
              onClick={() => (props.pagination ? props.pagination.turn(-1) : openAdjacent(-1))}
              disabled={props.pagination ? !props.pagination.canPrevious : navigationIndex <= 0}
              aria-label={`上一${stepUnit}`}
              title={`上一${stepUnit}`}
            >
              <ChevronLeft className="reader-icon" />
              {mobile && <span>上{stepUnit}</span>}
            </button>
            <div className="reader-mobile-nav-current">
              <ReaderProgressScrubber book={props.book} {...(mobile ? { detail: position } : {})} />
              {!mobile && <span className="reader-mobile-nav-current-meta">{position}</span>}
            </div>
            <button
              type="button"
              className="reader-mobile-nav-step"
              onClick={() => (props.pagination ? props.pagination.turn(1) : openAdjacent(1))}
              disabled={
                props.pagination
                  ? !props.pagination.canNext
                  : navigationIndex >= navigationCount - 1
              }
              aria-label={`下一${stepUnit}`}
              title={`下一${stepUnit}`}
            >
              <ChevronRight className="reader-icon" />
              {mobile && <span>下{stepUnit}</span>}
            </button>
            <div className="reader-mobile-nav-progress" aria-hidden="true">
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            {!mobile && <ReaderHistoryBar />}
          </>
        )}
        {mobile && <ReaderJumpBack />}
      </nav>
    </>
  );
}

function NavigationContent(props: { book: ReaderBook; pinned: boolean }) {
  const tabPrefix = useId();
  const titleId = props.pinned
    ? "reader-pinned-navigation-title"
    : "reader-mobile-navigation-title";
  const navigation = useReadingNavigation();
  const { panel, setPanel, query, setQuery, collapsed, setCollapsed } = navigation;
  const onClose = () => {
    if (props.pinned) reader.setSettings({ tocPinned: false });
    else navigation.close();
  };
  const onNavigate = () => {
    if (!props.pinned) navigation.close();
  };
  const contentRef = useRef<HTMLElement>(null);
  const tocPinned = useReader((state) => state.settings.tocPinned ?? false);
  const activeSectionId = useReader((state) => state.activeSectionId);
  const progress = useReader((state) => state.progressByBook[props.book.id]?.percentage ?? 0);
  const bookmarks = useReader((state) => state.bookmarksByBook[props.book.id] ?? EMPTY_BOOKMARKS);
  const annotations = useReader(
    (state) => state.annotationsByBook[props.book.id] ?? EMPTY_ANNOTATIONS,
  );
  const chapter = currentTxtChapter(props.book, activeSectionId);
  const current =
    props.book.sections.find((section) => section.id === activeSectionId) ?? props.book.sections[0];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const hasToc = props.book.toc !== undefined && props.book.toc.length > 0;
  const hasTocMatches = hasToc
    ? props.book.toc!.some((item) => tocMatches(item, normalizedQuery))
    : props.book.sections.some((section) =>
        section.label.toLocaleLowerCase().includes(normalizedQuery),
      );

  useEffect(() => {
    if (panel !== "toc" || activeSectionId === null) return;
    const frame = requestAnimationFrame(() => {
      contentRef.current
        ?.querySelector<HTMLElement>('[aria-current="page"]')
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeSectionId, panel]);

  const navigateToSection = (sectionId: string) => {
    reader.openBook(props.book.id, sectionId);
    onNavigate();
  };
  const tocCount = useMemo(
    () =>
      props.book.toc?.length
        ? visibleTocRows(props.book.toc, new Set()).length
        : props.book.sections.length,
    [props.book],
  );
  const tabs: ReadonlyArray<{
    id: NavigationPanel;
    label: string;
    count: number;
  }> = [
    { id: "toc", label: "目录", count: tocCount },
    ...(props.book.source.format === "pdf"
      ? [{ id: "pages" as const, label: "页面", count: props.book.sections.length }]
      : []),
    { id: "bookmarks", label: "书签", count: bookmarks.length },
    { id: "notes", label: "笔记", count: annotations.length },
  ];
  return (
    <section
      ref={contentRef}
      id={props.pinned ? "reader-pinned-navigation" : "reader-mobile-navigation-sheet"}
      className={`reader-navigation-sheet ${props.pinned ? "is-pinned" : "reader-mobile-sheet"}`}
      aria-labelledby={titleId}
    >
      <div className="reader-mobile-sheet-heading">
        <div>
          <span className="reader-navigation-caption">阅读导航</span>
          <strong id={titleId} title={props.book.title}>
            {props.book.title}
          </strong>
        </div>
        <button
          type="button"
          className="ui-btn ui-icon-btn ui-btn-ghost reader-pin-toc"
          aria-label={tocPinned ? "取消固定目录" : "固定目录侧栏"}
          title={tocPinned ? "取消固定目录" : "固定目录侧栏"}
          aria-pressed={tocPinned}
          onClick={() => {
            reader.setSettings({ tocPinned: !tocPinned });
            if (props.pinned) navigation.floatPanel();
            else navigation.close();
          }}
        >
          {tocPinned ? <PinOff className="reader-icon" /> : <Pin className="reader-icon" />}
        </button>
        <button
          type="button"
          className="ui-btn ui-icon-btn ui-btn-ghost"
          onClick={onClose}
          aria-label="关闭阅读导航"
        >
          {props.pinned ? (
            <PanelRightClose className="reader-icon" />
          ) : (
            <X className="reader-icon" />
          )}
        </button>
      </div>
      <div className="reader-mobile-sheet-tabs" role="tablist" aria-label="阅读导航分类">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            id={`${tabPrefix}-tab-${tab.id}`}
            role="tab"
            className={panel === tab.id ? "is-active" : ""}
            aria-selected={panel === tab.id}
            tabIndex={panel === tab.id ? 0 : -1}
            aria-controls={`${tabPrefix}-panel-${tab.id}`}
            onClick={() => setPanel(tab.id)}
            onKeyDown={(event) => {
              const index = tabs.findIndex((entry) => entry.id === tab.id);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              setPanel(tabs[next]!.id);
              contentRef.current
                ?.querySelector<HTMLButtonElement>(`[role="tab"][id$="-${tabs[next]!.id}"]`)
                ?.focus();
            }}
          >
            <span>{tab.label}</span>
            <small>{tab.count}</small>
          </button>
        ))}
      </div>
      {panel === "pages" && (
        <div
          id={`${tabPrefix}-panel-pages`}
          className="reader-mobile-sheet-content"
          role="tabpanel"
          aria-labelledby={`${tabPrefix}-tab-pages`}
        >
          <PdfPageBrowser
            book={props.book}
            activeSectionId={activeSectionId}
            onNavigate={navigateToSection}
          />
        </div>
      )}
      {panel === "toc" && (
        <div
          id={`${tabPrefix}-panel-toc`}
          className="reader-mobile-sheet-content"
          role="tabpanel"
          aria-labelledby={`${tabPrefix}-tab-toc`}
        >
          <div className="reader-mobile-toc-search">
            <label>
              <Search className="reader-icon" />
              <span className="ui-sr-only">筛选目录</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="筛选章节…"
                aria-label="筛选章节"
              />
            </label>
            {query.length > 0 && (
              <button type="button" onClick={() => setQuery("")} aria-label="清空目录筛选">
                <X className="reader-icon" />
              </button>
            )}
          </div>
          <div className="reader-mobile-toc-context">
            <span>正在阅读</span>
            <strong>{chapter?.label ?? current?.label ?? "正文"}</strong>
            <span>
              {current === undefined
                ? ""
                : `${chapter ? props.book.toc!.indexOf(chapter) + 1 : current.order + 1} / ${chapter ? props.book.toc!.length : props.book.sections.length} · ${percent(progress)}`}
            </span>
          </div>
          <div className="reader-mobile-sheet-scroll">
            {hasToc ? (
              <ReaderTocTree
                book={props.book}
                items={props.book.toc!}
                activeSectionId={activeSectionId}
                query={normalizedQuery}
                onNavigate={onNavigate}
                collapsed={collapsed}
                onCollapsedChange={setCollapsed}
              />
            ) : props.book.sections.length > SECTION_WINDOW_THRESHOLD ? (
              <VirtualSectionList
                sections={props.book.sections}
                activeSectionId={activeSectionId}
                query={normalizedQuery}
                onNavigate={navigateToSection}
              />
            ) : (
              <div className="reader-mobile-section-list">
                {props.book.sections
                  .filter((section) => section.label.toLocaleLowerCase().includes(normalizedQuery))
                  .map((section) => (
                    <button
                      type="button"
                      key={section.id}
                      className={section.id === activeSectionId ? "is-active" : ""}
                      aria-current={section.id === activeSectionId ? "page" : undefined}
                      data-reader-toc-section={section.id}
                      onClick={() => navigateToSection(section.id)}
                    >
                      <span>{String(section.order + 1).padStart(2, "0")}</span>
                      <strong>{section.label}</strong>
                      {section.id === activeSectionId && <Check className="reader-icon" />}
                    </button>
                  ))}
              </div>
            )}
            {!hasTocMatches && (
              <div className="reader-mobile-sheet-empty">
                <Search className="reader-icon" />
                <span>没有匹配的章节</span>
              </div>
            )}
          </div>
        </div>
      )}
      {panel === "bookmarks" && (
        <div
          id={`${tabPrefix}-panel-bookmarks`}
          className="reader-mobile-sheet-content"
          role="tabpanel"
          aria-labelledby={`${tabPrefix}-tab-bookmarks`}
        >
          <div className="reader-mobile-sheet-scroll">
            <ReaderBookmarkExport book={props.book} bookmarks={bookmarks} />
            {bookmarks.length > 0 ? (
              <div className="reader-mobile-saved-list">
                {[...bookmarks]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((bookmark) => (
                    <div className="reader-mobile-saved-row" key={bookmark.id}>
                      <button
                        type="button"
                        className="reader-mobile-saved-item"
                        onClick={() => {
                          reader.openBookmark(props.book.id, bookmark.id);
                          onNavigate();
                        }}
                      >
                        <Bookmark className="reader-icon" />
                        <span>
                          <strong>{bookmark.label}</strong>
                          <small>
                            {percent(percentageForLocator(props.book, bookmark.locator))} · 全书
                          </small>
                        </span>
                        <ChevronRight className="reader-icon" />
                      </button>
                      <ReaderRecordEditor bookId={props.book.id} record={bookmark} />
                      <button
                        type="button"
                        className="reader-mobile-saved-remove"
                        aria-label={`移除书签 ${bookmark.label}`}
                        onClick={() => reader.removeBookmark(props.book.id, bookmark.id)}
                      >
                        <X className="reader-icon" />
                      </button>
                    </div>
                  ))}
              </div>
            ) : (
              <MobileNavigationEmpty
                icon={<Bookmark className="reader-icon" />}
                message="还没有书签"
                hint="在阅读设置的「工具」中标记当前位置，随时回来。"
              />
            )}
          </div>
        </div>
      )}
      {panel === "notes" && (
        <div
          id={`${tabPrefix}-panel-notes`}
          className="reader-mobile-sheet-content"
          role="tabpanel"
          aria-labelledby={`${tabPrefix}-tab-notes`}
        >
          <div className="reader-mobile-sheet-scroll">
            {annotations.length > 0 ? (
              <div className="reader-mobile-saved-list">
                {[...annotations]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((annotation) => (
                    <div className="reader-mobile-saved-row" key={annotation.id}>
                      <button
                        type="button"
                        className="reader-mobile-saved-item"
                        onClick={() => {
                          reader.openAnnotation(props.book.id, annotation.id);
                          onNavigate();
                        }}
                      >
                        <MessageSquarePlus className="reader-icon" />
                        <span>
                          <strong>{annotation.label}</strong>
                          <small>{annotation.note}</small>
                        </span>
                        <ChevronRight className="reader-icon" />
                      </button>
                      <ReaderRecordEditor bookId={props.book.id} record={annotation} />
                      <button
                        type="button"
                        className="reader-mobile-saved-remove"
                        aria-label={`移除笔记 ${annotation.label}`}
                        onClick={() => reader.removeAnnotation(props.book.id, annotation.id)}
                      >
                        <X className="reader-icon" />
                      </button>
                    </div>
                  ))}
              </div>
            ) : (
              <MobileNavigationEmpty
                icon={<MessageSquarePlus className="reader-icon" />}
                message="还没有笔记"
                hint="选中正文后，在顶部操作栏添加你的想法。"
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function MobileNavigationEmpty(props: { icon: ReactNode; message: string; hint: string }) {
  return (
    <div className="reader-mobile-sheet-empty reader-mobile-saved-empty">
      <span className="reader-mobile-empty-icon">{props.icon}</span>
      <strong>{props.message}</strong>
      <span>{props.hint}</span>
    </div>
  );
}

export function ChapterRail(props: { book: ReaderBook }) {
  const width = useReader((state) => state.settings.navigationWidth ?? 304);
  const [resizing, setResizing] = useState(false);
  const start = useRef({ x: 0, width, value: width });
  return (
    <aside className={`reader-chapter-rail ${resizing ? "is-resizing" : ""}`} aria-label="章节目录">
      <div
        className="reader-navigation-resize"
        role="separator"
        aria-label="调整阅读侧栏宽度"
        aria-orientation="vertical"
        aria-valuemin={260}
        aria-valuemax={380}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = { x: event.clientX, width, value: width };
          setResizing(true);
        }}
        onPointerMove={(event) => {
          if (!resizing) return;
          const next = Math.round(
            Math.max(260, Math.min(380, start.current.width + start.current.x - event.clientX)),
          );
          start.current.value = next;
          event.currentTarget
            .closest<HTMLElement>(".reader-workspace")
            ?.style.setProperty("--reader-navigation-width", `${next}px`);
        }}
        onPointerUp={() => {
          if (resizing) reader.setSettings({ navigationWidth: start.current.value });
          setResizing(false);
        }}
        onPointerCancel={(event) => {
          event.currentTarget
            .closest<HTMLElement>(".reader-workspace")
            ?.style.setProperty("--reader-navigation-width", `${width}px`);
          reader.setSettings({ navigationWidth: width });
          setResizing(false);
        }}
        onKeyDown={(event) => {
          const next =
            event.key === "ArrowLeft"
              ? width + 16
              : event.key === "ArrowRight"
                ? width - 16
                : event.key === "Home"
                  ? 260
                  : event.key === "End"
                    ? 380
                    : null;
          if (next !== null) {
            event.preventDefault();
            reader.setSettings({ navigationWidth: Math.max(260, Math.min(380, next)) });
          }
        }}
      />
      <NavigationContent book={props.book} pinned />
    </aside>
  );
}
