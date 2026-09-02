import type {
  ReaderAnnotation,
  ReaderBook,
  ReaderBookmark,
  ReaderProgress,
  ReaderSection,
  SearchHit,
} from "@bcr/reader-core";

export type {
  ReaderAnnotation,
  ReaderBook,
  ReaderBookmark,
  ReaderLocator,
  ReaderProgress,
  ReaderSection,
  SearchHit,
} from "@bcr/reader-core";

export type ReaderTheme = "paper" | "night" | "sage";
export type ReaderLayout = "scroll" | "paged";

export interface ReaderSettings {
  readonly theme: ReaderTheme;
  readonly layout: ReaderLayout;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly contentWidth: "narrow" | "wide";
}

export interface ReaderSearchSession {
  readonly query: string;
  readonly searchBookId: string | null;
  readonly searchOpen: boolean;
}

/** One-shot request used to move from a search result into its exact context. */
export interface ReaderSearchReveal {
  readonly id: number;
  readonly bookId: string;
  readonly sectionId: string;
  readonly matchStart: number;
  readonly matchLength: number;
}

export interface ReaderState {
  readonly status: "booting" | "ready" | "error";
  readonly error: string | null;
  readonly library: ReadonlyArray<ReaderBook>;
  readonly activeBookId: string | null;
  readonly activeSectionId: string | null;
  readonly progressByBook: Readonly<Record<string, ReaderProgress>>;
  readonly bookmarksByBook: Readonly<Record<string, ReadonlyArray<ReaderBookmark>>>;
  readonly annotationsByBook: Readonly<Record<string, ReadonlyArray<ReaderAnnotation>>>;
  readonly query: string;
  readonly searchHits: ReadonlyArray<SearchHit>;
  readonly searchBookId: string | null;
  readonly searchActiveIndex: number;
  readonly searchBusy: boolean;
  readonly searchReveal: ReaderSearchReveal | null;
  readonly settings: ReaderSettings;
  readonly sidebarOpen: boolean;
  readonly searchOpen: boolean;
  readonly lastSavedAt: number | null;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "paper",
  layout: "scroll",
  fontSize: 18,
  lineHeight: 1.85,
  contentWidth: "narrow",
};

function section(
  id: string,
  order: number,
  label: string,
  text: string,
  html: string,
): ReaderSection {
  return { id, order, label, kind: "text", text, html };
}

export function createDemoBook(): ReaderBook {
  const sections = [
    section(
      "opening",
      0,
      "序章 · 把时间还给阅读",
      "阅读器不应该把内容藏在按钮后面。它只需要在你打开书的那一刻，安静地把上次离开的地方交还给你。",
      `<p>阅读器不应该把内容藏在按钮后面。它只需要在你打开书的那一刻，安静地把上次离开的地方交还给你。</p><p>这是一个离线优先的阅读空间：书籍属于你的设备，进度跟随内容，搜索也不必离开当前上下文。</p>`,
    ),
    section(
      "chapter-one",
      1,
      "第一章 · 轻量的内核",
      "一套真正可扩展的阅读器，先定义出版物、章节和定位，再让格式适配器承担解析差异。",
      `<h2>第一章 · 轻量的内核</h2><p>一套真正可扩展的阅读器，先定义出版物、章节和定位，再让格式适配器承担解析差异。</p><p>TXT、Markdown、HTML、EPUB、PDF 与 CBZ 可以共享同一套书库、搜索、书签和阅读进度。区别留在边界，体验保持一致。</p><blockquote>好的抽象不是增加层数，而是让变化停留在应该变化的地方。</blockquote>`,
    ),
    section(
      "chapter-two",
      2,
      "第二章 · 找到下一页",
      "进度不是一个孤立的百分比，它应该由稳定的 Locator 表达：章节、页码和章节内的相对位置。",
      `<h2>第二章 · 找到下一页</h2><p>进度不是一个孤立的百分比，它应该由稳定的 <code>Locator</code> 表达：章节、页码和章节内的相对位置。</p><p>当窗口宽度、字体大小或排版发生变化时，阅读位置仍然可以回到同一个语义锚点，而不是某个容易漂移的像素。</p>`,
    ),
    section(
      "chapter-three",
      3,
      "第三章 · 让搜索回到内容",
      "搜索结果应该带着章节和上下文出现。点击命中后，阅读器滚动到原文，而不是把你带离阅读。",
      `<h2>第三章 · 让搜索回到内容</h2><p>搜索结果应该带着章节和上下文出现。点击命中后，阅读器滚动到原文，而不是把你带离阅读。</p><p>本地全文索引可以先用 SQLite FTS5，短查询再由内存 fallback 兜底。数据量增长时，解析与索引可以无缝移动到 Worker。</p>`,
    ),
  ];
  return {
    id: "demo-reading-space",
    title: "把时间还给阅读",
    author: "BCR Reader Lab",
    language: "zh-CN",
    source: {
      name: "reading-space.md",
      format: "markdown",
      mime: "text/markdown",
      size: 4096,
    },
    sections,
    importedAt: Date.now(),
    updatedAt: Date.now(),
    tags: ["DEMO", "MARKDOWN"],
  };
}

export function activeBook(state: ReaderState): ReaderBook | undefined {
  return state.library.find((book) => book.id === state.activeBookId);
}

export function activeSection(
  book: ReaderBook | undefined,
  state: ReaderState,
): ReaderSection | undefined {
  if (book === undefined) return undefined;
  return book.sections.find((section) => section.id === state.activeSectionId) ?? book.sections[0];
}
