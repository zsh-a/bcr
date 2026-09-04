import {
  createLocator,
  createTextAnchor,
  createTextLocator,
  normalizeSearchQuery,
  searchTextRange,
  searchTextRangeNear,
  type ReaderBook,
  type ReaderLocator,
  type ReaderSection,
} from "@bcr/reader-core";
import type { ReaderSettings } from "./model";
import type { ReaderInternalLinkTarget } from "./navigation";

export interface ReaderScrollPosition {
  readonly top: number;
  readonly left: number;
}

interface ReaderRenderedTextNode {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

interface ReaderRenderedText {
  readonly value: string;
  readonly nodes: ReadonlyArray<ReaderRenderedTextNode>;
}

interface ReaderCaretPoint {
  readonly node: Node;
  readonly offset: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function elementForNode(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

/** Capture a same-section text selection as a reflow-safe Reader locator. */
export function readerSelectionLocator(book: ReaderBook): ReaderLocator | undefined {
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

function readerProbeTopOffset(container: HTMLElement): number {
  return Math.min(140, container.clientHeight * 0.32);
}

function readerRenderedText(root: Element): ReaderRenderedText {
  const walker = document.createTreeWalker(root, 4);
  const nodes: ReaderRenderedTextNode[] = [];
  let value = "";
  let current = walker.nextNode();
  while (current !== null) {
    const textNode = current as Text;
    const start = value.length;
    value += textNode.data;
    if (textNode.data.length > 0) {
      nodes.push({ node: textNode, start, end: value.length });
    }
    current = walker.nextNode();
  }
  return { value, nodes };
}

function readerCaretFromPoint(x: number, y: number): ReaderCaretPoint | undefined {
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { readonly offsetNode: Node; readonly offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = caretDocument.caretPositionFromPoint?.(x, y);
  if (position !== null && position !== undefined) {
    return { node: position.offsetNode, offset: position.offset };
  }
  const range = caretDocument.caretRangeFromPoint?.(x, y);
  return range === null || range === undefined
    ? undefined
    : { node: range.startContainer, offset: range.startOffset };
}

function readerTextNodeOffset(
  rendered: ReaderRenderedText,
  node: Node,
  offset: number,
): number | undefined {
  if (!(node instanceof Text)) return undefined;
  const entry = rendered.nodes.find((candidate) => candidate.node === node);
  return entry === undefined
    ? undefined
    : entry.start + Math.min(node.data.length, Math.max(0, offset));
}

function readerDomPointAtOffset(
  rendered: ReaderRenderedText,
  offset: number,
): { readonly node: Text; readonly offset: number } | undefined {
  if (rendered.nodes.length === 0) return undefined;
  const safeOffset = Math.min(rendered.value.length, Math.max(0, offset));
  const entry =
    rendered.nodes.find((candidate) => safeOffset <= candidate.end) ??
    rendered.nodes[rendered.nodes.length - 1];
  return entry === undefined
    ? undefined
    : { node: entry.node, offset: Math.min(entry.node.data.length, safeOffset - entry.start) };
}

function readerTextLocatorAtPoint(
  book: ReaderBook,
  container: HTMLElement,
  x: number,
  y: number,
): { readonly locator: ReaderLocator; readonly sectionIndex: number } | undefined {
  const caret = readerCaretFromPoint(x, y);
  if (caret === undefined || !container.contains(caret.node)) return undefined;
  const sectionElement = elementForNode(caret.node)?.closest<HTMLElement>("[data-reader-section]");
  const prose = elementForNode(caret.node)?.closest<HTMLElement>(".reader-prose");
  if (
    sectionElement === null ||
    sectionElement === undefined ||
    prose === null ||
    prose === undefined ||
    !container.contains(sectionElement)
  ) {
    return undefined;
  }
  const sectionId = sectionElement.dataset.readerSection;
  const sectionIndex = sectionId === undefined ? -1 : (sectionIndexMap(book).get(sectionId) ?? -1);
  const section = book.sections[sectionIndex];
  if (section === undefined || section.kind !== "text" || section.text.length === 0) {
    return undefined;
  }
  const rendered = readerRenderedText(prose);
  const offset = readerTextNodeOffset(rendered, caret.node, caret.offset);
  if (offset === undefined || rendered.value.length === 0) return undefined;
  const progressionHint = offset / rendered.value.length;
  const afterStart = (() => {
    let start = offset;
    while (start < rendered.value.length && /\s/u.test(rendered.value[start] ?? "")) start += 1;
    return start;
  })();
  const beforeEnd = (() => {
    let end = offset;
    while (end > 0 && /\s/u.test(rendered.value[end - 1] ?? "")) end -= 1;
    return end;
  })();
  const lengths = [96, 64, 40, 24, 16, 8, 4] as const;
  const candidates = [
    ...lengths.map((length) => rendered.value.slice(afterStart, afterStart + length)),
    ...lengths.map((length) => rendered.value.slice(Math.max(0, beforeEnd - length), beforeEnd)),
  ];
  for (const candidate of candidates) {
    if (normalizeSearchQuery(candidate).length === 0) continue;
    const match = searchTextRangeNear(section.text, candidate, progressionHint);
    if (match === undefined || match.length === 0) continue;
    return {
      locator: createTextLocator(section, match.start, match.start + match.length),
      sectionIndex,
    };
  }
  const anchorStart = afterStart < rendered.value.length ? afterStart : Math.max(0, beforeEnd - 40);
  const textAnchor = createTextAnchor(
    rendered.value,
    anchorStart,
    Math.min(rendered.value.length, anchorStart + 96),
  );
  return textAnchor === undefined
    ? undefined
    : {
        locator: createLocator(section, progressionHint, undefined, textAnchor),
        sectionIndex,
      };
}

function readerTextAnchorRange(
  sectionElement: HTMLElement,
  locator: ReaderLocator,
): Range | undefined {
  const exact = locator.textAnchor?.exact;
  const prose = sectionElement.querySelector<HTMLElement>(".reader-prose");
  if (exact === undefined || exact.length === 0 || prose === null) return undefined;
  const rendered = readerRenderedText(prose);
  const match = searchTextRangeNear(rendered.value, exact, locator.progression);
  if (match === undefined) return undefined;
  const start = readerDomPointAtOffset(rendered, match.start);
  const end = readerDomPointAtOffset(rendered, match.start + match.length);
  if (start === undefined || end === undefined) return undefined;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function readerRangeScrollPosition(
  container: HTMLElement,
  range: Range,
): ReaderScrollPosition | undefined {
  const rangeRect = [...range.getClientRects()].find((rect) => rect.width > 0 || rect.height > 0);
  if (rangeRect === undefined) return undefined;
  const containerRect = container.getBoundingClientRect();
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  return {
    top: Math.min(
      maxTop,
      Math.max(
        0,
        container.scrollTop + rangeRect.top - containerRect.top - readerProbeTopOffset(container),
      ),
    ),
    left: Math.min(
      maxLeft,
      Math.max(
        0,
        container.scrollLeft + rangeRect.left - containerRect.left - container.clientWidth * 0.32,
      ),
    ),
  };
}

function readerElementScrollPosition(
  container: HTMLElement,
  target: Element,
): ReaderScrollPosition {
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

export function readerSectionScrollPosition(
  container: HTMLElement,
  sectionId: string,
): ReaderScrollPosition | undefined {
  const target = container.querySelector<HTMLElement>(
    `[data-reader-section="${CSS.escape(sectionId)}"]`,
  );
  return target === null ? undefined : readerElementScrollPosition(container, target);
}

export function readerLocatorScrollPosition(
  container: HTMLElement,
  section: ReaderSection,
  locator: ReaderLocator,
  horizontal: boolean,
): ReaderScrollPosition | undefined {
  const target = container.querySelector<HTMLElement>(
    `[data-reader-section="${CSS.escape(section.id)}"]`,
  );
  if (target === null) return undefined;
  const anchorRange = readerTextAnchorRange(target, locator);
  if (anchorRange !== undefined) {
    const position = readerRangeScrollPosition(container, anchorRange);
    if (position !== undefined) return position;
  }
  if (locator.progression <= 0) return readerElementScrollPosition(container, target);
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  return {
    top: horizontal
      ? 0
      : Math.min(
          maxTop,
          Math.max(
            0,
            container.scrollTop +
              targetRect.top -
              containerRect.top +
              targetRect.height * locator.progression -
              readerProbeTopOffset(container),
          ),
        ),
    left: horizontal
      ? Math.min(
          maxLeft,
          Math.max(
            0,
            container.scrollLeft +
              targetRect.left -
              containerRect.left +
              targetRect.width * locator.progression -
              container.clientWidth * 0.32,
          ),
        )
      : 0,
  };
}

export function readerInternalLinkScrollPosition(
  container: HTMLElement,
  target: ReaderInternalLinkTarget,
): ReaderScrollPosition | undefined {
  const section = container.querySelector<HTMLElement>(
    `[data-reader-section="${CSS.escape(target.sectionId)}"]`,
  );
  if (section === null) return undefined;
  if (target.fragment === undefined) return readerElementScrollPosition(container, section);
  const fragmentTarget = [...section.querySelectorAll<HTMLElement>("[id], a[name]")].find(
    (element) => element.id === target.fragment || element.getAttribute("name") === target.fragment,
  );
  return readerElementScrollPosition(container, fragmentTarget ?? section);
}

export function readerUsesHorizontalPaging(
  container: HTMLElement,
  layout: ReaderSettings["layout"],
): boolean {
  if (layout !== "paged") return false;
  const horizontalMax = Math.max(0, container.scrollWidth - container.clientWidth);
  const verticalMax = Math.max(0, container.scrollHeight - container.clientHeight);
  return horizontalMax > verticalMax;
}

export function readerScrollPercentage(
  container: HTMLElement,
  layout: ReaderSettings["layout"],
): number {
  const horizontal = readerUsesHorizontalPaging(container, layout);
  const offset = horizontal ? container.scrollLeft : container.scrollTop;
  const max = horizontal
    ? Math.max(1, container.scrollWidth - container.clientWidth)
    : Math.max(1, container.scrollHeight - container.clientHeight);
  return clamp(offset / max, 0, 1);
}

export function scrollToReaderSection(
  sectionId: string,
  behavior: ScrollBehavior = "smooth",
): void {
  const container = document.querySelector<HTMLElement>(".reader-reading-scroll");
  if (container === null) return;
  const position = readerSectionScrollPosition(container, sectionId);
  if (position === undefined) return;
  container.scrollTo({ ...position, behavior });
}

export function scrollToReaderMatch(
  sectionId: string,
  behavior: ScrollBehavior = "smooth",
): boolean {
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

export function readerLocatorAtScroll(
  book: ReaderBook,
  container: HTMLElement,
  fallbackSectionId?: string | null,
): { locator: ReaderLocator; percentage: number } | undefined {
  if (book.sections.length === 0) return undefined;
  const containerRect = container.getBoundingClientRect();
  const probeTop = containerRect.top + readerProbeTopOffset(container);
  const probeX = containerRect.left + containerRect.width * 0.5;
  const probePoints = [
    [probeX, probeTop],
    [containerRect.left + containerRect.width * 0.35, probeTop],
    [containerRect.left + containerRect.width * 0.65, probeTop],
    [probeX, containerRect.top + container.clientHeight * 0.45],
  ] as const;
  for (const [x, y] of probePoints) {
    const textPosition = readerTextLocatorAtPoint(book, container, x, y);
    if (textPosition === undefined) continue;
    const denominator = Math.max(1, book.sections.length - 1);
    return {
      locator: textPosition.locator,
      percentage: clamp(
        (textPosition.sectionIndex + textPosition.locator.progression) / denominator,
        0,
        1,
      ),
    };
  }
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
