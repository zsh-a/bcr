import type { ReaderBook } from "@bcr/reader-core";
import { loadSectionContent } from "./readerContent";
import type { TxtMeasuredParagraph } from "./txtPageLayout";

/** Measure real browser line breaks, including fallback fonts, punctuation and mixed scripts. */
export function createTxtPageMeasurement(book: ReaderBook, probe: HTMLElement) {
  const cache = new Map<number, TxtMeasuredParagraph>();
  let retained = 0;
  let disposed = false;
  const headings = new Set(book.toc?.map((item) => item.sectionId));
  return {
    dispose() {
      disposed = true;
      cache.clear();
    },
    async measure(index: number): Promise<TxtMeasuredParagraph> {
      if (disposed) throw new DOMException("Layout superseded", "AbortError");
      const cached = cache.get(index);
      if (cached) {
        cache.delete(index);
        cache.set(index, cached);
        return cached;
      }
      const section = book.sections[index]!;
      await loadSectionContent(section);
      if (disposed) throw new DOMException("Layout superseded", "AbortError");
      const text = section.text;
      const heading = headings.has(section.id) && !text.includes("\n");
      probe.style.fontWeight = heading ? "600" : "";
      probe.style.textIndent = heading ? "0px" : "";
      probe.textContent = text;
      const node = probe.firstChild;
      const breaks = node ? textLineBreaks(node, text) : [0, 0];
      probe.textContent = "";
      const result = { text, breaks, heading };
      cache.set(index, result);
      retained += text.length;
      // A source paragraph can itself exceed the budget; retain only that one unit.
      while (cache.size > 1 && (cache.size > 32 || retained > 24000)) {
        const oldest = cache.keys().next().value!;
        retained -= cache.get(oldest)!.text.length;
        cache.delete(oldest);
      }
      return result;
    },
  };
}

export function textLineBreaks(node: Node, text: string): number[] {
  const range = document.createRange();
  range.selectNodeContents(node);
  const tops = [...new Set(Array.from(range.getClientRects(), (rect) => rect.top))];
  const breaks = [0];
  for (const top of tops.slice(1)) {
    let low = breaks.at(-1)!,
      high = text.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      range.setStart(node, mid);
      range.setEnd(node, Math.min(text.length, mid + 1));
      const rect = range.getClientRects()[0];
      if (rect && rect.top < top - 0.5) low = mid + 1;
      else high = mid;
    }
    // Never create a boundary inside a surrogate pair.
    if (low > 0 && /[\uDC00-\uDFFF]/u.test(text[low] ?? "")) low--;
    if (low > breaks.at(-1)! && low < text.length) breaks.push(low);
  }
  if (breaks.at(-1) !== text.length) breaks.push(text.length);
  return breaks.length > 1 ? breaks : [0, text.length];
}
