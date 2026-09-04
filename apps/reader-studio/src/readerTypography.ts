import type { ReaderFontFamily, ReaderLatinFontFamily, ReaderSettings } from "./model";

export interface ReaderFontOption<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly shortLabel: string;
  readonly stack: string;
}

export const READER_CJK_FONT_OPTIONS: ReadonlyArray<ReaderFontOption<ReaderFontFamily>> = [
  {
    id: "sans",
    label: "现代黑体",
    shortLabel: "黑体",
    stack: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    id: "serif",
    label: "书卷宋体",
    shortLabel: "宋体",
    stack: '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", STSong, SimSun, serif',
  },
  {
    id: "kai",
    label: "楷体",
    shortLabel: "楷体",
    stack: '"Kaiti SC", STKaiti, KaiTi, "DFKai-SB", serif',
  },
];

export const READER_LATIN_FONT_OPTIONS: ReadonlyArray<ReaderFontOption<ReaderLatinFontFamily>> = [
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
