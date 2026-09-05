import type { CSSProperties } from "react";
import type { ReaderSettings } from "./model";
import { DEFAULT_READER_SETTINGS } from "./model";
import { reader } from "./store";
import { readerTypographyStyle, READER_TYPOGRAPHY_PRESETS } from "./readerTypography";
import { useReaderFonts } from "./useReaderFonts";
import "./reader-typography.css";
import notoLicense from "@fontsource-variable/noto-serif-sc/LICENSE?raw";
import notoSansLicense from "@fontsource-variable/noto-sans-sc/LICENSE?raw";
import literataLicense from "@fontsource-variable/literata/LICENSE?raw";
import atkinsonLicense from "@fontsource-variable/atkinson-hyperlegible-next/LICENSE?raw";
import wenkaiLicense from "lxgw-wenkai-webfont/OFL.txt?raw";
import wenkaiWebLicense from "lxgw-wenkai-webfont/LICENSE?raw";

export function ReaderTypographySettings({
  settings,
  fixedLayout,
}: {
  settings: ReaderSettings;
  fixedLayout: boolean;
}) {
  const fonts = useReaderFonts(settings, !fixedLayout);
  if (fixedLayout)
    return (
      <p className="reader-typography-note">
        PDF 与漫画图片保留原版字形；以下正文排版设置用于可重排的书籍和文章。
      </p>
    );
  return (
    <section className="reader-mobile-setting-group" aria-label="正文排版方案">
      <span className="reader-mobile-setting-label">选择适合自己的阅读方式</span>
      <div className="reader-typography-presets">
        {READER_TYPOGRAPHY_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-label={`应用${preset.label}排版`}
            aria-pressed={Object.entries(preset.settings).every(
              ([key, value]) => settings[key as keyof ReaderSettings] === value,
            )}
            onClick={() =>
              reader.setSettings({
                ...preset.settings,
                fontSize: window.matchMedia("(max-width: 860px)").matches ? 21 : 20,
                contentWidth: "narrow",
              })
            }
          >
            <strong>{preset.label}</strong>
            <small>{preset.description}</small>
          </button>
        ))}
      </div>
      <div
        className="reader-typography-preview"
        style={readerTypographyStyle(settings) as CSSProperties}
        aria-label="中英混排预览"
      >
        <span className="reader-eyebrow">LIVE PREVIEW</span>
        <div className="reader-prose">
          <p>春山可望，文字有自己的呼吸。读到这里，不必着急翻向下一页。</p>
          <p>阅读进度由 Locator 记录，搜索通过 SQLite FTS5 找回原文。</p>
          <p lang="en">Reading is a quiet conversation. Il1 · O0 · 2026.</p>
        </div>
      </div>
      <p className="reader-typography-note" role="status">
        {fonts.status === "loading"
          ? "正在加载所选字体，正文暂用系统字体显示…"
          : fonts.status === "error"
            ? "字体暂时无法加载，已回退到系统字体。"
            : "字体已就绪 · 本站按需加载。离线时，未缓存的字形使用系统字体。"}
        {fonts.status === "error" && (
          <button type="button" onClick={fonts.retry}>
            重试加载字体
          </button>
        )}
      </p>
      <div className="reader-typography-fields">
        <label>
          <input
            type="checkbox"
            checked={settings.pageSpread ?? false}
            onChange={(event) => reader.setSettings({ pageSpread: event.target.checked })}
          />
          大屏双页（空间不足时自动单页）
        </label>
        <label>
          正文字重
          <select
            aria-label="正文字重"
            value={settings.fontFamily === "kai" ? 400 : (settings.fontWeight ?? 400)}
            disabled={settings.fontFamily === "kai"}
            onChange={(event) => reader.setSettings({ fontWeight: Number(event.target.value) })}
          >
            <option value={350}>350 · 轻一些</option>
            <option value={400}>400 · 标准</option>
            <option value={500}>500 · 厚一些</option>
          </select>
        </label>
        <label>
          行高 <output>{settings.lineHeight.toFixed(2)}</output>
          <input
            aria-label="正文行高"
            type="range"
            min={1.4}
            max={2.2}
            step={0.05}
            value={settings.lineHeight}
            onChange={(event) => reader.setSettings({ lineHeight: Number(event.target.value) })}
          />
        </label>
        <label>
          段间距 <output>{(settings.paragraphSpacing ?? 0.65).toFixed(2)} em</output>
          <input
            aria-label="正文段间距"
            type="range"
            min={0.3}
            max={1.2}
            step={0.05}
            value={settings.paragraphSpacing ?? 0.65}
            onChange={(event) =>
              reader.setSettings({ paragraphSpacing: Number(event.target.value) })
            }
          />
        </label>
        <label>
          正文行宽{" "}
          <output>约 {settings.lineLength ?? DEFAULT_READER_SETTINGS.lineLength} 个中文字</output>
          <input
            aria-label="正文行宽"
            type="range"
            min={28}
            max={44}
            step={1}
            value={settings.lineLength ?? DEFAULT_READER_SETTINGS.lineLength}
            onChange={(event) =>
              reader.setSettings({ lineLength: Number(event.target.value), contentWidth: "narrow" })
            }
          />
        </label>
      </div>
      <p className="reader-typography-note">
        小屏幕按可用宽度排版；文楷正文使用 Regular 400。预设只是起点，可以继续微调。
      </p>
      <button
        type="button"
        className="reader-button"
        onClick={() =>
          reader.setSettings({
            fontFamily: DEFAULT_READER_SETTINGS.fontFamily,
            latinFontFamily: DEFAULT_READER_SETTINGS.latinFontFamily,
            fontSize: DEFAULT_READER_SETTINGS.fontSize,
            fontWeight: 400,
            lineHeight: DEFAULT_READER_SETTINGS.lineHeight,
            paragraphSpacing: 0.65,
            lineLength: DEFAULT_READER_SETTINGS.lineLength!,
            contentWidth: "narrow",
          })
        }
      >
        恢复默认正文排版
      </button>
      <details className="reader-font-licenses">
        <summary>字体来源与开源许可</summary>
        {[
          ["Noto Serif SC", notoLicense],
          ["Noto Sans SC", notoSansLicense],
          ["Literata", literataLicense],
          ["Atkinson Hyperlegible Next", atkinsonLicense],
          ["LXGW WenKai", wenkaiLicense],
          ["LXGW WenKai Webfont", wenkaiWebLicense],
        ].map(([name, license]) => (
          <details key={name}>
            <summary>{name}</summary>
            <pre>{license}</pre>
          </details>
        ))}
      </details>
    </section>
  );
}
