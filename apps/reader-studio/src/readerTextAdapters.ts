import type { ReaderBook, ReaderOpenInput } from "@bcr/reader-core";
import { makeBook } from "./readerAdapterShared";
import { markdownToHtml, sanitizeHtml, textSections } from "./readerMarkup";
import { firstLocalElement, localName } from "./readerXml";

export async function openText(input: ReaderOpenInput): Promise<ReaderBook> {
  if (input.format === "fb2") return openFb2(input);
  const raw = await input.file.text();
  if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (input.format === "html") {
    const parsed = sanitizeHtml(raw);
    return makeBook(
      input,
      [
        {
          id: "section-1",
          order: 0,
          label: parsed.title ?? "正文",
          kind: "text",
          text: parsed.text,
          html: parsed.html,
        },
      ],
      parsed.title === undefined ? {} : { title: parsed.title },
    );
  }
  if (input.format === "markdown") {
    const parsed = markdownToHtml(raw);
    const text = raw.replace(/\r\n?/gu, "\n").trim();
    return makeBook(
      input,
      [
        {
          id: "section-1",
          order: 0,
          label: parsed.title ?? "正文",
          kind: "text",
          text: text || "暂无内容",
          html: parsed.html,
        },
      ],
      parsed.title === undefined ? {} : { title: parsed.title },
    );
  }
  return makeBook(input, textSections(raw, input.format));
}

function fb2Author(document: Document): string | undefined {
  const author = firstLocalElement(document, "author");
  if (author === undefined) return undefined;
  const parts = ["first-name", "middle-name", "last-name", "nickname"]
    .map((name) => firstLocalElement(author, name)?.textContent?.trim())
    .filter((value): value is string => Boolean(value));
  return parts.join(" ") || undefined;
}

async function openFb2(input: ReaderOpenInput): Promise<ReaderBook> {
  const raw = await input.file.text();
  if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const document = new DOMParser().parseFromString(raw, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("FB2 XML 无法解析");
  const body = firstLocalElement(document, "body");
  const allSections =
    body === undefined
      ? []
      : [...body.getElementsByTagName("*")].filter((element) => localName(element) === "section");
  const sections = allSections
    .filter((section) => {
      let parent = section.parentElement;
      while (parent !== null && parent !== body) {
        if (localName(parent) === "section") return false;
        parent = parent.parentElement;
      }
      return true;
    })
    .map((section, order) => {
      const label = firstLocalElement(section, "title")?.textContent?.replace(/\s+/gu, " ").trim();
      const sanitized = sanitizeHtml(new XMLSerializer().serializeToString(section));
      return {
        id: `fb2:${order + 1}`,
        order,
        label: label || `Section ${order + 1}`,
        kind: "text" as const,
        text: sanitized.text || section.textContent?.replace(/\s+/gu, " ").trim() || "暂无内容",
        html: sanitized.html,
      };
    });
  const title = firstLocalElement(document, "book-title")?.textContent?.trim();
  const author = fb2Author(document);
  const language = firstLocalElement(document, "lang")?.textContent?.trim();
  if (sections.length === 0) {
    return makeBook(input, textSections(raw, input.format), {
      ...(title === undefined ? {} : { title }),
      ...(author === undefined ? {} : { author }),
      ...(language === undefined ? {} : { language }),
    });
  }
  return makeBook(input, sections, {
    ...(title === undefined ? {} : { title }),
    ...(author === undefined ? {} : { author }),
    ...(language === undefined ? {} : { language }),
  });
}
