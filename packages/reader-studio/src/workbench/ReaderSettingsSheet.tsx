import { ResourceViews } from "@bcr/react";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronRight,
  Columns2,
  Download,
  FileText,
  List,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import type { ReaderSettings, ReaderTheme } from "../state/model";
import {
  READER_CJK_FONT_OPTIONS,
  READER_LATIN_FONT_OPTIONS,
  readerFontStack,
} from "../typography/readerTypography";
import { clamp, themeIcon, themeLabel } from "../reading/readerPresentation";
import { getReaderState, reader } from "../state/store";
import { useReader } from "../state/useReader";
import { ReaderTypographySettings } from "../typography/ReaderTypographySettings";
import type { ReaderFullscreenState } from "./useReaderPlatform";
import { ReaderSheet } from "./ReaderSheet";
import { useReaderMobile } from "./useReaderMobile";

export function ReaderSettingsSheet(props: {
  txt: boolean;
  comicMode: boolean;
  fixedLayout: boolean;
  onAddAnnotation: () => void;
  bookmarked: boolean;
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
  const mobile = useReaderMobile();
  const bookId = useReader((state) => state.activeBookId);
  const pdfColor = useReader((state) =>
    bookId ? state.settings.books?.[bookId]?.pdfColor : undefined,
  );
  const fixed = props.fixedLayout || props.comicMode;
  const [tab, setTab] = useState<"reading" | "typography" | "tools">("reading");
  useEffect(() => {
    if (props.open) setTab("reading");
  }, [props.open]);
  const themes: ReadonlyArray<ReaderTheme> = ["paper", "sage", "night"];
  const layouts: ReadonlyArray<ReaderSettings["layout"]> = ["scroll", "paged"];
  return (
    <ReaderSheet open={props.open} onClose={props.onClose} labelId="reader-mobile-settings-title">
      <section
        id={props.id}
        className="reader-mobile-sheet reader-settings-sheet"
        aria-labelledby="reader-mobile-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="reader-mobile-sheet-heading">
          <div>
            <span className="ui-section-label">VIEW MENU</span>
            <strong id="reader-mobile-settings-title">阅读设置</strong>
          </div>
          <button
            type="button"
            className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
            onClick={props.onClose}
            aria-label="关闭阅读设置"
          >
            <X className="reader-icon" />
          </button>
        </div>
        {mobile && (
          <ResourceViews
            className="reader-settings-tabs"
            label="阅读设置分类"
            views={[
              { id: "reading", label: "阅读" },
              ...(!fixed ? [{ id: "typography" as const, label: "排版" }] : []),
              { id: "tools", label: "工具" },
            ]}
            value={tab}
            onValueChange={setTab}
          />
        )}
        <div key={mobile ? tab : "all"} className="reader-mobile-settings-scroll">
          <div hidden={mobile && tab !== "reading"}>
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
            {!fixed && (
              <>
                <section
                  className="reader-mobile-setting-group"
                  aria-labelledby="reader-layout-label"
                >
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
                          props.fixedLayout && layout === "paged"
                            ? "PDF 使用连续页面阅读"
                            : undefined
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
                <section
                  className="reader-mobile-setting-group"
                  aria-labelledby="reader-font-label"
                >
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
                    <span
                      aria-live="polite"
                      style={{ fontFamily: readerFontStack(props.settings) }}
                    >
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
              </>
            )}
            {props.fixedLayout && (
              <section className="reader-mobile-setting-group" aria-label="PDF 页面颜色">
                <span className="reader-mobile-setting-label">PDF 页面颜色</span>
                <div
                  className="reader-mobile-setting-options"
                  role="group"
                  aria-label="PDF 页面颜色"
                >
                  {(["original", "paper", "night"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="reader-mobile-setting-option"
                      aria-pressed={
                        (pdfColor ?? (props.settings.theme === "night" ? "night" : "original")) ===
                        value
                      }
                      onClick={() => {
                        if (!bookId) return;
                        const books = getReaderState().settings.books ?? {};
                        reader.setSettings({
                          books: { ...books, [bookId]: { ...books[bookId], pdfColor: value } },
                        });
                      }}
                    >
                      {value === "original" ? "原色" : value === "paper" ? "柔和纸色" : "夜间"}
                    </button>
                  ))}
                </div>
                <p className="reader-typography-note">
                  双指缩放查看细节，双击在放大与适合宽度间切换。图片、图表需要准确配色时请选择原色。
                </p>
              </section>
            )}
          </div>
          {!fixed && (
            <div hidden={mobile && tab !== "typography"}>
              <ReaderTypographySettings
                settings={props.settings}
                txtPaged={props.txt && props.settings.layout === "paged"}
                fixedLayout={props.fixedLayout || props.comicMode}
              />
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
                      <small>{font.description}</small>
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
                  英文字体
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
                      <small>{font.description}</small>
                      {props.settings.latinFontFamily === font.id && (
                        <Check className="reader-icon" />
                      )}
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
            </div>
          )}
          <div hidden={mobile && tab !== "tools"}>
            <section className="reader-mobile-setting-group" aria-label="阅读操作">
              <button
                type="button"
                className="ui-btn ui-btn-lg ui-btn-default"
                onClick={props.onAddAnnotation}
              >
                <MessageSquarePlus className="reader-icon" />
                添加阅读笔记
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-lg ui-btn-default"
                aria-pressed={props.bookmarked}
                onClick={() => reader.toggleBookmark()}
              >
                <Bookmark className="reader-icon" />
                {props.bookmarked ? "移除当前位置书签" : "标记当前位置"}
              </button>
              {props.showInstall && (
                <button
                  type="button"
                  className="ui-btn ui-btn-lg ui-btn-default"
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
            </section>{" "}
          </div>
        </div>
      </section>
    </ReaderSheet>
  );
}
