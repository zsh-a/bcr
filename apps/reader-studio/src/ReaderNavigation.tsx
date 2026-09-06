import { VirtualSectionList } from "./VirtualSectionList";
import { SECTION_WINDOW_THRESHOLD } from "./VirtualTextSections";
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  List,
  MessageSquarePlus,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { ReaderAnnotation, ReaderBook, ReaderBookmark, ReaderTocItem } from "@bcr/reader-core";
import { percent } from "./readerPresentation";
import { reader, useReader } from "./store";
import { ReaderSheet } from "./ReaderSheet";
import { ReaderHistoryBar } from "./ReaderHistoryBar";

export function ReaderNavigationButton({ book }: { book: ReaderBook }) {
  const [panel, setPanel] = useState<MobileNavigationPanel | null>(null);
  return (
    <>
      <button
        type="button"
        className="reader-icon-button"
        aria-label="打开阅读目录"
        aria-expanded={panel !== null}
        onClick={() => setPanel("toc")}
      >
        <List className="reader-icon" />
      </button>
      {panel && (
        <MobileNavigationSheet
          book={book}
          panel={panel}
          onPanelChange={setPanel}
          onClose={() => setPanel(null)}
        />
      )}
    </>
  );
}

const EMPTY_BOOKMARKS: ReadonlyArray<ReaderBookmark> = [];
const EMPTY_ANNOTATIONS: ReadonlyArray<ReaderAnnotation> = [];

function tocSectionId(book: ReaderBook, item: ReaderTocItem): string | undefined {
  if (
    item.sectionId !== undefined &&
    book.sections.some((section) => section.id === item.sectionId)
  ) {
    return item.sectionId;
  }
  if (item.href !== undefined) {
    return book.sections.find((section) => section.href === item.href)?.id;
  }
  return undefined;
}

function ReaderTocTree(props: {
  book: ReaderBook;
  items: ReadonlyArray<ReaderTocItem>;
  activeSectionId: string | null;
  level?: number;
  query?: string | undefined;
  onNavigate?: (() => void) | undefined;
}) {
  const level = props.level ?? 0;
  const query = props.query?.trim().toLocaleLowerCase() ?? "";
  const visibleItems = props.items.filter((item) => tocItemMatchesQuery(item, query));
  return (
    <div className={`reader-toc-level reader-toc-level-${Math.min(level, 4)}`}>
      {visibleItems.map((item, index) => {
        const sectionId = tocSectionId(props.book, item);
        const children = item.children ?? [];
        return (
          <div className="reader-toc-item" key={item.id}>
            <button
              type="button"
              className={sectionId === props.activeSectionId ? "is-active" : ""}
              aria-current={sectionId === props.activeSectionId ? "page" : undefined}
              data-reader-toc-section={sectionId}
              disabled={sectionId === undefined}
              title={sectionId === undefined ? "此条目未包含可读正文" : undefined}
              onClick={() => {
                if (sectionId !== undefined) {
                  reader.openBook(props.book.id, sectionId);
                  props.onNavigate?.();
                }
              }}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.label}</strong>
            </button>
            {children.length > 0 && (
              <ReaderTocTree
                book={props.book}
                items={children}
                activeSectionId={props.activeSectionId}
                level={level + 1}
                query={props.query}
                onNavigate={props.onNavigate}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

type MobileNavigationPanel = "toc" | "bookmarks" | "notes";

function tocItemMatchesQuery(item: ReaderTocItem, query: string): boolean {
  if (query.length === 0) return true;
  return (
    item.label.toLocaleLowerCase().includes(query) ||
    (item.children ?? []).some((child) => tocItemMatchesQuery(child, query))
  );
}

export function MobileReadingBar(props: {
  book: ReaderBook;
  pagination?: {
    columns?: number;
    physicalPages?: number;
    page: number;
    pages: number;
    canPrevious: boolean;
    canNext: boolean;
    turn: (delta: number) => void;
  };
}) {
  const activeSectionId = useReader((state) => state.activeSectionId);
  const progress = useReader((state) => state.progressByBook[props.book.id]?.percentage ?? 0);
  const [panel, setPanel] = useState<MobileNavigationPanel | null>(null);
  const activeIndex = Math.max(
    0,
    props.book.sections.findIndex((section) => section.id === activeSectionId),
  );
  const current = props.book.sections[activeIndex] ?? props.book.sections[0];
  const unit = props.book.source.format === "pdf" ? "页" : "章";
  const openAdjacent = (delta: number) => {
    const target = props.book.sections[activeIndex + delta];
    if (target !== undefined) reader.openBook(props.book.id, target.id, false);
  };
  return (
    <>
      <nav className="reader-mobile-nav" aria-label="阅读导航">
        <button
          type="button"
          className="reader-mobile-nav-toc"
          onClick={() => setPanel("toc")}
          aria-expanded={panel === "toc"}
          aria-controls="reader-mobile-navigation-sheet"
        >
          <List className="reader-icon" />
          <span>目录</span>
        </button>
        <button
          type="button"
          className="reader-mobile-nav-current"
          onClick={() => setPanel("toc")}
          aria-expanded={panel === "toc"}
          aria-controls="reader-mobile-navigation-sheet"
        >
          <span className="reader-mobile-nav-current-label">当前阅读</span>
          <strong>{current?.label ?? "正文"}</strong>
          <span className="reader-mobile-nav-current-meta">
            {props.pagination
              ? props.pagination.columns === 2
                ? `${props.pagination.page * 2 + 1}–${Math.min(props.pagination.physicalPages ?? 1, props.pagination.page * 2 + 2)} / ${props.pagination.physicalPages} 页 · 本章`
                : `${props.pagination.page + 1} / ${props.pagination.pages} 页 · 本章`
              : `${activeIndex + 1} / ${props.book.sections.length} ${unit} · ${percent(progress)}`}
          </span>
          <ChevronUp className="reader-mobile-nav-current-chevron" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="reader-mobile-nav-step"
          onClick={() => (props.pagination ? props.pagination.turn(-1) : openAdjacent(-1))}
          disabled={props.pagination ? !props.pagination.canPrevious : activeIndex <= 0}
          aria-label={props.pagination ? "上一页" : "上一章"}
          title={props.pagination ? "上一页" : "上一章"}
        >
          <ChevronLeft className="reader-icon" />
        </button>
        <button
          type="button"
          className="reader-mobile-nav-step"
          onClick={() => (props.pagination ? props.pagination.turn(1) : openAdjacent(1))}
          disabled={
            props.pagination
              ? !props.pagination.canNext
              : activeIndex >= props.book.sections.length - 1
          }
          aria-label={props.pagination ? "下一页" : "下一章"}
          title={props.pagination ? "下一页" : "下一章"}
        >
          <ChevronRight className="reader-icon" />
        </button>
        <div className="reader-mobile-nav-progress" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <ReaderHistoryBar />
      </nav>
      {panel !== null && (
        <MobileNavigationSheet
          book={props.book}
          panel={panel}
          onPanelChange={setPanel}
          onClose={() => setPanel(null)}
        />
      )}
    </>
  );
}

function MobileNavigationSheet(props: {
  book: ReaderBook;
  panel: MobileNavigationPanel;
  onPanelChange: (panel: MobileNavigationPanel) => void;
  onClose: () => void;
}) {
  const tocPinned = useReader((state) => state.settings.tocPinned ?? false);
  const activeSectionId = useReader((state) => state.activeSectionId);
  const progress = useReader((state) => state.progressByBook[props.book.id]?.percentage ?? 0);
  const bookmarks = useReader((state) => state.bookmarksByBook[props.book.id] ?? EMPTY_BOOKMARKS);
  const annotations = useReader(
    (state) => state.annotationsByBook[props.book.id] ?? EMPTY_ANNOTATIONS,
  );
  const [query, setQuery] = useState("");
  const current =
    props.book.sections.find((section) => section.id === activeSectionId) ?? props.book.sections[0];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const hasToc = props.book.toc !== undefined && props.book.toc.length > 0;
  const hasTocMatches = hasToc
    ? props.book.toc!.some((item) => tocItemMatchesQuery(item, normalizedQuery))
    : props.book.sections.some((section) =>
        section.label.toLocaleLowerCase().includes(normalizedQuery),
      );

  useEffect(() => {
    setQuery("");
  }, [props.panel]);

  useEffect(() => {
    if (props.panel !== "toc" || activeSectionId === null) return;
    const frame = window.requestAnimationFrame(() => {
      const sheet = document.getElementById("reader-mobile-navigation-sheet");
      const active = sheet?.querySelector<HTMLElement>(
        `[data-reader-toc-section="${CSS.escape(activeSectionId)}"]`,
      );
      active?.scrollIntoView({ block: "center", behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSectionId, props.panel]);

  const navigateToSection = (sectionId: string) => {
    reader.openBook(props.book.id, sectionId);
    props.onClose();
  };
  const tabs: ReadonlyArray<{
    id: MobileNavigationPanel;
    label: string;
    count: number;
  }> = [
    { id: "toc", label: "目录", count: props.book.sections.length },
    { id: "bookmarks", label: "书签", count: bookmarks.length },
    { id: "notes", label: "笔记", count: annotations.length },
  ];
  return (
    <ReaderSheet onClose={props.onClose} labelId="reader-mobile-navigation-title">
      <section
        id="reader-mobile-navigation-sheet"
        className="reader-mobile-sheet reader-navigation-sheet"
        aria-labelledby="reader-mobile-navigation-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="reader-mobile-sheet-heading">
          <div>
            <span className="reader-eyebrow">READING MAP</span>
            <strong id="reader-mobile-navigation-title">{props.book.title}</strong>
          </div>
          <button
            type="button"
            className="reader-icon-button"
            onClick={props.onClose}
            aria-label="关闭阅读导航"
          >
            <X className="reader-icon" />
          </button>
        </div>
        <button
          type="button"
          className="reader-button reader-pin-toc"
          aria-pressed={tocPinned}
          onClick={() => {
            reader.setSettings({ tocPinned: !tocPinned });
            props.onClose();
          }}
        >
          {tocPinned ? "取消固定目录" : "固定目录侧栏"}
        </button>
        <div className="reader-mobile-sheet-tabs" role="tablist" aria-label="阅读导航分类">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              role="tab"
              className={props.panel === tab.id ? "is-active" : ""}
              aria-selected={props.panel === tab.id}
              onClick={() => props.onPanelChange(tab.id)}
            >
              <span>{tab.label}</span>
              <small>{tab.count}</small>
            </button>
          ))}
        </div>
        {props.panel === "toc" && (
          <div className="reader-mobile-sheet-content" role="tabpanel">
            <div className="reader-mobile-toc-search">
              <label>
                <Search className="reader-icon" />
                <span className="reader-visually-hidden">筛选目录</span>
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
              <strong>{current?.label ?? "正文"}</strong>
              <span>
                {current === undefined
                  ? ""
                  : `${current.order + 1} / ${props.book.sections.length} · ${percent(progress)}`}
              </span>
            </div>
            <div className="reader-mobile-sheet-scroll">
              {hasToc ? (
                <ReaderTocTree
                  book={props.book}
                  items={props.book.toc!}
                  activeSectionId={activeSectionId}
                  query={normalizedQuery}
                  onNavigate={() => props.onClose()}
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
                    .filter((section) =>
                      section.label.toLocaleLowerCase().includes(normalizedQuery),
                    )
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
        {props.panel === "bookmarks" && (
          <div className="reader-mobile-sheet-content" role="tabpanel">
            <div className="reader-mobile-sheet-scroll">
              {bookmarks.length > 0 ? (
                <div className="reader-mobile-saved-list">
                  {bookmarks.map((bookmark) => (
                    <div className="reader-mobile-saved-row" key={bookmark.id}>
                      <button
                        type="button"
                        className="reader-mobile-saved-item"
                        onClick={() => {
                          reader.openBookmark(props.book.id, bookmark.id);
                          props.onClose();
                        }}
                      >
                        <Bookmark className="reader-icon" />
                        <span>
                          <strong>{bookmark.label}</strong>
                          <small>{percent(bookmark.locator.progression)} · 本章位置</small>
                        </span>
                        <ChevronRight className="reader-icon" />
                      </button>
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
                  hint="在阅读页顶部点书签，随时回来。"
                />
              )}
            </div>
          </div>
        )}
        {props.panel === "notes" && (
          <div className="reader-mobile-sheet-content" role="tabpanel">
            <div className="reader-mobile-sheet-scroll">
              {annotations.length > 0 ? (
                <div className="reader-mobile-saved-list">
                  {annotations.map((annotation) => (
                    <div className="reader-mobile-saved-row" key={annotation.id}>
                      <button
                        type="button"
                        className="reader-mobile-saved-item"
                        onClick={() => {
                          reader.openAnnotation(props.book.id, annotation.id);
                          props.onClose();
                        }}
                      >
                        <MessageSquarePlus className="reader-icon" />
                        <span>
                          <strong>{annotation.label}</strong>
                          <small>{annotation.note}</small>
                        </span>
                        <ChevronRight className="reader-icon" />
                      </button>
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
    </ReaderSheet>
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
  const activeSectionId = useReader((state) => state.activeSectionId);
  const bookmarks = useReader((state) => state.bookmarksByBook[props.book.id] ?? EMPTY_BOOKMARKS);
  const annotations = useReader(
    (state) => state.annotationsByBook[props.book.id] ?? EMPTY_ANNOTATIONS,
  );
  return (
    <aside className="reader-chapter-rail" aria-label="章节目录">
      <div className="reader-rail-heading">
        <List className="reader-icon" />
        <span>目录</span>
      </div>
      {props.book.toc !== undefined && props.book.toc.length > 0 ? (
        <ReaderTocTree book={props.book} items={props.book.toc} activeSectionId={activeSectionId} />
      ) : props.book.sections.length > SECTION_WINDOW_THRESHOLD ? (
        <VirtualSectionList
          sections={props.book.sections}
          activeSectionId={activeSectionId}
          onNavigate={(id) => reader.openBook(props.book.id, id)}
        />
      ) : (
        props.book.sections.map((section) => (
          <button
            type="button"
            key={section.id}
            className={section.id === activeSectionId ? "is-active" : ""}
            aria-current={section.id === activeSectionId ? "page" : undefined}
            data-reader-toc-section={section.id}
            onClick={() => reader.openBook(props.book.id, section.id)}
          >
            <span>{String(section.order + 1).padStart(2, "0")}</span>
            <strong>{section.label}</strong>
          </button>
        ))
      )}
      {bookmarks.length > 0 && (
        <>
          <div className="reader-rail-divider" />
          <div className="reader-rail-heading reader-rail-subheading">
            <Bookmark className="reader-icon" />
            <span>书签 · {bookmarks.length}</span>
          </div>
          <div className="reader-bookmark-list">
            {bookmarks.map((bookmark) => (
              <div className="reader-bookmark-row" key={bookmark.id}>
                <button
                  type="button"
                  className="reader-bookmark-item"
                  onClick={() => reader.openBookmark(props.book.id, bookmark.id)}
                >
                  <Bookmark className="reader-icon" />
                  <span>
                    <strong>{bookmark.label}</strong>
                    <small>{percent(bookmark.locator.progression)} · 本章位置</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="reader-bookmark-remove"
                  aria-label={`移除书签 ${bookmark.label}`}
                  onClick={() => reader.removeBookmark(props.book.id, bookmark.id)}
                >
                  <X className="reader-icon" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {annotations.length > 0 && (
        <>
          <div className="reader-rail-divider" />
          <div className="reader-rail-heading reader-rail-subheading reader-annotation-heading">
            <MessageSquarePlus className="reader-icon" />
            <span>笔记 · {annotations.length}</span>
          </div>
          <div className="reader-annotation-list">
            {annotations.map((annotation) => (
              <div className="reader-annotation-row" key={annotation.id}>
                <button
                  type="button"
                  className="reader-annotation-item"
                  onClick={() => reader.openAnnotation(props.book.id, annotation.id)}
                >
                  <MessageSquarePlus className="reader-icon" />
                  <span>
                    <strong>{annotation.label}</strong>
                    <small>{annotation.note}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="reader-annotation-remove"
                  aria-label={`移除笔记 ${annotation.label}`}
                  onClick={() => reader.removeAnnotation(props.book.id, annotation.id)}
                >
                  <X className="reader-icon" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="reader-rail-footer">
        <Settings2 className="reader-icon" />
        <span>阅读设置由本地配置驱动</span>
      </div>
    </aside>
  );
}
