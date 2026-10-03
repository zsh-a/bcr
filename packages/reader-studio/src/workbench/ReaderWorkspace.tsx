import { WorkspaceTrigger } from "@bcr/react";
import { ChevronRight, Menu, Search, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
  type CSSProperties,
} from "react";
import { type ReaderLocator, type SearchHit } from "@bcr/reader-core";
import { activeBook, readerUsesPagedText } from "../state/model";
import { AnnotationComposer, ReaderToolbar } from "./ReaderControls";
import { ReadingView } from "../reading/ReadingView";
import { loadReaderSelection } from "../reading/readingPosition";
import { openSearchHit } from "../search/readerSearchNavigation";
import type { ReaderRuntime } from "../runtime";
import { reader } from "../state/store";
import { useReader } from "../state/useReader";
import { useReaderFullscreen } from "./useReaderPlatform";
import { persistReaderSnapshot } from "./useReaderRuntime";
import { ReaderSheet } from "./ReaderSheet";
import { useReaderMobile } from "./useReaderMobile";
import { ReaderHistoryBar } from "../navigation/ReaderHistoryBar";
import { ReaderProgressScrubber } from "../navigation/ReaderProgressScrubber";
import { ReaderSelectionCapture } from "../reading/ReaderSelectionCapture";
import { ReaderSearchInput } from "./ReaderChrome";
import { LibraryPanel } from "../library/ReaderLibrary";
import { ReaderNavigationProvider } from "../navigation/ReaderNavigation";

export function ReaderWorkspace(props: {
  workspaceCollections: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  onLibraryControlsMount: (element: HTMLDivElement | null) => void;
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
    <ReaderNavigationProvider book={active}>
      <div
        className={`reader-workspace ${sidebarOpen ? "sidebar-visible" : "sidebar-hidden"}`}
        style={
          { "--reader-navigation-width": `${settings.navigationWidth ?? 304}px` } as CSSProperties
        }
      >
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
            <>
              <WorkspaceTrigger className="reader-quiet-workspace" />
              <button
                type="button"
                className="reader-mobile-chrome-reveal"
                onClick={props.onToggleMobileChrome}
                aria-label="显示阅读工具栏"
                title="显示阅读工具栏"
              >
                <Menu className="reader-icon" />
              </button>
            </>
          )}
          {mobile ? (
            <ReaderSheet
              open={searchOpen}
              labelId="reader-search-title"
              onClose={() => reader.setSearchOpen(false)}
              className="reader-mobile-sheet-layer reader-search-layer"
            >
              <SearchPanel hits={searchHits} searchRef={props.searchRef} />
            </ReaderSheet>
          ) : (
            searchOpen && <SearchPanel hits={searchHits} searchRef={props.searchRef} />
          )}
          <ReaderToolbar
            libraryControlsRef={props.onLibraryControlsMount}
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
          <ReadingView
            runtime={props.runtime}
            book={active}
            onToggleMobileChrome={props.onToggleMobileChrome}
            onImport={props.onImport}
          />
          {!mobile &&
            (settings.books?.[active.id]?.comic ??
              (active.source.format === "cbz" || active.rendition?.layout === "pre-paginated")) && (
              <div className="reader-comic-footer">
                <ReaderProgressScrubber book={active} />
                <ReaderHistoryBar />
              </div>
            )}
        </main>
      </div>
    </ReaderNavigationProvider>
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

function SearchPanel(props: {
  hits: ReadonlyArray<SearchHit>;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
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
      <div className="reader-search-panel-heading">
        <strong id="reader-search-title">搜索原文</strong>
        <button
          type="button"
          className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
          onClick={() => reader.setSearchOpen(false)}
          aria-label="关闭搜索结果"
        >
          <X className="reader-icon" />
        </button>
      </div>
      <ReaderSearchInput searchRef={props.searchRef} />
      <div className="reader-search-panel-top">
        <div>
          <strong>
            {searchBusy
              ? "正在搜索…"
              : searchError
                ? "搜索遇到问题"
                : `${props.hits.length} 个命中${searchTruncated ? " · 已截断" : ""}`}
          </strong>
        </div>
        <span className="reader-search-query">{query ? `“${query}”` : "输入关键词查找原文"}</span>
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
