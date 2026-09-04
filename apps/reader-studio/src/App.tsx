import {
  ArrowLeft,
  ArrowUpRight,
  Archive,
  Bookmark,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Columns2,
  Download,
  FileText,
  Leaf,
  List,
  Maximize2,
  Menu,
  MessageSquarePlus,
  Minus,
  Minimize2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { SearchDocument } from "@bcr/core";
import {
  createLocator,
  createTextLocator,
  locatorAtPercentage,
  normalizeSearchQuery,
  readerAcceptAttribute,
  searchTextRange,
  sameLocator,
  type ReaderBook,
  type ReaderAnnotation,
  type ReaderBookmark,
  type ReaderLocator,
  type ReaderSection,
  type ReaderTocItem,
  type SearchHit,
} from "@bcr/reader-core";
import {
  consumeDocumentHandoff,
  getDocumentHandoffMarker,
  markDocumentHandoffExpired,
  publishDocumentHandoff,
} from "@bcr/document-core";
import { useLocationSearch, useOptionalRuntime } from "@bcr/react";
import {
  createReaderRuntime,
  ensureReaderMetadata,
  importReaderDocumentHandoff,
  importReaderExportBundle,
  importReaderFile,
  indexBook,
  mirrorReaderSession,
  prepareReaderDocumentHandoff,
  persistReader,
  restoreReader,
  searchIndexedDetailed,
  type ReaderRestoreDiagnostics,
  type ReaderRuntime,
} from "./runtime";
import { activeBook, type ReaderSettings, type ReaderTheme } from "./model";
import { getReaderState, reader, useReader } from "./store";
import "./styles.css";

const EMPTY_BOOKMARKS: ReadonlyArray<ReaderBookmark> = [];
const EMPTY_ANNOTATIONS: ReadonlyArray<ReaderAnnotation> = [];

interface ReaderRouteSearch {
  readonly book?: string;
  readonly section?: string;
}

function parseReaderRouteSearch(value: string): ReaderRouteSearch {
  const params = new URLSearchParams(value);
  const book = params.get("book");
  const section = params.get("section");
  return {
    ...(book === null ? {} : { book }),
    ...(section === null ? {} : { section }),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatBadge(format: ReaderBook["source"]["format"]): string {
  return format === "markdown" ? "MD" : format.toUpperCase();
}

function themeIcon(theme: ReaderTheme) {
  if (theme === "night") return <Moon className="reader-icon" />;
  if (theme === "sage") return <Leaf className="reader-icon" />;
  return <Sun className="reader-icon" />;
}

function themeLabel(theme: ReaderTheme): string {
  if (theme === "night") return "夜间";
  if (theme === "sage") return "松石";
  return "纸张";
}

function sourceIcon(format: ReaderBook["source"]["format"]) {
  return format === "cbz" ? (
    <Archive className="reader-icon" />
  ) : (
    <FileText className="reader-icon" />
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface ReaderFullscreenState {
  readonly isFullscreen: boolean;
  readonly supported: boolean;
  readonly toggle: () => Promise<void>;
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  readonly userChoice: Promise<{
    readonly outcome: "accepted" | "dismissed";
    readonly platform: string;
  }>;
  prompt: () => Promise<void>;
}

interface ReaderPwaInstallState {
  readonly canInstall: boolean;
  readonly isInstalled: boolean;
  readonly isIos: boolean;
  readonly install: () => Promise<boolean>;
}

function pendingReaderInstallPrompt(): BeforeInstallPromptEvent | null {
  if (typeof window === "undefined") return null;
  return (
    (window as Window & { __bcrReaderInstallPrompt?: BeforeInstallPromptEvent })
      .__bcrReaderInstallPrompt ?? null
  );
}

function useReaderPwaInstall(): ReaderPwaInstallState {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    pendingReaderInstallPrompt(),
  );
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === "undefined") return false;
    const safariStandalone =
      (window.navigator as Navigator & { readonly standalone?: boolean }).standalone === true;
    return window.matchMedia("(display-mode: standalone)").matches || safariStandalone;
  });
  const isIos =
    typeof navigator !== "undefined" &&
    (/iphone|ipad|ipod/iu.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

  useEffect(() => {
    const syncInstalled = () => {
      const safariStandalone =
        (window.navigator as Navigator & { readonly standalone?: boolean }).standalone === true;
      setIsInstalled(window.matchMedia("(display-mode: standalone)").matches || safariStandalone);
    };
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onReaderInstallPrompt = () => {
      const prompt = pendingReaderInstallPrompt();
      if (prompt !== null) setDeferredPrompt(prompt);
    };
    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      delete (window as Window & { __bcrReaderInstallPrompt?: BeforeInstallPromptEvent })
        .__bcrReaderInstallPrompt;
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("bcr-reader-install-prompt", onReaderInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    syncInstalled();
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("bcr-reader-install-prompt", onReaderInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    const prompt = deferredPrompt;
    if (prompt === null) return false;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setIsInstalled(true);
      return true;
    } catch {
      return false;
    } finally {
      setDeferredPrompt(null);
      delete (window as Window & { __bcrReaderInstallPrompt?: BeforeInstallPromptEvent })
        .__bcrReaderInstallPrompt;
    }
  }, [deferredPrompt]);

  return {
    canInstall: !isInstalled && deferredPrompt !== null,
    isInstalled,
    isIos,
    install,
  };
}

/** Keep native fullscreen state in sync, including Esc and browser chrome exits. */
function useReaderFullscreen(
  targetRef: RefObject<HTMLElement | null>,
  onError?: (message: string) => void,
): ReaderFullscreenState {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const target = targetRef.current;
    const canRequest =
      target !== null &&
      typeof target.requestFullscreen === "function" &&
      document.fullscreenEnabled !== false;
    setSupported(canRequest);

    const syncState = () => {
      setIsFullscreen(document.fullscreenElement === targetRef.current);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.fullscreenElement !== targetRef.current) return;
      // Some embedded browsers expose Fullscreen API state but do not exit on
      // Escape until the page forwards the intent to the document explicitly.
      event.preventDefault();
      if (typeof document.exitFullscreen === "function") {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
    document.addEventListener("fullscreenchange", syncState);
    document.addEventListener("keydown", onKeyDown);
    syncState();
    return () => {
      document.removeEventListener("fullscreenchange", syncState);
      document.removeEventListener("keydown", onKeyDown);
      if (document.fullscreenElement === target && typeof document.exitFullscreen === "function") {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [targetRef]);

  const toggle = useCallback(async () => {
    if (typeof document === "undefined") return;
    const target = targetRef.current;
    if (target === null || !supported) {
      onError?.("当前浏览器不支持全屏阅读");
      return;
    }
    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenElement !== null) await document.exitFullscreen();
      await target.requestFullscreen();
    } catch {
      onError?.("无法进入全屏阅读，请检查浏览器的全屏权限");
    }
  }, [onError, supported, targetRef]);

  return { isFullscreen, supported, toggle };
}

interface TextMatchRange {
  readonly start: number;
  readonly end: number;
}

/** Find a search match while keeping offsets in the original text node. */
function textMatchRange(value: string, query: string): TextMatchRange | undefined {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery || value.length === 0) return undefined;

  const directQuery = query.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
  const directIndex = value.toLocaleLowerCase().indexOf(directQuery);
  if (directQuery.length > 0 && directIndex >= 0) {
    return { start: directIndex, end: directIndex + directQuery.length };
  }

  // Search normalizes whitespace and Unicode compatibility forms. Build a
  // compact index with source offsets so highlighting never changes content.
  let compact = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index) ?? 0;
    const next = index + (codePoint > 0xffff ? 2 : 1);
    const character = value.slice(index, next);
    index = next;
    if (/\s/u.test(character)) continue;
    const normalized = character.normalize("NFKC").toLocaleLowerCase();
    for (let unitIndex = 0; unitIndex < normalized.length; unitIndex += 1) {
      compact += normalized[unitIndex] ?? "";
      starts.push(index - character.length);
      ends.push(index);
    }
  }
  const compactIndex = compact.indexOf(normalizedQuery);
  if (compactIndex < 0) return undefined;
  return {
    start: starts[compactIndex] ?? 0,
    end: ends[compactIndex + normalizedQuery.length - 1] ?? value.length,
  };
}

function elementForNode(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

/** Capture a same-section text selection as a reflow-safe Reader locator. */
function readerSelectionLocator(book: ReaderBook): ReaderLocator | undefined {
  if (typeof window === "undefined") return undefined;
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  const startSection = elementForNode(range.startContainer)?.closest<HTMLElement>(
    "[data-reader-section]",
  );
  const endSection = elementForNode(range.endContainer)?.closest<HTMLElement>(
    "[data-reader-section]",
  );
  if (
    startSection === null ||
    startSection === undefined ||
    endSection === null ||
    endSection === undefined ||
    startSection.dataset.readerSection !== endSection.dataset.readerSection
  ) {
    return undefined;
  }
  const sectionId = startSection.dataset.readerSection;
  if (sectionId === undefined) return undefined;
  const section = book.sections.find((candidate) => candidate.id === sectionId);
  if (section === undefined) return undefined;
  const selected = selection.toString().replace(/\r\n?/gu, "\n").trim();
  if (selected.length === 0) return undefined;
  const match = searchTextRange(section.text, selected);
  if (match === undefined || match.length === 0) return undefined;
  return createTextLocator(section, match.start, match.start + match.length);
}

function highlightText(value: string, query: string): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  while (cursor < value.length) {
    const match = textMatchRange(value.slice(cursor), query);
    if (match === undefined) {
      nodes.push(value.slice(cursor));
      break;
    }
    const start = cursor + match.start;
    const end = Math.max(start + 1, cursor + match.end);
    if (start > cursor) nodes.push(value.slice(cursor, start));
    nodes.push(
      <mark data-reader-search-match="true" key={`match-${key++}`}>
        {value.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  return nodes.length > 0 ? nodes : value;
}

/** Highlight sanitized HTML without interpolating user input into markup. */
function highlightHtml(value: string, query: string): string {
  if (!normalizeSearchQuery(query) || typeof DOMParser === "undefined") return value;
  const document = new DOMParser().parseFromString(`<body>${value}</body>`, "text/html");
  const body = document.body;
  if (body === null) return value;
  const walker = document.createTreeWalker(body, 4);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node !== null) {
    const textNode = node as Text;
    if (textNode.parentElement?.closest("mark, script, style") === null) textNodes.push(textNode);
    node = walker.nextNode();
  }
  for (const textNode of textNodes) {
    const parent = textNode.parentNode;
    if (parent === null) continue;
    const source = textNode.data;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let highlighted = false;
    while (cursor < source.length) {
      const match = textMatchRange(source.slice(cursor), query);
      if (match === undefined) {
        fragment.append(document.createTextNode(source.slice(cursor)));
        break;
      }
      const start = cursor + match.start;
      const end = Math.max(start + 1, cursor + match.end);
      if (start > cursor) fragment.append(document.createTextNode(source.slice(cursor, start)));
      const mark = document.createElement("mark");
      mark.setAttribute("data-reader-search-match", "true");
      mark.textContent = source.slice(start, end);
      fragment.append(mark);
      cursor = end;
      highlighted = true;
    }
    if (highlighted) parent.replaceChild(fragment, textNode);
  }
  return body.innerHTML;
}

interface ReaderScrollPosition {
  readonly top: number;
  readonly left: number;
}

function readerSectionScrollPosition(
  container: HTMLElement,
  sectionId: string,
): ReaderScrollPosition | undefined {
  const target = container.querySelector<HTMLElement>(
    `[data-reader-section="${CSS.escape(sectionId)}"]`,
  );
  if (target === null) return undefined;
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  return {
    top: Math.min(
      maxTop,
      Math.max(0, container.scrollTop + targetRect.top - containerRect.top - 28),
    ),
    left: Math.min(
      maxLeft,
      Math.max(0, container.scrollLeft + targetRect.left - containerRect.left - 28),
    ),
  };
}

function readerUsesHorizontalPaging(
  container: HTMLElement,
  layout: ReaderSettings["layout"],
): boolean {
  if (layout !== "paged") return false;
  const horizontalMax = Math.max(0, container.scrollWidth - container.clientWidth);
  const verticalMax = Math.max(0, container.scrollHeight - container.clientHeight);
  // A malformed/legacy paged layout can still overflow vertically. In that
  // case vertical scrolling is the only meaningful reading axis; use the
  // horizontal axis only once the paged columns actually dominate.
  return horizontalMax > verticalMax;
}

function readerScrollPercentage(container: HTMLElement, layout: ReaderSettings["layout"]): number {
  const horizontal = readerUsesHorizontalPaging(container, layout);
  const offset = horizontal ? container.scrollLeft : container.scrollTop;
  const max = horizontal
    ? Math.max(1, container.scrollWidth - container.clientWidth)
    : Math.max(1, container.scrollHeight - container.clientHeight);
  return clamp(offset / max, 0, 1);
}

function scrollToReaderSection(sectionId: string, behavior: ScrollBehavior = "smooth"): void {
  const container = document.querySelector<HTMLElement>(".reader-reading-scroll");
  if (container === null) return;
  const position = readerSectionScrollPosition(container, sectionId);
  if (position === undefined) return;
  container.scrollTo({ ...position, behavior });
}

function scrollToReaderMatch(sectionId: string, behavior: ScrollBehavior = "smooth"): boolean {
  const container = document.querySelector<HTMLElement>(".reader-reading-scroll");
  const section = container?.querySelector<HTMLElement>(
    `[data-reader-section="${CSS.escape(sectionId)}"]`,
  );
  const target = section?.querySelector<HTMLElement>('[data-reader-search-match="true"]');
  if (container === null || container === undefined || target === null || target === undefined) {
    return false;
  }
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  const top =
    container.scrollTop + targetRect.top - containerRect.top - container.clientHeight * 0.34;
  const left =
    container.scrollLeft + targetRect.left - containerRect.left - container.clientWidth * 0.34;
  container.scrollTo({
    top: Math.min(maxTop, Math.max(0, top)),
    left: Math.min(maxLeft, Math.max(0, left)),
    behavior,
  });
  return true;
}

const readerSectionIndexes = new WeakMap<ReaderBook, ReadonlyMap<string, number>>();

function sectionIndexMap(book: ReaderBook): ReadonlyMap<string, number> {
  const cached = readerSectionIndexes.get(book);
  if (cached !== undefined) return cached;
  const created = new Map(book.sections.map((section, index) => [section.id, index] as const));
  readerSectionIndexes.set(book, created);
  return created;
}

function readerLocatorAtScroll(
  book: ReaderBook,
  container: HTMLElement,
  fallbackSectionId?: string | null,
): { locator: ReturnType<typeof createLocator>; percentage: number } | undefined {
  if (book.sections.length === 0) return undefined;
  const containerRect = container.getBoundingClientRect();
  const probeTop = containerRect.top + Math.min(140, container.clientHeight * 0.32);
  const probeX = containerRect.left + containerRect.width * 0.5;
  const hit = document
    .elementFromPoint(probeX, probeTop)
    ?.closest<HTMLElement>("[data-reader-section]");
  const selectedId = hit?.dataset.readerSection ?? fallbackSectionId ?? undefined;
  const selectedIndex = selectedId === undefined ? 0 : (sectionIndexMap(book).get(selectedId) ?? 0);
  const selectedElement =
    hit ??
    container.querySelector<HTMLElement>(
      `[data-reader-section="${CSS.escape(book.sections[selectedIndex]?.id ?? "")}"]`,
    );
  const selectedRect = selectedElement?.getBoundingClientRect();
  const section = book.sections[selectedIndex];
  if (section === undefined || selectedRect === undefined) return undefined;
  const progression = clamp((probeTop - selectedRect.top) / Math.max(1, selectedRect.height), 0, 1);
  const denominator = Math.max(1, book.sections.length - 1);
  return {
    locator: createLocator(section, progression),
    percentage: clamp((selectedIndex + progression) / denominator, 0, 1),
  };
}

let readerPersistenceQueue: Promise<void> = Promise.resolve();

function persistReaderSnapshot(runtime: ReaderRuntime): void {
  const state = getReaderState();
  if (state.status !== "ready") return;
  // Keep the small session snapshot synchronously available before the async
  // SQLite/OPFS queue gets a chance to run. Mobile browsers may terminate a
  // page immediately after pagehide/visibilitychange.
  mirrorReaderSession(state);
  const save = () =>
    persistReader(runtime, state, { mirrorSession: false }).then(() => reader.markSaved());
  readerPersistenceQueue = readerPersistenceQueue
    .catch(() => undefined)
    .then(save)
    .catch(() => undefined);
}

function isAbortError(reason: unknown): boolean {
  return (
    (reason instanceof DOMException && reason.name === "AbortError") ||
    (reason instanceof Error && reason.name === "AbortError")
  );
}

function useDebouncedPersist(runtime: ReaderRuntime | null): void {
  const library = useReader((state) => state.library);
  const progressByBook = useReader((state) => state.progressByBook);
  const bookmarksByBook = useReader((state) => state.bookmarksByBook);
  const annotationsByBook = useReader((state) => state.annotationsByBook);
  const query = useReader((state) => state.query);
  const searchBookId = useReader((state) => state.searchBookId);
  const searchOpen = useReader((state) => state.searchOpen);
  const settings = useReader((state) => state.settings);
  useEffect(() => {
    if (runtime === null || getReaderState().status !== "ready") return;
    const handle = window.setTimeout(() => {
      persistReaderSnapshot(runtime);
    }, 900);
    return () => window.clearTimeout(handle);
  }, [
    runtime,
    library,
    progressByBook,
    bookmarksByBook,
    annotationsByBook,
    query,
    searchBookId,
    searchOpen,
    settings,
  ]);

  useEffect(() => {
    if (runtime === null) return;
    const flush = () => persistReaderSnapshot(runtime);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [runtime]);
}

function useReaderSearch(runtime: ReaderRuntime | null): void {
  const query = useReader((state) => state.query);
  const library = useReader((state) => state.library);
  const [indexRevision, setIndexRevision] = useState(0);
  useEffect(() => {
    const unsubscribe = runtime?.indexSession?.subscribe(() => {
      setIndexRevision((revision) => revision + 1);
    });
    return unsubscribe;
  }, [runtime]);
  useEffect(() => {
    if (runtime === null) return;
    const handle = window.setTimeout(() => {
      if (query.trim() === "") {
        reader.setSearch(query, [], null);
        reader.setSearchBusy(false);
        return;
      }
      reader.setSearchBusy(true);
      try {
        const result = searchIndexedDetailed(runtime, library, query);
        reader.setSearch(query, result.hits, null);
        reader.setSearchBusy(result.indexing);
      } catch {
        reader.setSearch(query, [], null);
        reader.setSearchBusy(false);
      }
    }, 160);
    return () => window.clearTimeout(handle);
  }, [indexRevision, runtime, query, library]);
}

function useReaderBoot(): {
  runtime: ReaderRuntime | null;
  error: string | null;
  recovery: ReaderRestoreDiagnostics | null;
} {
  const [runtime, setRuntime] = useState<ReaderRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<ReaderRestoreDiagnostics | null>(null);
  useEffect(() => {
    let cancelled = false;
    let createdRuntime: ReaderRuntime | null = null;
    let metadataWarmupTimer: number | undefined;
    const scheduleMetadataWarmup = (nextRuntime: ReaderRuntime): void => {
      metadataWarmupTimer = window.setTimeout(() => {
        if (!cancelled) void ensureReaderMetadata(nextRuntime);
      }, 1200);
    };
    void createReaderRuntime()
      .then(async (nextRuntime) => {
        createdRuntime = nextRuntime;
        if (cancelled) {
          nextRuntime.indexSession?.close();
          nextRuntime.parseSession?.close();
          return;
        }
        setRuntime(nextRuntime);
        const restored = await restoreReader(nextRuntime);
        if (cancelled) return;
        if (restored !== undefined) {
          setRecovery(restored.recovery);
          reader.hydrate(
            restored.books,
            restored.progressByBook,
            restored.settings,
            restored.bookmarksByBook,
            restored.activeBookId,
            restored.annotationsByBook,
            restored.searchSession,
          );
          scheduleMetadataWarmup(nextRuntime);
          await Promise.all(restored.books.map((book) => indexBook(nextRuntime, book)));
        } else {
          setRecovery(null);
          reader.setReady();
          scheduleMetadataWarmup(nextRuntime);
          await indexBook(nextRuntime, getReaderState().library[0]!);
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        reader.setError(reason);
      });
    return () => {
      cancelled = true;
      if (metadataWarmupTimer !== undefined) window.clearTimeout(metadataWarmupTimer);
      createdRuntime?.indexSession?.close();
      createdRuntime?.parseSession?.close();
    };
  }, []);
  return { runtime, error, recovery };
}

export function App() {
  const { runtime, error: runtimeError, recovery } = useReaderBoot();
  const hostServices = useOptionalRuntime();
  const pwaInstall = useReaderPwaInstall();
  const routeSearch = parseReaderRouteSearch(useLocationSearch());
  useDebouncedPersist(runtime);
  useReaderSearch(runtime);
  const status = useReader((state) => state.status);
  const stateError = useReader((state) => state.error);
  const active = useReader((state) => activeBook(state));
  const settings = useReader((state) => state.settings);
  const library = useReader((state) => state.library);
  const progressByBook = useReader((state) => state.progressByBook);
  const searchOpen = useReader((state) => state.searchOpen);
  const sidebarOpen = useReader((state) => state.sidebarOpen);
  const searchRef = useRef<HTMLInputElement>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const importDismissRef = useRef<number | null>(null);
  const handoffRef = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [handoffRecovery, setHandoffRecovery] = useState(false);
  const [documentHandoffBusy, setDocumentHandoffBusy] = useState(false);
  const [importJob, setImportJob] = useState<ImportJob | null>(null);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [mobileChromeVisible, setMobileChromeVisible] = useState(true);
  const appliedRouteRef = useRef("");
  const mobileSidebarInitializedRef = useRef(false);

  useEffect(() => {
    document.title = active === undefined ? "BCR Reader" : `${active.title} · BCR Reader`;
  }, [active?.id, active?.title]);

  useEffect(() => {
    if (status !== "ready" || mobileSidebarInitializedRef.current) return;
    mobileSidebarInitializedRef.current = true;
    if (window.matchMedia("(max-width: 860px)").matches && getReaderState().sidebarOpen) {
      reader.toggleSidebar();
    }
  }, [status]);

  useEffect(() => {
    if (status !== "ready" || routeSearch.book === undefined) return;
    const routeKey = `${routeSearch.book}|${routeSearch.section ?? ""}`;
    if (appliedRouteRef.current === routeKey) return;
    const book = library.find((candidate) => candidate.id === routeSearch.book);
    if (book === undefined) return;
    appliedRouteRef.current = routeKey;
    reader.openBook(book.id, routeSearch.section);
  }, [status, routeSearch.book, routeSearch.section, library]);

  useEffect(() => {
    const search = hostServices?.search;
    if (search === undefined || runtime === null || status !== "ready") return;
    const records: SearchDocument[] = [];
    for (const book of library) {
      const progress = progressByBook[book.id]?.percentage ?? 0;
      const bookBody = [book.author ?? "", book.language ?? "", ...book.tags]
        .filter(Boolean)
        .join(" ");
      records.push({
        id: `reader:book:${book.id}`,
        source: "reader",
        kind: "reader-book",
        title: book.title,
        subtitle: `${formatBadge(book.source.format)} · ${Math.round(progress * 100)}% read${book.author === undefined ? "" : ` · ${book.author}`}`,
        ...(bookBody.length === 0 ? {} : { body: bookBody }),
        tags: ["reader", book.source.format, ...book.tags],
        route: `/reader?book=${encodeURIComponent(book.id)}`,
        updatedAt: book.updatedAt,
      });
      for (const section of book.sections) {
        records.push({
          id: `reader:section:${book.id}:${section.id}`,
          source: "reader",
          kind: "reader-section",
          title: section.label,
          subtitle: book.title,
          body: section.text.slice(0, 12_000),
          tags: ["reader", book.source.format, "section"],
          route: `/reader?book=${encodeURIComponent(book.id)}&section=${encodeURIComponent(section.id)}`,
          updatedAt: book.updatedAt,
        });
      }
    }
    search.replaceSource("reader", records);
  }, [hostServices?.search, runtime, status, library, progressByBook]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        reader.setSearchOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (event.key === "Escape") {
        if (document.fullscreenElement !== null) return;
        if (searchOpen) reader.setSearchOpen(false);
        else if (sidebarOpen) reader.toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, sidebarOpen]);

  const cancelImport = useCallback(() => {
    importAbortRef.current?.abort();
  }, []);

  const installReader = useCallback(async () => {
    const prompted = await pwaInstall.install();
    if (!prompted) setInstallHelpOpen(true);
  }, [pwaInstall.install]);

  useEffect(
    () => () => {
      importAbortRef.current?.abort();
      if (importDismissRef.current !== null) window.clearTimeout(importDismissRef.current);
    },
    [],
  );

  const importFiles = useCallback(
    async (files: ReadonlyArray<File>) => {
      if (runtime === null || files.length === 0 || importAbortRef.current !== null) return;
      if (importDismissRef.current !== null) {
        window.clearTimeout(importDismissRef.current);
        importDismissRef.current = null;
      }
      const controller = new AbortController();
      importAbortRef.current = controller;
      setImportJob({
        total: files.length,
        completed: 0,
        current: "",
        cancelled: false,
        settled: false,
        errors: 0,
        failedFiles: [],
      });
      let errors = 0;
      let completed = 0;
      const failedFiles: ImportFailure[] = [];
      for (const file of files) {
        if (controller.signal.aborted) break;
        setImportJob((previous) =>
          previous === null ? previous : { ...previous, current: file.name },
        );
        try {
          const isExportBundle =
            /\.json$/iu.test(file.name) ||
            file.type.toLocaleLowerCase().startsWith("application/json");
          const book = isExportBundle
            ? await importReaderExportBundle(runtime, file, controller.signal)
            : await importReaderFile(runtime, file, controller.signal);
          if (controller.signal.aborted) break;
          const added = reader.addBook(book);
          if (added) {
            await indexBook(runtime, book, controller.signal);
            setNotice(
              isExportBundle
                ? `${book.title} 已从 Export Bundle 加入书库`
                : `${book.title} 已加入书库`,
            );
          } else {
            setNotice(`${file.name} 已在书库`);
          }
        } catch (reason) {
          if (isAbortError(reason)) break;
          errors += 1;
          const message = reason instanceof Error ? reason.message : String(reason);
          failedFiles.push({ file, error: message });
          setNotice(message);
        } finally {
          if (!controller.signal.aborted) completed += 1;
          setImportJob((previous) =>
            previous === null
              ? previous
              : {
                  ...previous,
                  completed: controller.signal.aborted ? previous.completed : completed,
                  current: "",
                  errors,
                  failedFiles: [...failedFiles],
                },
          );
        }
      }
      const cancelled = controller.signal.aborted;
      if (cancelled) {
        for (const file of files.slice(completed)) {
          if (!failedFiles.some((failure) => failure.file === file)) {
            failedFiles.push({ file, error: "导入已取消" });
          }
        }
      }
      setImportJob((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              completed,
              current: "",
              cancelled,
              settled: true,
              errors,
              failedFiles: [...failedFiles],
            },
      );
      importAbortRef.current = null;
      setNotice(
        cancelled ? "导入已取消" : errors > 0 ? `导入完成，${errors} 个文件失败` : "导入完成",
      );
      importDismissRef.current = window.setTimeout(
        () => {
          setNotice(null);
          setImportJob(null);
          importDismissRef.current = null;
        },
        cancelled && failedFiles.length > 0
          ? 12_000
          : cancelled
            ? 1800
            : errors > 0
              ? 12_000
              : 2400,
      );
    },
    [runtime],
  );

  const retryFailedImports = useCallback(() => {
    const files = importJob?.failedFiles.map((failure) => failure.file) ?? [];
    if (files.length === 0 || importAbortRef.current !== null) return;
    setImportJob(null);
    setNotice(`正在重试 ${files.length} 个失败文件`);
    void importFiles(files);
  }, [importFiles, importJob]);

  const handoffDocument = useCallback(() => {
    if (active === undefined || runtime === null || documentHandoffBusy) return;
    const hostArtifacts = hostServices?.artifacts;
    if (hostArtifacts === undefined) {
      setNotice("请从 Studio Shell 打开 Reader，才能把内容交给 Document Studio");
      return;
    }
    setDocumentHandoffBusy(true);
    void prepareReaderDocumentHandoff(runtime, hostArtifacts, active)
      .then(({ file, sourceRef, content, contentRef }) => {
        const handoffId = publishDocumentHandoff({
          jobId: active.id,
          target: "document",
          name: active.source.name,
          format: content.format,
          file,
          size: active.source.size,
          sourceRef,
          contentRef,
          content,
        });
        setNotice(`${active.title} 正在交给 Document Studio；结构化内容与源文件已托管`);
        window.location.assign(`/documents?handoff=${encodeURIComponent(handoffId)}`);
      })
      .catch((reason: unknown) => {
        setNotice(
          `交给 Document Studio 失败：${reason instanceof Error ? reason.message : String(reason)}`,
        );
      })
      .finally(() => setDocumentHandoffBusy(false));
  }, [active, documentHandoffBusy, hostServices?.artifacts, runtime]);

  useEffect(() => {
    if (runtime === null || status !== "ready") return;
    const handoffId = new URLSearchParams(window.location.search).get("document");
    if (handoffId === null || handoffId === handoffRef.current) return;
    handoffRef.current = handoffId;
    const handoff = consumeDocumentHandoff(handoffId, "reader");
    window.history.replaceState({}, "", "/reader");
    if (handoff === undefined) {
      const marker = getDocumentHandoffMarker();
      markDocumentHandoffExpired(handoffId, "reader");
      setHandoffRecovery(true);
      setNotice(
        marker?.id !== handoffId || marker.target !== "reader"
          ? "Document handoff 已过期；请从 Document Studio 重新导入源文件"
          : `Document handoff「${marker.name}」已过期；请从 Document Studio 重新导入源文件`,
      );
      return;
    }
    setHandoffRecovery(false);
    void (async () => {
      try {
        const book = await importReaderDocumentHandoff(runtime, handoff, hostServices?.artifacts);
        const added = reader.addBook(book);
        if (added) {
          await indexBook(runtime, book);
          setNotice(
            handoff.translation !== undefined || handoff.translationRef !== undefined
              ? `${book.title} 已从 Translation Package 加入书库`
              : handoff.content !== undefined || handoff.contentRef !== undefined
                ? `${book.title} 已从 Content Package 加入书库`
                : `${book.title} 已从源 Artifact 加入书库`,
          );
        } else {
          setNotice(`${handoff.name} 已在书库`);
        }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setHandoffRecovery(true);
        setNotice(message);
      }
    })();
  }, [hostServices?.artifacts, runtime, status]);

  if (status === "booting" || runtime === null) {
    return <BootScreen error={runtimeError} />;
  }
  if (active === undefined) {
    return <BootScreen error={stateError ?? runtimeError ?? "没有可阅读的内容"} />;
  }
  return (
    <div
      className={`reader-studio reader-theme-${settings.theme} ${mobileChromeVisible ? "mobile-chrome-visible" : "mobile-chrome-hidden"}`}
    >
      <a className="reader-skip-link" href="#reader-content">
        跳到正文
      </a>
      <ReaderHeader
        book={active}
        searchRef={searchRef}
        onExit={() => window.location.assign("/")}
        onImport={(files) => void importFiles(files)}
        notice={notice}
        importJob={importJob}
        onCancelImport={cancelImport}
        onRetryFailed={retryFailedImports}
        onRecoverHandoff={handoffRecovery ? () => window.location.assign("/documents") : undefined}
        showInstall={!pwaInstall.isInstalled}
        installAvailable={pwaInstall.canInstall}
        onInstall={() => void installReader()}
      />
      <ReaderInstallHelp
        open={installHelpOpen}
        isIos={pwaInstall.isIos}
        onClose={() => setInstallHelpOpen(false)}
      />
      {recovery !== null && recovery.skippedBooks.length > 0 && (
        <ReaderRecoveryBanner recovery={recovery} />
      )}
      <ReaderWorkspace
        runtime={runtime}
        onImport={(files) => void importFiles(files)}
        onOpenDocument={handoffDocument}
        documentHandoffBusy={documentHandoffBusy}
        onNotice={setNotice}
        onToggleMobileChrome={() => setMobileChromeVisible((visible) => !visible)}
      />
    </div>
  );
}

function ReaderRecoveryBanner(props: { recovery: ReaderRestoreDiagnostics }) {
  const { recovery } = props;
  return (
    <section className="reader-recovery-banner" aria-label="书库恢复检查" role="status">
      <div className="reader-recovery-heading">
        <span className="reader-eyebrow">RECOVERY CHECK</span>
        <strong>
          已恢复 {recovery.restoredBooks}/{recovery.attemptedBooks} 本读物
        </strong>
      </div>
      <span className="reader-recovery-copy">
        {recovery.skippedBooks.length} 个出版物无法从本地 Artifact 重建，原有进度不会被覆盖。
      </span>
      <details className="reader-recovery-details">
        <summary>查看恢复问题</summary>
        <ul>
          {recovery.skippedBooks.map((issue) => (
            <li key={issue.bookId}>
              <strong>{issue.name}</strong>
              <span>{issue.reason}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

interface ImportJob {
  readonly total: number;
  readonly completed: number;
  readonly current: string;
  readonly cancelled: boolean;
  readonly settled: boolean;
  readonly errors: number;
  readonly failedFiles: ReadonlyArray<ImportFailure>;
}

interface ImportFailure {
  readonly file: File;
  readonly error: string;
}

function BootScreen(props: { error: string | null }) {
  return (
    <div className="reader-boot">
      <div className="reader-boot-card">
        <div className="reader-logo">
          <BookOpen className="reader-icon" />
        </div>
        <div>
          <strong>READER STUDIO</strong>
          <span>
            {props.error === null ? "正在打开本地书库 · OPFS / SQLite / FTS5" : props.error}
          </span>
        </div>
        {props.error !== null && <CircleAlert className="reader-boot-alert" />}
      </div>
    </div>
  );
}

function openSearchHit(hit: SearchHit, index?: number): void {
  const state = getReaderState();
  reader.openBook(hit.bookId, hit.sectionId);
  const openedBook = getReaderState().library.find((book) => book.id === hit.bookId);
  const openedSection = openedBook?.sections.find((section) => section.id === hit.sectionId);
  if (openedSection !== undefined) {
    reader.setLocator(
      createTextLocator(
        openedSection,
        hit.matchStart,
        hit.matchStart + Math.max(1, hit.matchLength),
      ),
    );
  }
  // Keep the query as a lightweight reading context so the destination can
  // show the exact hit in the body. Opening a chapter normally still clears
  // search state through ReaderStore.openBook.
  if (state.query.trim() !== "") reader.setSearch(state.query, state.searchHits, hit.bookId);
  if (index !== undefined) reader.setSearchActiveIndex(index);
  reader.revealSearchHit(hit);
  reader.setSearchOpen(false);
}

function ReaderHeader(props: {
  book: ReaderBook;
  searchRef: RefObject<HTMLInputElement | null>;
  onExit: () => void;
  onImport: (files: ReadonlyArray<File>) => void;
  notice: string | null;
  importJob: ImportJob | null;
  onCancelImport: () => void;
  onRetryFailed: () => void;
  onRecoverHandoff?: (() => void) | undefined;
  showInstall: boolean;
  installAvailable: boolean;
  onInstall: () => void;
}) {
  const query = useReader((state) => state.query);
  const searchOpen = useReader((state) => state.searchOpen);
  const searchHits = useReader((state) => state.searchHits);
  const searchActiveIndex = useReader((state) => state.searchActiveIndex);
  const progress = useReader((state) => state.progressByBook[props.book.id]?.percentage ?? 0);
  const fileInput = useRef<HTMLInputElement>(null);
  const onSearch = (value: string) => {
    reader.setSearchOpen(true);
    // The query is kept in the external store so the search panel and header
    // share the same source of truth without prop drilling.
    reader.setSearch(value, getReaderState().searchHits, getReaderState().searchBookId);
  };
  return (
    <header className="reader-header">
      <button
        type="button"
        className="reader-icon-button reader-mobile-exit"
        onClick={props.onExit}
        aria-label="返回工作区主页"
        title="返回工作区主页"
      >
        <ArrowLeft className="reader-icon" />
      </button>
      <div className="reader-brand">
        <div className="reader-brand-mark">
          <BookOpen className="reader-icon" />
        </div>
        <div>
          <div className="reader-brand-title">
            Reader <span>Studio</span>
          </div>
          <div className="reader-brand-subtitle">LOCAL PUBLICATION SPACE</div>
        </div>
      </div>
      <div className="reader-header-divider" />
      <div className="reader-now-reading">
        <span className="reader-eyebrow">NOW READING</span>
        <strong>{props.book.title}</strong>
      </div>
      <div className="reader-header-spacer" />
      <div className={`reader-search ${searchOpen ? "is-open" : ""}`}>
        <Search className="reader-icon" />
        <input
          ref={props.searchRef}
          value={query}
          onChange={(event) => onSearch(event.target.value)}
          onFocus={() => reader.setSearchOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              reader.moveSearch(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              reader.moveSearch(-1);
            } else if (event.key === "Enter") {
              const hit = searchHits[searchActiveIndex];
              if (hit !== undefined) {
                event.preventDefault();
                openSearchHit(hit);
              }
            }
          }}
          placeholder="在书库中搜索…"
          aria-label="在书库中搜索"
          role="combobox"
          aria-expanded={searchOpen && query.length > 0}
          aria-controls="reader-search-results"
          aria-activedescendant={
            searchActiveIndex >= 0 ? `reader-search-hit-${searchActiveIndex}` : undefined
          }
        />
        {query && (
          <button
            type="button"
            className="reader-icon-button reader-search-clear"
            onClick={() => onSearch("")}
            aria-label="清空搜索"
          >
            <X className="reader-icon" />
          </button>
        )}
        <kbd>⌘F</kbd>
      </div>
      <div className="reader-header-progress" title={`当前进度 ${percent(progress)}`}>
        <div className="reader-progress-ring">
          <span>{percent(progress)}</span>
        </div>
      </div>
      {props.showInstall && (
        <button
          type="button"
          className="reader-button reader-install-button"
          onClick={props.onInstall}
          aria-label={props.installAvailable ? "安装 Reader 应用" : "查看 Reader 安装方式"}
          title={props.installAvailable ? "安装 Reader 应用" : "查看 Reader 安装方式"}
        >
          <Download className="reader-icon" />
          <span>安装</span>
        </button>
      )}
      <input
        ref={fileInput}
        className="reader-visually-hidden"
        type="file"
        multiple
        accept={readerAcceptAttribute()}
        aria-label="导入阅读文件"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          props.onImport(files);
        }}
      />
      <button
        type="button"
        className="reader-button reader-button-primary"
        onClick={() => fileInput.current?.click()}
      >
        <Upload className="reader-icon" /> <span>导入</span>
      </button>
      {props.notice !== null && props.importJob === null && (
        <div className="reader-toast" role="status" aria-live="polite">
          <span>{props.notice}</span>
          {props.onRecoverHandoff !== undefined && (
            <button type="button" onClick={props.onRecoverHandoff}>
              打开 Document
            </button>
          )}
        </div>
      )}
      {props.importJob !== null && (
        <div className="reader-import-progress" role="status" aria-live="polite">
          <div className="reader-import-progress-copy">
            <strong>
              {props.importJob.cancelled
                ? "导入已取消"
                : props.importJob.settled
                  ? props.importJob.errors > 0
                    ? `导入完成 · ${props.importJob.errors} 个失败`
                    : "导入完成"
                  : "正在导入"}
            </strong>
            <span>
              {props.importJob.current || `${props.importJob.completed}/${props.importJob.total}`}
            </span>
          </div>
          <progress
            max={props.importJob.total}
            value={props.importJob.completed}
            aria-label="导入进度"
          />
          {!props.importJob.cancelled && !props.importJob.settled && (
            <button type="button" className="reader-import-cancel" onClick={props.onCancelImport}>
              取消
            </button>
          )}
          {props.importJob.settled && props.importJob.failedFiles.length > 0 && (
            <>
              <div className="reader-import-errors" role="alert">
                {props.importJob.failedFiles.slice(0, 3).map((failure) => (
                  <span key={`${failure.file.name}:${failure.error}`}>
                    {failure.file.name}：{failure.error}
                  </span>
                ))}
              </div>
              <button type="button" className="reader-import-retry" onClick={props.onRetryFailed}>
                {props.importJob.cancelled ? "继续导入" : "重试失败"} (
                {props.importJob.failedFiles.length})
              </button>
            </>
          )}
        </div>
      )}
    </header>
  );
}

function ReaderInstallHelp(props: { open: boolean; isIos: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose, props.open]);

  if (!props.open) return null;
  const steps = props.isIos
    ? ["点击浏览器的分享按钮", "选择“添加到主屏幕”", "确认添加，从主屏幕打开 Reader"]
    : ["打开浏览器菜单", "选择“安装应用”或“添加到主屏幕”", "确认后从主屏幕启动 Reader"];
  return (
    <div className="reader-install-layer" onClick={props.onClose} role="presentation">
      <section
        className="reader-install-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-install-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="reader-install-card-heading">
          <div>
            <span className="reader-eyebrow">READ ON THE GO</span>
            <strong id="reader-install-title">把 Reader 放到手机桌面</strong>
          </div>
          <button
            type="button"
            className="reader-icon-button"
            onClick={props.onClose}
            aria-label="关闭安装说明"
          >
            <X className="reader-icon" />
          </button>
        </div>
        <p>安装后可以从桌面直接打开本地书库，阅读界面会进入更专注的独立窗口。</p>
        <ol>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <button
          type="button"
          className="reader-button reader-button-primary"
          onClick={props.onClose}
        >
          知道了
        </button>
      </section>
    </div>
  );
}

function ReaderWorkspace(props: {
  runtime: ReaderRuntime;
  onImport: (files: ReadonlyArray<File>) => void;
  onOpenDocument: () => void;
  documentHandoffBusy: boolean;
  onNotice: (message: string) => void;
  onToggleMobileChrome: () => void;
}) {
  const sidebarOpen = useReader((state) => state.sidebarOpen);
  const searchOpen = useReader((state) => state.searchOpen);
  const settings = useReader((state) => state.settings);
  const active = useReader((state) => activeBook(state));
  const query = useReader((state) => state.query);
  const searchHits = useReader((state) => state.searchHits);
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [annotationLocator, setAnnotationLocator] = useState<ReaderLocator | null>(null);
  const readerMainRef = useRef<HTMLElement>(null);
  const fullscreen = useReaderFullscreen(readerMainRef, props.onNotice);
  if (active === undefined) return null;
  const openAnnotationComposer = () => {
    setAnnotationDraft("");
    setAnnotationLocator(readerSelectionLocator(active) ?? null);
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
    <div className={`reader-workspace ${sidebarOpen ? "sidebar-visible" : "sidebar-hidden"}`}>
      <aside className="reader-sidebar" aria-label="本地书库">
        <LibraryPanel runtime={props.runtime} onImport={props.onImport} />
      </aside>
      {sidebarOpen && (
        <button
          type="button"
          className="reader-sidebar-scrim"
          aria-label="关闭书库"
          onClick={() => reader.toggleSidebar()}
        />
      )}
      <main id="reader-content" ref={readerMainRef} className="reader-main" aria-label="阅读内容">
        <button
          type="button"
          className="reader-mobile-chrome-reveal"
          onClick={props.onToggleMobileChrome}
          aria-label="显示阅读工具栏"
          title="显示阅读工具栏"
        >
          <Menu className="reader-icon" />
        </button>
        {searchOpen && query.length > 0 && <SearchPanel hits={searchHits} />}
        <ReaderToolbar
          book={active}
          settings={settings}
          onAddAnnotation={openAnnotationComposer}
          onOpenDocument={props.onOpenDocument}
          documentHandoffBusy={props.documentHandoffBusy}
          fullscreen={fullscreen}
        />
        {annotationOpen && (
          <AnnotationComposer
            value={annotationDraft}
            onChange={setAnnotationDraft}
            anchor={annotationLocator}
            onCancel={() => {
              setAnnotationLocator(null);
              setAnnotationOpen(false);
            }}
            onSubmit={submitAnnotation}
          />
        )}
        <ReadingView
          runtime={props.runtime}
          book={active}
          onToggleMobileChrome={props.onToggleMobileChrome}
        />
      </main>
    </div>
  );
}

function LibraryPanel(props: {
  runtime: ReaderRuntime;
  onImport: (files: ReadonlyArray<File>) => void;
}) {
  const library = useReader((state) => state.library);
  const activeBookId = useReader((state) => state.activeBookId);
  const progressByBook = useReader((state) => state.progressByBook);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [sortMode, setSortMode] = useState<LibrarySortMode>("recent");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const sortedLibrary = [...library].sort((left, right) => {
    if (sortMode === "title") return left.title.localeCompare(right.title, "zh-CN");
    if (sortMode === "progress") {
      return (
        (progressByBook[right.id]?.percentage ?? 0) - (progressByBook[left.id]?.percentage ?? 0)
      );
    }
    return (
      (progressByBook[right.id]?.updatedAt ?? right.updatedAt) -
      (progressByBook[left.id]?.updatedAt ?? left.updatedAt)
    );
  });
  return (
    <div className="reader-library-panel">
      <div className="reader-sidebar-heading">
        <div>
          <span className="reader-eyebrow">YOUR LIBRARY</span>
          <strong>{library.length} 本读物</strong>
        </div>
        <button
          type="button"
          className="reader-icon-button"
          onClick={() => reader.toggleSidebar()}
          aria-label="收起书库"
        >
          <PanelLeftClose className="reader-icon" />
        </button>
      </div>
      <div className="reader-library-toolbar">
        <span className="reader-eyebrow">SORT BY</span>
        <select
          aria-label="书库排序"
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as LibrarySortMode)}
        >
          <option value="recent">最近阅读</option>
          <option value="title">标题</option>
          <option value="progress">阅读进度</option>
        </select>
      </div>
      <div
        className={`reader-dropzone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          props.onImport([...event.dataTransfer.files]);
        }}
      >
        <Upload className="reader-dropzone-icon" />
        <span>拖入文件到这里</span>
        <small>TXT · MD · HTML · DOCX · EPUB · PDF · CBZ</small>
      </div>
      <input
        ref={fileInput}
        className="reader-visually-hidden"
        type="file"
        multiple
        accept={readerAcceptAttribute()}
        aria-label="导入阅读文件"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          props.onImport(files);
        }}
      />
      <button
        type="button"
        className="reader-library-add"
        onClick={() => fileInput.current?.click()}
      >
        <Plus className="reader-icon" /> 添加本地读物
      </button>
      <div className="reader-library-list">
        {sortedLibrary.map((book) => (
          <LibraryBookCard
            key={book.id}
            book={book}
            active={book.id === activeBookId}
            progress={progressByBook[book.id]?.percentage ?? 0}
            confirming={confirmingId === book.id}
            onRemove={() => setConfirmingId(book.id)}
            onConfirmRemove={() => {
              props.runtime.indexSession?.removeBook(book.id);
              reader.removeBook(book.id);
              setConfirmingId(null);
            }}
            onCancelRemove={() => setConfirmingId(null)}
          />
        ))}
      </div>
      <div className="reader-sidebar-footer">
        <span>
          <span className="reader-live-dot" /> LOCAL ONLY
        </span>
        <span>
          OPFS · FTS5 · {props.runtime.parserMode === "worker" ? "PARSER WORKER" : "PARSER MAIN"}
        </span>
      </div>
    </div>
  );
}

type LibrarySortMode = "recent" | "title" | "progress";

function LibraryBookCard(props: {
  book: ReaderBook;
  active: boolean;
  progress: number;
  confirming: boolean;
  onRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}) {
  return (
    <div className="reader-book-entry">
      <button
        type="button"
        className={`reader-book-card ${props.active ? "is-active" : ""}`}
        onClick={() => reader.openBook(props.book.id)}
        aria-current={props.active ? "page" : undefined}
      >
        <div className={`reader-book-cover reader-cover-${props.book.source.format}`}>
          {props.book.coverUrl ? (
            <img src={props.book.coverUrl} alt="" />
          ) : (
            <>
              {sourceIcon(props.book.source.format)}
              <span>{formatBadge(props.book.source.format)}</span>
            </>
          )}
        </div>
        <div className="reader-book-card-copy">
          <strong>{props.book.title}</strong>
          <span>{props.book.author ?? "本地文档"}</span>
          <div className="reader-book-meta">
            <span>{formatBadge(props.book.source.format)}</span>
            <span>
              {formatBytes(props.book.source.size)} ·{" "}
              {props.progress > 0 ? `${percent(props.progress)} · 继续阅读` : "未开始"}
            </span>
          </div>
          <div className="reader-book-progress">
            <span style={{ width: `${Math.round(props.progress * 100)}%` }} />
          </div>
        </div>
        {props.active && <ChevronRight className="reader-book-active-icon" />}
      </button>
      <button
        type="button"
        className="reader-book-remove"
        aria-label={`移除 ${props.book.title}`}
        onClick={props.onRemove}
      >
        <Trash2 className="reader-icon" />
      </button>
      {props.confirming && (
        <div className="reader-book-confirm" role="alert">
          <span>从本地书库移除？</span>
          <div>
            <button type="button" onClick={props.onConfirmRemove}>
              确认
            </button>
            <button type="button" onClick={props.onCancelRemove}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchPanel(props: { hits: ReadonlyArray<SearchHit> }) {
  const library = useReader((state) => state.library);
  const query = useReader((state) => state.query);
  const searchBusy = useReader((state) => state.searchBusy);
  const searchActiveIndex = useReader((state) => state.searchActiveIndex);
  const activeResultRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeResultRef.current?.scrollIntoView({ block: "nearest" });
  }, [searchActiveIndex]);
  return (
    <section className="reader-search-panel" aria-label="搜索结果">
      <div className="reader-search-panel-top">
        <div>
          <span className="reader-eyebrow">SEARCH</span>
          <strong>{searchBusy ? "正在索引…" : `${props.hits.length} 个命中`}</strong>
        </div>
        <span className="reader-search-query">
          “{query}” · {library.length} 本读物
        </span>
        <button
          type="button"
          className="reader-icon-button"
          onClick={() => reader.setSearchOpen(false)}
          aria-label="关闭搜索结果"
        >
          <X className="reader-icon" />
        </button>
      </div>
      {props.hits.length === 0 && !searchBusy && (
        <div className="reader-search-empty">
          <Search className="reader-icon" />
          没有找到匹配内容，试试更短的关键词。
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
              <em>{hit.snippet}</em>
            </span>
            <ChevronRight className="reader-icon" />
          </button>
        ))}
      </div>
    </section>
  );
}

function ReaderToolbar(props: {
  book: ReaderBook;
  settings: ReaderSettings;
  onAddAnnotation: () => void;
  onOpenDocument: () => void;
  documentHandoffBusy: boolean;
  fullscreen: ReaderFullscreenState;
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
        <LayoutMenu settings={props.settings} />
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
  id: string;
  open: boolean;
  settings: ReaderSettings;
  onClose: () => void;
  onOpenDocument: () => void;
  documentHandoffBusy: boolean;
  fullscreen: ReaderFullscreenState;
}) {
  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose, props.open]);

  if (!props.open) return null;
  const themes: ReadonlyArray<ReaderTheme> = ["paper", "sage", "night"];
  const layouts: ReadonlyArray<ReaderSettings["layout"]> = ["scroll", "paged"];
  return (
    <div className="reader-mobile-sheet-layer" onClick={props.onClose} role="presentation">
      <section
        id={props.id}
        className="reader-mobile-sheet reader-settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-mobile-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="reader-mobile-sheet-handle" aria-hidden="true" />
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
            <div className="reader-mobile-setting-options" role="group" aria-label="阅读方式">
              {layouts.map((layout) => (
                <button
                  type="button"
                  key={layout}
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
              <span aria-live="polite">Aa</span>
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
          <section className="reader-mobile-setting-group" aria-labelledby="reader-width-label">
            <span id="reader-width-label" className="reader-mobile-setting-label">
              正文宽度
            </span>
            <div className="reader-mobile-setting-options" role="group" aria-label="正文宽度">
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
    </div>
  );
}

function AnnotationComposer(props: {
  value: string;
  onChange: (value: string) => void;
  anchor: ReaderLocator | null;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="reader-annotation-composer" onSubmit={props.onSubmit}>
      <div className="reader-annotation-composer-heading">
        <div>
          <span className="reader-eyebrow">NEW NOTE</span>
          <strong>把这一刻留下来</strong>
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

function LayoutMenu(props: { settings: ReaderSettings }) {
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

function ReadingView(props: {
  runtime: ReaderRuntime;
  book: ReaderBook;
  onToggleMobileChrome: () => void;
}) {
  const settings = useReader((state) => state.settings);
  const activeSectionId = useReader((state) => state.activeSectionId);
  const navigationSequence = useReader((state) => state.navigationSequence);
  const progress = useReader((state) => state.progressByBook[props.book.id]?.percentage ?? 0);
  const searchQuery = useReader((state) => state.query);
  const searchReveal = useReader((state) => state.searchReveal);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const lastScrollUpdateRef = useRef(0);
  const userScrollRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTargetRef = useRef<ReaderScrollPosition | null>(null);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const navigationRetryFrameRef = useRef<number | null>(null);
  const navigationRetryTimerRef = useRef<number | null>(null);
  const handledNavigationSequenceRef = useRef(navigationSequence);
  const [contentReadyVersion, setContentReadyVersion] = useState(0);
  const updateLocator = useCallback(() => {
    const container = containerRef.current;
    if (container === null || props.book.sections.length === 0) return;
    const percentage = readerScrollPercentage(container, settings.layout);
    const mapped = readerUsesHorizontalPaging(container, settings.layout)
      ? undefined
      : readerLocatorAtScroll(props.book, container, activeSectionId);
    reader.setLocator(
      mapped?.locator ?? locatorAtPercentage(props.book, percentage),
      mapped?.percentage ?? percentage,
    );
  }, [activeSectionId, props.book, settings.layout]);
  useEffect(() => {
    if (activeSectionId === null || containerRef.current === null) return;
    const explicitNavigation = navigationSequence !== handledNavigationSequenceRef.current;
    if (explicitNavigation) {
      handledNavigationSequenceRef.current = navigationSequence;
      userScrollRef.current = false;
    } else if (userScrollRef.current) {
      userScrollRef.current = false;
      return;
    }
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
    }
    if (navigationRetryFrameRef.current !== null) {
      window.cancelAnimationFrame(navigationRetryFrameRef.current);
    }
    if (navigationRetryTimerRef.current !== null) {
      window.clearTimeout(navigationRetryTimerRef.current);
    }
    let cancelled = false;
    let attempt = 0;
    const retryDelays = [0, 50, 140, 280, 520] as const;
    const attemptScroll = () => {
      if (cancelled) return;
      const container = containerRef.current;
      if (container === null) return;
      const horizontalPaging = readerUsesHorizontalPaging(container, settings.layout);
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const sectionPosition = readerSectionScrollPosition(container, activeSectionId);
      const position = horizontalPaging
        ? explicitNavigation
          ? (sectionPosition ?? { top: 0, left: maxLeft * progress })
          : { top: 0, left: maxLeft * progress }
        : {
            top:
              activeSectionId === props.book.sections[0]?.id
                ? maxTop * progress
                : (sectionPosition?.top ?? 0),
            left: 0,
          };
      programmaticScrollRef.current = true;
      programmaticScrollTargetRef.current = position;
      // PDF canvases can change the height of pages above the destination
      // after the first paint. Recalculate and reapply a few times so a TOC
      // click remains reliable while lazy pages settle.
      container.scrollTo({ ...position, behavior: "instant" });
      if (attempt >= retryDelays.length - 1) return;
      attempt += 1;
      navigationRetryTimerRef.current = window.setTimeout(() => {
        navigationRetryFrameRef.current = window.requestAnimationFrame(attemptScroll);
      }, retryDelays[attempt]);
    };
    navigationRetryFrameRef.current = window.requestAnimationFrame(attemptScroll);
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollTargetRef.current = null;
      programmaticScrollTimerRef.current = null;
    }, 720);
    return () => {
      cancelled = true;
      if (navigationRetryFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationRetryFrameRef.current);
        navigationRetryFrameRef.current = null;
      }
      if (navigationRetryTimerRef.current !== null) {
        window.clearTimeout(navigationRetryTimerRef.current);
        navigationRetryTimerRef.current = null;
      }
    };
  }, [
    activeSectionId,
    contentReadyVersion,
    navigationSequence,
    progress,
    props.book,
    settings.layout,
  ]);
  useEffect(() => {
    const reveal = searchReveal;
    if (
      reveal === null ||
      reveal.bookId !== props.book.id ||
      reveal.sectionId !== activeSectionId ||
      searchQuery.trim() === ""
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      // A reveal supersedes the section navigation scroll that may still be
      // settling. Its own instant scroll should be allowed to establish the
      // finer-grained progress without being mistaken for a user gesture.
      programmaticScrollRef.current = false;
      programmaticScrollTargetRef.current = null;
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
        programmaticScrollTimerRef.current = null;
      }
      // The first mark is the same first occurrence used by the core search
      // index. If a format cannot expose text marks (for example PDF), keep
      // the chapter/page context rather than leaving the user at the old
      // scroll position.
      if (!scrollToReaderMatch(reveal.sectionId, "instant")) {
        scrollToReaderSection(reveal.sectionId, "instant");
      }
      reader.clearSearchReveal(reveal.id);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSectionId, contentReadyVersion, props.book.id, searchQuery, searchReveal]);
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
      }
      if (navigationRetryFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationRetryFrameRef.current);
      }
      if (navigationRetryTimerRef.current !== null) {
        window.clearTimeout(navigationRetryTimerRef.current);
      }
    },
    [],
  );
  return (
    <div
      className={`reader-reading-frame reader-layout-${settings.layout} reader-width-${settings.contentWidth}`}
      style={
        {
          "--reader-reader-font-size": `${settings.fontSize}px`,
          "--reader-reader-line-height": settings.lineHeight,
        } as CSSProperties
      }
    >
      <div
        className="reader-reading-scroll"
        ref={containerRef}
        onClick={(event) => {
          if (!window.matchMedia("(max-width: 860px)").matches) return;
          if (
            event.target instanceof Element &&
            event.target.closest("a, button, input, textarea, select")
          ) {
            return;
          }
          if (window.getSelection()?.isCollapsed === false) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left + bounds.width * 0.22 ||
            event.clientX > bounds.right - bounds.width * 0.22
          ) {
            return;
          }
          props.onToggleMobileChrome();
        }}
        onScroll={() => {
          if (programmaticScrollRef.current) {
            const expected = programmaticScrollTargetRef.current;
            const current = {
              top: containerRef.current?.scrollTop ?? 0,
              left: containerRef.current?.scrollLeft ?? 0,
            };
            // Ignore the event generated by our own auto-scroll. A scroll that
            // lands elsewhere is a user gesture (for example immediately
            // dragging a freshly loaded PDF to its last page).
            if (
              expected !== null &&
              Math.abs(current.top - expected.top) <= 8 &&
              Math.abs(current.left - expected.left) <= 8
            )
              return;
            programmaticScrollRef.current = false;
            programmaticScrollTargetRef.current = null;
            if (programmaticScrollTimerRef.current !== null) {
              window.clearTimeout(programmaticScrollTimerRef.current);
              programmaticScrollTimerRef.current = null;
            }
          }
          if (frameRef.current !== null) return;
          const flush = () => {
            const elapsed = performance.now() - lastScrollUpdateRef.current;
            if (elapsed < 120) {
              frameRef.current = requestAnimationFrame(flush);
              return;
            }
            frameRef.current = null;
            lastScrollUpdateRef.current = performance.now();
            userScrollRef.current = true;
            updateLocator();
          };
          frameRef.current = requestAnimationFrame(flush);
        }}
      >
        <div className="reader-reading-column">
          <ReadingIntro book={props.book} progress={progress} />
          {props.book.source.format === "pdf" ? (
            <PdfReaderView
              book={props.book}
              onReady={() => setContentReadyVersion((version) => version + 1)}
            />
          ) : (
            props.book.sections.map((section) => (
              <SectionView
                key={section.id}
                section={section}
                searchQuery={section.id === activeSectionId ? searchQuery : ""}
              />
            ))
          )}
          <ReadingEnd book={props.book} />
        </div>
      </div>
      <ChapterRail book={props.book} />
      <MobileReadingBar book={props.book} />
    </div>
  );
}

function ReadingIntro(props: { book: ReaderBook; progress: number }) {
  const unit = props.book.source.format === "pdf" ? "页" : "章节";
  return (
    <section className="reader-reading-intro">
      <div className="reader-intro-kicker">
        <span className="reader-live-dot" /> {formatBadge(props.book.source.format)} ·{" "}
        {props.book.sections.length} 个{unit}
      </div>
      <h1>{props.book.title}</h1>
      <p className="reader-intro-author">{props.book.author ?? "本地出版物"}</p>
      <div className="reader-intro-line">
        <span />
        {props.progress > 0 ? `从 ${percent(props.progress)} 继续` : "从头开始阅读"}
        <span />
      </div>
    </section>
  );
}

function SectionView(props: { section: ReaderSection; searchQuery: string }) {
  const html =
    props.section.html === undefined
      ? undefined
      : highlightHtml(props.section.html, props.searchQuery);
  return (
    <section
      className="reader-section"
      data-reader-section={props.section.id}
      data-reader-section-index={props.section.order}
    >
      <div className="reader-section-index">{String(props.section.order + 1).padStart(2, "0")}</div>
      <div className="reader-section-body">
        <div className="reader-section-label">{props.section.label}</div>
        {props.section.kind === "image" && props.section.imageUrl ? (
          <img
            className="reader-section-image"
            src={props.section.imageUrl}
            alt={props.section.imageAlt ?? props.section.label}
            loading="lazy"
          />
        ) : html ? (
          <div className="reader-prose" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="reader-prose">{highlightText(props.section.text, props.searchQuery)}</p>
        )}
      </div>
    </section>
  );
}

function PdfReaderView(props: { book: ReaderBook; onReady?: () => void }) {
  const activeSectionId = useReader((state) => state.activeSectionId);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const sourceUrl = props.book.source.objectUrl;
  useEffect(() => {
    let cancelled = false;
    let opened: PDFDocumentProxy | undefined;
    setPdfDocument(null);
    setLoading(true);
    setError(null);
    if (sourceUrl === undefined) {
      setError("PDF 源文件未恢复");
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const load = async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        const document = await pdfjs.getDocument(sourceUrl).promise;
        opened = document;
        if (cancelled) {
          await document.destroy();
          return;
        }
        setPdfDocument(document);
        setLoading(false);
        props.onReady?.();
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (opened !== undefined) void opened.destroy();
    };
  }, [sourceUrl, loadAttempt]);

  return (
    <div className="reader-pdf-view">
      <div className="reader-pdf-meta">
        <span>PDF · {props.book.sections.length} 页</span>
        <span>连续阅读 · 进入视口后按需渲染</span>
      </div>
      {loading && <div className="reader-media-loading">正在打开 PDF…</div>}
      {error !== null && (
        <div className="reader-media-error" role="alert">
          <CircleAlert className="reader-icon" />
          <span>{error}</span>
          <button
            type="button"
            className="reader-media-retry"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          >
            重试
          </button>
        </div>
      )}
      {pdfDocument !== null && (
        <div className="reader-pdf-pages" aria-label="PDF 连续页面">
          {props.book.sections.map((section) => (
            <PdfPageView
              key={section.id}
              document={pdfDocument}
              section={section}
              active={section.id === activeSectionId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type PdfPageStatus = "idle" | "loading" | "ready" | "error";

function PdfPageView(props: {
  document: PDFDocumentProxy;
  section: ReaderSection;
  active: boolean;
}) {
  const pageNumber = props.section.pageNumber ?? props.section.order + 1;
  const pageShellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(props.active || pageNumber <= 2);
  const [contentWidth, setContentWidth] = useState(0);
  const [status, setStatus] = useState<PdfPageStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [renderAttempt, setRenderAttempt] = useState(0);

  useEffect(() => {
    if (props.active) setNearViewport(true);
  }, [props.active]);

  useEffect(() => {
    const element = pageShellRef.current;
    if (element === null) return;
    const updateWidth = () => {
      const width = element.clientWidth;
      if (width > 0) setContentWidth(width);
    };
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = pageShellRef.current;
    if (element === null || nearViewport) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const root = element.closest<HTMLElement>(".reader-reading-scroll");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { root, rootMargin: "900px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [nearViewport]);

  useEffect(() => {
    if (!nearViewport || contentWidth <= 0) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | undefined;
    let page: { cleanup: () => void } | undefined;
    setStatus("loading");
    setError(null);
    const render = async () => {
      try {
        const loadedPage = await props.document.getPage(pageNumber);
        page = loadedPage;
        if (cancelled) {
          loadedPage.cleanup();
          return;
        }
        const baseViewport = loadedPage.getViewport({ scale: 1 });
        const targetWidth = clamp(contentWidth - 24, 320, 840);
        const deviceScale = clamp(window.devicePixelRatio || 1, 1, 2);
        const cssScale = targetWidth / baseViewport.width;
        const viewport = loadedPage.getViewport({ scale: cssScale * deviceScale });
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("Canvas 2D 不可用");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${Math.ceil(viewport.width / deviceScale)}px`;
        canvas.style.height = `${Math.ceil(viewport.height / deviceScale)}px`;
        renderTask = loadedPage.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
        if (!cancelled) setStatus("ready");
      } catch (reason) {
        if (cancelled) return;
        setStatus("error");
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        page?.cleanup();
      }
    };
    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      page?.cleanup();
    };
  }, [contentWidth, nearViewport, pageNumber, props.document, renderAttempt]);

  return (
    <section
      ref={pageShellRef}
      className={`reader-pdf-page ${props.active ? "is-active" : ""}`}
      data-reader-section={props.section.id}
      data-reader-section-index={props.section.order}
      aria-label={`PDF 第 ${pageNumber} 页`}
    >
      <div className="reader-pdf-page-meta">
        <span>PAGE {String(pageNumber).padStart(3, "0")}</span>
        {props.active && <strong>当前页</strong>}
      </div>
      <div className={`reader-pdf-canvas-shell is-${status}`}>
        {status === "idle" && <span className="reader-pdf-placeholder">滚动到此处加载页面</span>}
        {status === "loading" && <span className="reader-media-loading">正在渲染页面…</span>}
        {status === "error" && (
          <div className="reader-media-error" role="alert">
            <CircleAlert className="reader-icon" />
            <span>{error ?? "页面渲染失败"}</span>
            <button
              type="button"
              className="reader-media-retry"
              onClick={() => setRenderAttempt((attempt) => attempt + 1)}
            >
              重试本页
            </button>
          </div>
        )}
        <canvas ref={canvasRef} className="reader-pdf-canvas" />
      </div>
    </section>
  );
}

function ReadingEnd(props: { book: ReaderBook }) {
  return (
    <div className="reader-reading-end">
      <Check className="reader-icon" />
      <strong>读到这里</strong>
      <span>{props.book.title} · 进度已保存在当前设备</span>
    </div>
  );
}

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

function MobileReadingBar(props: { book: ReaderBook }) {
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
    if (target !== undefined) reader.openBook(props.book.id, target.id);
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
            {activeIndex + 1} / {props.book.sections.length} {unit} · {percent(progress)}
          </span>
          <ChevronUp className="reader-mobile-nav-current-chevron" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="reader-mobile-nav-step"
          onClick={() => openAdjacent(-1)}
          disabled={activeIndex <= 0}
          aria-label="上一章"
          title="上一章"
        >
          <ChevronLeft className="reader-icon" />
        </button>
        <button
          type="button"
          className="reader-mobile-nav-step"
          onClick={() => openAdjacent(1)}
          disabled={activeIndex >= props.book.sections.length - 1}
          aria-label="下一章"
          title="下一章"
        >
          <ChevronRight className="reader-icon" />
        </button>
        <div className="reader-mobile-nav-progress" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

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
    <div className="reader-mobile-sheet-layer" onClick={props.onClose} role="presentation">
      <section
        id="reader-mobile-navigation-sheet"
        className="reader-mobile-sheet reader-navigation-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-mobile-navigation-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="reader-mobile-sheet-handle" aria-hidden="true" />
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
    </div>
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

function ChapterRail(props: { book: ReaderBook }) {
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
