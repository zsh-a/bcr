import {
  DEFAULT_READER_SETTINGS,
  type ReaderFontFamily,
  type ReaderLatinFontFamily,
  type ReaderSettings,
} from "./model";

export function normalizeReaderTypography(settings: ReaderSettings): ReaderSettings {
  const bounded = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  return {
    ...settings,
    fontFamily: READER_CJK_FONT_OPTIONS.some((font) => font.id === settings.fontFamily)
      ? settings.fontFamily
      : DEFAULT_READER_SETTINGS.fontFamily,
    latinFontFamily: READER_LATIN_FONT_OPTIONS.some((font) => font.id === settings.latinFontFamily)
      ? settings.latinFontFamily
      : DEFAULT_READER_SETTINGS.latinFontFamily,
    fontSize: bounded(settings.fontSize, 20, 12, 48),
    lineHeight: bounded(settings.lineHeight, DEFAULT_READER_SETTINGS.lineHeight, 1, 3),
    fontWeight: [350, 400, 500].includes(settings.fontWeight ?? 400)
      ? (settings.fontWeight ?? 400)
      : 400,
    paragraphSpacing: bounded(settings.paragraphSpacing, 0.65, 0.3, 1.2),
    lineLength: bounded(settings.lineLength, DEFAULT_READER_SETTINGS.lineLength!, 28, 44),
  };
}

export interface ReaderFontOption<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly shortLabel: string;
  readonly stack: string;
  readonly description?: string;
}

export const READER_CJK_FONT_OPTIONS: ReadonlyArray<ReaderFontOption<ReaderFontFamily>> = [
  {
    id: "sans",
    label: "Noto 黑体",
    shortLabel: "Noto 黑体",
    description: "网页、技术文章 · 清晰简洁",
    stack:
      '"Noto Sans SC Variable", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    id: "serif",
    label: "Noto 宋体",
    shortLabel: "Noto 宋体",
    description: "思源宋体体系 · 长文、非虚构",
    stack:
      '"Noto Serif SC Variable", "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", STSong, SimSun, serif',
  },
  {
    id: "kai",
    label: "霞鹜文楷",
    shortLabel: "文楷",
    description: "小说、文学 · 温润舒展",
    stack: '"LXGW WenKai", "Kaiti SC", STKaiti, KaiTi, serif',
  },
];

export const READER_LATIN_FONT_OPTIONS: ReadonlyArray<ReaderFontOption<ReaderLatinFontFamily>> = [
  {
    id: "literata",
    label: "Literata",
    shortLabel: "Literata",
    description: "英文小说、长文",
    stack: '"Literata Variable"',
  },
  {
    id: "atkinson",
    label: "Atkinson Hyperlegible Next",
    shortLabel: "Atkinson",
    description: "技术资料 · 易混字符辨识",
    stack: '"Atkinson Hyperlegible Next Variable"',
  },
  {
    id: "sans",
    label: "Plex Sans",
    shortLabel: "Sans",
    stack: '"IBM Plex Sans"',
  },
  {
    id: "serif",
    label: "Georgia",
    shortLabel: "Serif",
    stack: "Georgia",
  },
  {
    id: "mono",
    label: "Plex Mono",
    shortLabel: "Mono",
    stack: '"IBM Plex Mono"',
  },
];

export const READER_TYPOGRAPHY_PRESETS = [
  {
    id: "screen",
    label: "舒适屏幕",
    description: "黑体 × Plex Sans · 默认",
    settings: {
      fontFamily: "sans",
      latinFontFamily: "sans",
      fontWeight: 400,
      lineHeight: 1.7,
      paragraphSpacing: 0.65,
      lineLength: 34,
    },
  },
  {
    id: "longform",
    label: "中文长文",
    description: "宋体 × Literata",
    settings: {
      fontFamily: "serif",
      latinFontFamily: "literata",
      fontWeight: 400,
      lineHeight: 1.75,
      paragraphSpacing: 0.65,
      lineLength: 36,
    },
  },
  {
    id: "literature",
    label: "小说文学",
    description: "文楷 × Literata",
    settings: {
      fontFamily: "kai",
      latinFontFamily: "literata",
      fontWeight: 400,
      lineHeight: 1.8,
      paragraphSpacing: 0.7,
      lineLength: 34,
    },
  },
  {
    id: "technical",
    label: "技术资料",
    description: "黑体 × Atkinson",
    settings: {
      fontFamily: "sans",
      latinFontFamily: "atkinson",
      fontWeight: 400,
      lineHeight: 1.7,
      paragraphSpacing: 0.6,
      lineLength: 40,
    },
  },
] as const;

export function readerLineWidth(settings: ReaderSettings): number {
  return settings.contentWidth === "wide"
    ? 970
    : (settings.lineLength ?? DEFAULT_READER_SETTINGS.lineLength!) * settings.fontSize;
}

export function readerTypographyStyle(settings: ReaderSettings): Record<string, string | number> {
  return {
    "--reader-reader-font-family": readerFontStack(settings),
    "--reader-reader-font-size": `${settings.fontSize}px`,
    "--reader-reader-line-height": settings.lineHeight,
    "--reader-reader-font-weight":
      settings.fontFamily === "kai" ? 400 : (settings.fontWeight ?? 400),
    "--reader-paragraph-spacing": `${settings.paragraphSpacing ?? 0.65}em`,
    "--reader-line-length": `${readerLineWidth(settings)}px`,
  };
}

function readerCjkFontOption(fontFamily: ReaderFontFamily): ReaderFontOption<ReaderFontFamily> {
  return (
    READER_CJK_FONT_OPTIONS.find((option) => option.id === fontFamily) ??
    READER_CJK_FONT_OPTIONS[0]!
  );
}

function readerLatinFontOption(
  fontFamily: ReaderLatinFontFamily,
): ReaderFontOption<ReaderLatinFontFamily> {
  return (
    READER_LATIN_FONT_OPTIONS.find((option) => option.id === fontFamily) ??
    READER_LATIN_FONT_OPTIONS[0]!
  );
}

export function readerFontStack(
  settings: Pick<ReaderSettings, "fontFamily" | "latinFontFamily">,
): string {
  return `${readerLatinFontOption(settings.latinFontFamily).stack}, ${readerCjkFontOption(settings.fontFamily).stack}`;
}
