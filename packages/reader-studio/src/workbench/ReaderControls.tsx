import { WorkspaceTrigger } from "@bcr/react";
import { currentTxtChapter } from "../content/txtChapters";
import {
  Bookmark,
  BookOpen,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  X,
  Search,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { sameLocator, type ReaderBook, type ReaderLocator } from "@bcr/reader-core";
import { readerUsesPagedText, type ReaderSettings } from "../state/model";
import { percent } from "../reading/readerPresentation";
import { getReaderState, reader } from "../state/store";
import { useReader } from "../state/useReader";
import type { ReaderFullscreenState } from "./useReaderPlatform";
import { ReaderSheet } from "./ReaderSheet";
import { useReaderMobile } from "./useReaderMobile";
import { ReaderSettingsSheet } from "./ReaderSettingsSheet";
import { ReaderNavigationButton } from "../navigation/ReaderNavigation";
import { readerSelectionLocator } from "../reading/readingPosition";

export function ReaderToolbar(props: {
  book: ReaderBook;
  libraryControlsRef: (element: HTMLDivElement | null) => void;
  settings: ReaderSettings;
  onAddAnnotation: (locator?: ReaderLocator) => void;
  onOpenDocument: () => void;
  documentHandoffBusy: boolean;
  fullscreen: ReaderFullscreenState;
  onInstall: () => void;
  showInstall: boolean;
  onFocusReading: () => void;
}) {
  const mobile = useReaderMobile();
  const sidebarOpen = useReader((state) => state.sidebarOpen);
  const activeSectionId = useReader((state) => state.activeSectionId);
  const progress = useReader((state) => state.progressByBook[props.book.id]?.percentage ?? 0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectionBeforeSettings = useRef<ReaderLocator | undefined>(undefined);
  const openSettings = () => {
    selectionBeforeSettings.current = readerSelectionLocator(props.book);
    if (props.settings.layout === "paged")
      window.dispatchEvent(new Event("bcr-reader-capture-progress"));
    setSettingsOpen(true);
  };
  const locator = useReader((state) => state.progressByBook[props.book.id]?.locator);
  const bookmarked = useReader((state) => {
    if (locator === undefined) return false;
    return (state.bookmarksByBook[props.book.id] ?? []).some((bookmark) =>
      sameLocator(bookmark.locator, locator),
    );
  });
  const current =
    currentTxtChapter(props.book, activeSectionId) ??
    props.book.sections.find((section) => section.id === activeSectionId) ??
    props.book.sections[0];
  const openBookSearch = () => {
    if (getReaderState().searchScope !== "book") reader.setSearchScope("book");
    reader.setSearchOpen(true);
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(".reader-search input")?.focus(),
    );
  };
  return (
    <div className="reader-toolbar" data-demo={props.book.tags.includes("DEMO")}>
      <div className="reader-toolbar-title">
        <WorkspaceTrigger />
        {mobile ? (
          <button
            type="button"
            className="reader-mobile-book-title"
            aria-label={sidebarOpen ? "收起书库" : "打开书库"}
            aria-expanded={sidebarOpen}
            onClick={() => reader.toggleSidebar()}
          >
            <BookOpen className="reader-icon" />
            <span>
              <strong>{props.book.title}</strong>
              <small>我的书库</small>
            </span>
          </button>
        ) : (
          <>
            <button
              type="button"
              className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg reader-sidebar-toggle"
              onClick={() => reader.toggleSidebar()}
              aria-label={sidebarOpen ? "收起书库" : "打开书库"}
              title={sidebarOpen ? "收起书库" : "打开书库"}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="reader-icon" />
              ) : (
                <PanelLeftOpen className="reader-icon" />
              )}
            </button>
            <div>
              <span className="ui-section-label">READING SESSION</span>
              <strong>
                {props.book.source.format === "txt" && !props.book.toc?.length
                  ? props.book.title
                  : (current?.label ?? "正文")}
              </strong>
            </div>
          </>
        )}
      </div>
      <div
        className="reader-mobile-progress"
        role="progressbar"
        aria-label="阅读进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-valuetext={percent(progress)}
      >
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="reader-toolbar-actions reader-toolbar-actions-desktop">
        {readerUsesPagedText(props.book, props.settings) && (
          <button
            type="button"
            className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
            aria-label="专注阅读"
            title="专注阅读 · 点击正文中央恢复工具栏"
            onClick={props.onFocusReading}
          >
            <BookOpen className="reader-icon" />
          </button>
        )}
        <ReaderNavigationButton book={props.book} />
        <button
          type="button"
          className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
          aria-label="在当前读物中搜索"
          onClick={openBookSearch}
        >
          <Search className="reader-icon" />
        </button>
        <button
          type="button"
          className={`ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg reader-bookmark-toggle ${bookmarked ? "is-active" : ""}`}
          onClick={() => reader.toggleBookmark()}
          aria-pressed={bookmarked}
          aria-label={bookmarked ? "移除当前位置书签" : "标记当前位置"}
          title={bookmarked ? "移除当前位置书签" : "标记当前位置"}
        >
          <Bookmark className="reader-icon" fill={bookmarked ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
          aria-label="打开阅读设置"
          title="阅读设置"
          aria-expanded={settingsOpen}
          aria-controls="reader-mobile-settings"
          onClick={openSettings}
        >
          <Settings2 className="reader-icon" />
        </button>
        <button
          type="button"
          className={`ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg reader-fullscreen-toggle ${props.fullscreen.isFullscreen ? "is-active" : ""}`}
          onClick={() => void props.fullscreen.toggle()}
          disabled={!props.fullscreen.supported}
          aria-label={props.fullscreen.isFullscreen ? "退出全屏" : "进入全屏"}
          aria-pressed={props.fullscreen.isFullscreen}
          title={
            props.fullscreen.supported
              ? props.fullscreen.isFullscreen
                ? "退出全屏（Esc）"
                : "进入全屏"
              : "当前浏览器不支持全屏"
          }
        >
          {props.fullscreen.isFullscreen ? (
            <Minimize2 className="reader-icon" />
          ) : (
            <Maximize2 className="reader-icon" />
          )}
        </button>
      </div>
      <div className="reader-mobile-toolbar-actions" aria-label="常用阅读操作">
        <button
          type="button"
          className="reader-mobile-toolbar-button"
          aria-label="在当前读物中搜索"
          onClick={openBookSearch}
        >
          <Search className="reader-icon" />
        </button>
        <button
          type="button"
          className={`reader-mobile-toolbar-button ${settingsOpen ? "is-active" : ""}`}
          onClick={openSettings}
          aria-expanded={settingsOpen}
          aria-controls="reader-mobile-settings"
          aria-label="打开阅读设置"
          title="打开阅读设置"
        >
          <Settings2 className="reader-icon" />
        </button>
      </div>
      <div className="reader-library-actions" ref={props.libraryControlsRef} />
      <ReaderSettingsSheet
        bookmarked={bookmarked}
        txt={props.book.source.format === "txt"}
        fixedLayout={props.book.source.format === "pdf"}
        comicMode={
          props.settings.books?.[props.book.id]?.comic ??
          (props.book.source.format === "cbz" || props.book.rendition?.layout === "pre-paginated")
        }
        onAddAnnotation={() => {
          setSettingsOpen(false);
          props.onAddAnnotation(selectionBeforeSettings.current);
        }}
        onInstall={props.onInstall}
        showInstall={props.showInstall}
        id="reader-mobile-settings"
        open={settingsOpen}
        settings={props.settings}
        onClose={() => setSettingsOpen(false)}
        onOpenDocument={props.onOpenDocument}
        documentHandoffBusy={props.documentHandoffBusy}
        fullscreen={props.fullscreen}
      />
    </div>
  );
}

export function AnnotationComposer(props: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  anchor: ReaderLocator | null;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <ReaderSheet open={props.open} onClose={props.onCancel} labelId="reader-note-title">
      <form className="reader-annotation-composer reader-note-sheet" onSubmit={props.onSubmit}>
        <div className="reader-annotation-composer-heading">
          <div>
            <span className="ui-section-label">NEW NOTE</span>
            <strong id="reader-note-title">把这一刻留下来</strong>
          </div>
          <button
            type="button"
            className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
            aria-label="取消添加笔记"
            onClick={props.onCancel}
          >
            <X className="reader-icon" />
          </button>
        </div>
        <textarea
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder="写下你的想法、疑问或下一步…"
          maxLength={2_000}
          autoFocus
          aria-label="笔记内容"
        />
        <div className="reader-annotation-composer-footer">
          <span>
            {props.anchor?.textAnchor?.exact === undefined
              ? "自动锚定当前位置"
              : `已锚定选段「${props.anchor.textAnchor.exact.slice(0, 28)}${props.anchor.textAnchor.exact.length > 28 ? "…" : ""}」`}{" "}
            · {props.value.length}/2000
          </span>
          <button
            type="submit"
            className="ui-btn ui-btn-lg ui-btn-primary"
            disabled={!props.value.trim()}
          >
            保存笔记
          </button>
        </div>
      </form>
    </ReaderSheet>
  );
}
