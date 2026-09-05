import {
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronRight,
  Columns2,
  FileText,
  List,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  Type,
  X,
  Search,
  Download,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { sameLocator, type ReaderBook, type ReaderLocator } from "@bcr/reader-core";
import {
  type ReaderFontFamily,
  type ReaderLatinFontFamily,
  type ReaderSettings,
  type ReaderTheme,
} from "./model";
import {
  READER_CJK_FONT_OPTIONS,
  READER_LATIN_FONT_OPTIONS,
  readerFontStack,
} from "./readerTypography";
import { clamp, percent, themeIcon, themeLabel } from "./readerPresentation";
import { reader, useReader } from "./store";
import type { ReaderFullscreenState } from "./useReaderPlatform";
import { ReaderSheet } from "./ReaderSheet";

export function ReaderToolbar(props: {
  book: ReaderBook;
  settings: ReaderSettings;
  onAddAnnotation: () => void;
  onOpenDocument: () => void;
  documentHandoffBusy: boolean;
  fullscreen: ReaderFullscreenState;
  onInstall: () => void;
  showInstall: boolean;
}) {
  const sidebarOpen = useReader((state) => state.sidebarOpen);
  const activeSectionId = useReader((state) => state.activeSectionId);
  const progress = useReader((state) => state.progressByBook[props.book.id]?.percentage ?? 0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const locator = useReader((state) => state.progressByBook[props.book.id]?.locator);
  const bookmarked = useReader((state) => {
    if (locator === undefined) return false;
    return (state.bookmarksByBook[props.book.id] ?? []).some((bookmark) =>
      sameLocator(bookmark.locator, locator),
    );
  });
  const current =
    props.book.sections.find((section) => section.id === activeSectionId) ?? props.book.sections[0];
  return (
    <div className="reader-toolbar">
      <div className="reader-toolbar-title">
        {props.book.source.format !== "pdf" && (
          <button
            type="button"
            className="reader-icon-button"
            aria-label="切换漫画模式"
            aria-pressed={
              props.settings.books?.[props.book.id]?.comic ??
              (props.book.source.format === "cbz" ||
                props.book.rendition?.layout === "pre-paginated")
            }
            onClick={() => {
              window.dispatchEvent(new Event("bcr-reader-capture-progress"));
              const books = props.settings.books ?? {};
              const current =
                books[props.book.id]?.comic ??
                (props.book.source.format === "cbz" ||
                  props.book.rendition?.layout === "pre-paginated");
              reader.setSettings({
                books: { ...books, [props.book.id]: { ...books[props.book.id], comic: !current } },
              });
            }}
          >
            <Columns2 className="reader-icon" />
          </button>
        )}
        <button
          type="button"
          className="reader-icon-button reader-sidebar-toggle"
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
          <span className="reader-eyebrow">READING SESSION</span>
          <strong>{current?.label ?? "正文"}</strong>
        </div>
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
        <button
          type="button"
          className="reader-annotation-toggle"
          onClick={props.onAddAnnotation}
          aria-label="添加阅读笔记"
          title="添加阅读笔记"
        >
          <MessageSquarePlus className="reader-icon" />
          <span>笔记</span>
        </button>
        <button
          type="button"
          className={`reader-bookmark-toggle ${bookmarked ? "is-active" : ""}`}
          onClick={() => reader.toggleBookmark()}
          aria-pressed={bookmarked}
          aria-label={bookmarked ? "移除当前位置书签" : "标记当前位置"}
          title={bookmarked ? "移除当前位置书签" : "标记当前位置"}
        >
          <Bookmark className="reader-icon" />
          <span>{bookmarked ? "已标记" : "书签"}</span>
        </button>
        <button
          type="button"
          className="reader-document-handoff"
          onClick={props.onOpenDocument}
          disabled={props.documentHandoffBusy}
          aria-label="交给 Document Studio"
          title="交给 Document Studio"
        >
          <FileText className="reader-icon" />
          <span>{props.documentHandoffBusy ? "交接中…" : "交给 Document"}</span>
          <ArrowUpRight className="reader-icon" />
        </button>
        <span className="reader-locator">
          <Bookmark className="reader-icon" /> {percent(progress)}
        </span>
        <ThemeMenu settings={props.settings} />
        <LayoutMenu settings={props.settings} fixedLayout={props.book.source.format === "pdf"} />
        <FontFamilyMenu settings={props.settings} />
        <FontSizeMenu settings={props.settings} />
        <button
          type="button"
          className={`reader-icon-button reader-fullscreen-toggle ${props.fullscreen.isFullscreen ? "is-active" : ""}`}
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
          <span className="reader-control-label">
            {props.fullscreen.isFullscreen ? "退出全屏" : "全屏"}
          </span>
        </button>
      </div>
      <div className="reader-mobile-toolbar-actions" aria-label="常用阅读操作">
        <button
          type="button"
          className="reader-mobile-toolbar-button"
          aria-label="搜索书库"
          onClick={() => {
            reader.setSearchOpen(true);
            requestAnimationFrame(() =>
              document.querySelector<HTMLInputElement>(".reader-search input")?.focus(),
            );
          }}
        >
          <Search className="reader-icon" />
        </button>
        <button
          type="button"
          className="reader-mobile-toolbar-button reader-mobile-note-action"
          onClick={props.onAddAnnotation}
          aria-label="添加阅读笔记"
          title="添加阅读笔记"
        >
          <MessageSquarePlus className="reader-icon" />
        </button>
        <button
          type="button"
          className={`reader-mobile-toolbar-button ${bookmarked ? "is-active" : ""}`}
          onClick={() => reader.toggleBookmark()}
          aria-pressed={bookmarked}
          aria-label={bookmarked ? "移除当前位置书签" : "标记当前位置"}
          title={bookmarked ? "移除当前位置书签" : "标记当前位置"}
        >
          <Bookmark className="reader-icon" />
        </button>
        <button
          type="button"
          className={`reader-mobile-toolbar-button ${settingsOpen ? "is-active" : ""}`}
          onClick={() => setSettingsOpen(true)}
          aria-expanded={settingsOpen}
          aria-controls="reader-mobile-settings"
          aria-label="打开阅读设置"
          title="打开阅读设置"
        >
          <Settings2 className="reader-icon" />
        </button>
      </div>
      <ReaderSettingsSheet
        fixedLayout={props.book.source.format === "pdf"}
        onAddAnnotation={() => {
          setSettingsOpen(false);
          props.onAddAnnotation();
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

function ReaderSettingsSheet(props: {
  fixedLayout: boolean;
  onAddAnnotation: () => void;
  onInstall: () => void;
  showInstall: boolean;
  id: string;
  open: boolean;
  settings: ReaderSettings;
  onClose: () => void;
  onOpenDocument: () => void;
  documentHandoffBusy: boolean;
  fullscreen: ReaderFullscreenState;
}) {
  if (!props.open) return null;
  const themes: ReadonlyArray<ReaderTheme> = ["paper", "sage", "night"];
  const layouts: ReadonlyArray<ReaderSettings["layout"]> = ["scroll", "paged"];
  return (
    <ReaderSheet onClose={props.onClose} labelId="reader-mobile-settings-title">
      <section
        id={props.id}
        className="reader-mobile-sheet reader-settings-sheet"
        aria-labelledby="reader-mobile-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="reader-mobile-sheet-heading">
          <div>
            <span className="reader-eyebrow">VIEW MENU</span>
            <strong id="reader-mobile-settings-title">阅读设置</strong>
          </div>
          <button
            type="button"
            className="reader-icon-button"
            onClick={props.onClose}
            aria-label="关闭阅读设置"
          >
            <X className="reader-icon" />
          </button>
        </div>
        <div className="reader-mobile-settings-scroll">
          <section className="reader-mobile-setting-group" aria-label="阅读操作">
            <button type="button" className="reader-button" onClick={props.onAddAnnotation}>
              <MessageSquarePlus className="reader-icon" />
              添加阅读笔记
            </button>
            {props.showInstall && (
              <button
                type="button"
                className="reader-button"
                onClick={() => {
                  props.onClose();
                  props.onInstall();
                }}
              >
                <Download className="reader-icon" />
                安装到主屏幕
              </button>
            )}
          </section>
          <section className="reader-mobile-setting-group" aria-labelledby="reader-theme-label">
            <span id="reader-theme-label" className="reader-mobile-setting-label">
              阅读主题
            </span>
            <div className="reader-mobile-setting-options" role="group" aria-label="阅读主题">
              {themes.map((theme) => (
                <button
                  type="button"
                  key={theme}
                  className={`reader-mobile-setting-option ${props.settings.theme === theme ? "is-active" : ""}`}
                  onClick={() => reader.setSettings({ theme })}
                  aria-pressed={props.settings.theme === theme}
                >
                  {themeIcon(theme)}
                  <span>{themeLabel(theme)}</span>
                  {props.settings.theme === theme && <Check className="reader-icon" />}
                </button>
              ))}
            </div>
          </section>
          <section className="reader-mobile-setting-group" aria-labelledby="reader-layout-label">
            <span id="reader-layout-label" className="reader-mobile-setting-label">
              阅读方式
            </span>
            <div
              className="reader-mobile-setting-options reader-mobile-setting-options-two"
              role="group"
              aria-label="阅读方式"
            >
              {layouts.map((layout) => (
                <button
                  type="button"
                  key={layout}
                  disabled={props.fixedLayout && layout === "paged"}
                  title={
                    props.fixedLayout && layout === "paged" ? "PDF 使用连续页面阅读" : undefined
                  }
                  className={`reader-mobile-setting-option ${props.settings.layout === layout ? "is-active" : ""}`}
                  onClick={() => reader.setSettings({ layout })}
                  aria-pressed={props.settings.layout === layout}
                >
                  {layout === "scroll" ? (
                    <List className="reader-icon" />
                  ) : (
                    <Columns2 className="reader-icon" />
                  )}
                  <span>{layout === "scroll" ? "连续滚动" : "分页阅读"}</span>
                  {props.settings.layout === layout && <Check className="reader-icon" />}
                </button>
              ))}
            </div>
          </section>
          <section className="reader-mobile-setting-group" aria-labelledby="reader-font-label">
            <div className="reader-mobile-setting-label-row">
              <span id="reader-font-label" className="reader-mobile-setting-label">
                正文字号
              </span>
              <span className="reader-mobile-setting-value">{props.settings.fontSize}px</span>
            </div>
            <div className="reader-mobile-font-stepper">
              <button
                type="button"
                onClick={() =>
                  reader.setSettings({
                    fontSize: clamp(props.settings.fontSize - 1, 15, 26),
                  })
                }
                disabled={props.settings.fontSize <= 15}
                aria-label="减小字号"
              >
                <Minus className="reader-icon" />
              </button>
              <span aria-live="polite" style={{ fontFamily: readerFontStack(props.settings) }}>
                Aa
              </span>
              <button
                type="button"
                onClick={() =>
                  reader.setSettings({
                    fontSize: clamp(props.settings.fontSize + 1, 15, 26),
                  })
                }
                disabled={props.settings.fontSize >= 26}
                aria-label="增大字号"
              >
                <Plus className="reader-icon" />
              </button>
            </div>
          </section>
          <section
            className="reader-mobile-setting-group"
            aria-labelledby="reader-cjk-font-family-label"
          >
            <span id="reader-cjk-font-family-label" className="reader-mobile-setting-label">
              中文字体
            </span>
            <div
              className="reader-mobile-setting-options reader-mobile-font-options"
              role="group"
              aria-label="中文字体"
            >
              {READER_CJK_FONT_OPTIONS.map((font) => (
                <button
                  type="button"
                  key={font.id}
                  className={`reader-mobile-setting-option reader-mobile-font-option ${props.settings.fontFamily === font.id ? "is-active" : ""}`}
                  onClick={() => reader.setSettings({ fontFamily: font.id })}
                  aria-pressed={props.settings.fontFamily === font.id}
                >
                  <strong style={{ fontFamily: font.stack }}>阅</strong>
                  <span>{font.label}</span>
                  {props.settings.fontFamily === font.id && <Check className="reader-icon" />}
                </button>
              ))}
            </div>
          </section>
          <section
            className="reader-mobile-setting-group"
            aria-labelledby="reader-latin-font-family-label"
          >
            <span id="reader-latin-font-family-label" className="reader-mobile-setting-label">
              English typeface
            </span>
            <div
              className="reader-mobile-setting-options reader-mobile-font-options"
              role="group"
              aria-label="英文字体"
            >
              {READER_LATIN_FONT_OPTIONS.map((font) => (
                <button
                  type="button"
                  key={font.id}
                  className={`reader-mobile-setting-option reader-mobile-font-option ${props.settings.latinFontFamily === font.id ? "is-active" : ""}`}
                  onClick={() => reader.setSettings({ latinFontFamily: font.id })}
                  aria-pressed={props.settings.latinFontFamily === font.id}
                >
                  <strong style={{ fontFamily: `${font.stack}, sans-serif` }}>Ag</strong>
                  <span>{font.label}</span>
                  {props.settings.latinFontFamily === font.id && <Check className="reader-icon" />}
                </button>
              ))}
            </div>
          </section>
          <section className="reader-mobile-setting-group" aria-labelledby="reader-width-label">
            <span id="reader-width-label" className="reader-mobile-setting-label">
              正文宽度
            </span>
            <div
              className="reader-mobile-setting-options reader-mobile-setting-options-two"
              role="group"
              aria-label="正文宽度"
            >
              {(["narrow", "wide"] as const).map((contentWidth) => (
                <button
                  type="button"
                  key={contentWidth}
                  className={`reader-mobile-setting-option ${props.settings.contentWidth === contentWidth ? "is-active" : ""}`}
                  onClick={() => reader.setSettings({ contentWidth })}
                  aria-pressed={props.settings.contentWidth === contentWidth}
                >
                  <span>{contentWidth === "narrow" ? "舒适" : "宽屏"}</span>
                  {props.settings.contentWidth === contentWidth && (
                    <Check className="reader-icon" />
                  )}
                </button>
              ))}
            </div>
          </section>
          <section
            className="reader-mobile-setting-group reader-mobile-setting-group-actions"
            aria-labelledby="reader-actions-label"
          >
            <span id="reader-actions-label" className="reader-mobile-setting-label">
              更多操作
            </span>
            <div className="reader-mobile-action-list">
              <button
                type="button"
                onClick={() => {
                  props.onClose();
                  props.onOpenDocument();
                }}
                disabled={props.documentHandoffBusy}
              >
                <FileText className="reader-icon" />
                <span>{props.documentHandoffBusy ? "正在交接…" : "交给 Document Studio"}</span>
                <ArrowUpRight className="reader-icon" />
              </button>
              <button
                type="button"
                onClick={() => {
                  props.onClose();
                  void props.fullscreen.toggle();
                }}
                disabled={!props.fullscreen.supported}
              >
                {props.fullscreen.isFullscreen ? (
                  <Minimize2 className="reader-icon" />
                ) : (
                  <Maximize2 className="reader-icon" />
                )}
                <span>{props.fullscreen.isFullscreen ? "退出全屏" : "进入全屏"}</span>
                <ChevronRight className="reader-icon" />
              </button>
            </div>
          </section>
        </div>
      </section>
    </ReaderSheet>
  );
}

export function AnnotationComposer(props: {
  value: string;
  onChange: (value: string) => void;
  anchor: ReaderLocator | null;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <ReaderSheet onClose={props.onCancel} labelId="reader-note-title">
      <form className="reader-annotation-composer reader-note-sheet" onSubmit={props.onSubmit}>
        <div className="reader-annotation-composer-heading">
          <div>
            <span className="reader-eyebrow">NEW NOTE</span>
            <strong id="reader-note-title">把这一刻留下来</strong>
          </div>
          <button
            type="button"
            className="reader-icon-button"
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
            className="reader-button reader-button-primary"
            disabled={!props.value.trim()}
          >
            保存笔记
          </button>
        </div>
      </form>
    </ReaderSheet>
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

function LayoutMenu(props: { settings: ReaderSettings; fixedLayout: boolean }) {
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
        disabled={props.fixedLayout}
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

function FontFamilyMenu(props: { settings: ReaderSettings }) {
  return (
    <div className="reader-font-family-menu" title="中英文字体">
      <Type className="reader-icon" aria-hidden="true" />
      <select
        aria-label="中文字体"
        value={props.settings.fontFamily}
        onChange={(event) =>
          reader.setSettings({ fontFamily: event.currentTarget.value as ReaderFontFamily })
        }
      >
        {READER_CJK_FONT_OPTIONS.map((font) => (
          <option value={font.id} key={font.id}>
            {font.shortLabel}
          </option>
        ))}
      </select>
      <span className="reader-font-family-divider" aria-hidden="true" />
      <select
        aria-label="英文字体"
        value={props.settings.latinFontFamily}
        onChange={(event) =>
          reader.setSettings({
            latinFontFamily: event.currentTarget.value as ReaderLatinFontFamily,
          })
        }
      >
        {READER_LATIN_FONT_OPTIONS.map((font) => (
          <option value={font.id} key={font.id}>
            {font.shortLabel}
          </option>
        ))}
      </select>
    </div>
  );
}
