import { sectionReadingWeight, type ReaderBook, type ReaderSection } from "@bcr/reader-core";
import type { ReaderRuntime } from "./readerRuntimeCore";
import { attachReaderContent, hasDeferredContent } from "./readerContent";

const FORMATS = new Set(["html", "markdown", "docx", "fb2"]);
const pathFor = (id: string) => `reader/content-v1/${encodeURIComponent(id)}`;

/** Derived blocks are rebuildable from the original source; snapshots only keep their offsets. */
export async function storeStructuredContent(
  runtime: ReaderRuntime,
  book: ReaderBook,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  if (!FORMATS.has(book.source.format) || hasDeferredContent(book)) return book;
  const size = book.sections.reduce(
    (sum, section) => sum + section.text.length + (section.html?.length ?? 0),
    0,
  );
  if (size < 256 * 1024) return book;
  const descriptors: ReaderSection[] = [];
  let offset = 0,
    index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        signal?.throwIfAborted();
        const section = book.sections[index++];
        if (!section) {
          controller.close();
          return;
        }
        const bytes = new TextEncoder().encode(
          JSON.stringify({ text: section.text, html: section.html }),
        );
        descriptors.push({
          ...section,
          text: "",
          html: undefined,
          contentInfo: {
            textLength: section.text.length,
            readingWeight: sectionReadingWeight(section),
            storageRange: { start: offset, end: offset + bytes.length },
          },
        });
        offset += bytes.length;
        controller.enqueue(bytes);
      } catch (error) {
        controller.error(error);
      }
    },
  });
  await runtime.binary.putStream(pathFor(book.id), stream);
  signal?.throwIfAborted();
  return attachStructuredContent(runtime, { ...book, sections: descriptors });
}

export function attachStructuredContent(runtime: ReaderRuntime, book: ReaderBook): ReaderBook {
  const path = pathFor(book.id);
  return {
    ...book,
    sections: attachReaderContent(book.sections, {
      async read(index, signal) {
        signal.throwIfAborted();
        const range = book.sections[index]!.contentInfo?.storageRange;
        if (!range) throw new Error("正文块索引缺失");
        const bytes = await runtime.binary.readRange(path, range.start, range.end - range.start);
        signal.throwIfAborted();
        if (bytes.length !== range.end - range.start)
          throw new Error("正文块缺失，请重新打开出版物");
        const content: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (
          typeof content !== "object" ||
          content === null ||
          !("text" in content) ||
          typeof content.text !== "string"
        )
          throw new Error("正文块格式无效");
        const html =
          "html" in content && typeof content.html === "string" ? content.html : undefined;
        return { text: content.text, html };
      },
    }),
  };
}
export async function restoreStructuredContent(
  runtime: ReaderRuntime,
  book: ReaderBook,
): Promise<ReaderBook | undefined> {
  if (!book.sections.every((section) => section.contentInfo?.storageRange)) return;
  const size = await runtime.binary.size(pathFor(book.id));
  let end = 0;
  if (
    size === undefined ||
    !book.sections.every((section) => {
      const range = section.contentInfo!.storageRange!;
      if (
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        range.start !== end ||
        range.end <= range.start ||
        range.end > size
      )
        return false;
      end = range.end;
      return true;
    })
  )
    return;
  return attachStructuredContent(runtime, book);
}
