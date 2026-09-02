import {
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";
import type {
  ReaderAdapter,
  ReaderBook,
  ReaderFormat,
  ReaderOpenInput,
  ReaderSection,
  ReaderTocItem,
} from "@bcr/reader-core";
import type { DocumentContentPackage } from "@bcr/document-core";
import { READER_FORMAT_CATALOG, readerAcceptAttribute } from "@bcr/reader-core";

const TEXT_FORMATS = new Set<ReaderFormat>(["txt", "markdown", "html", "fb2"]);
const IMAGE_EXTENSIONS = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/iu;

export function formatForFile(file: Pick<File, "name" | "type">): ReaderFormat {
  const extension = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
  const byExtension = READER_FORMAT_CATALOG.find((descriptor) =>
    descriptor.extensions.includes(`.${extension}`),
  );
  if (byExtension !== undefined) return byExtension.format;
  const byMime = READER_FORMAT_CATALOG.find((descriptor) =>
    descriptor.mimeTypes.includes(file.type.toLocaleLowerCase()),
  );
  if (byMime !== undefined) return byMime.format;
  return "unknown";
}

export { readerAcceptAttribute };

export function displayFormat(format: ReaderFormat): string {
  return format === "markdown" ? "MARKDOWN" : format.toUpperCase();
}

function titleFromName(name: string): string {
  const basename = name.split(/[\\/]/u).pop() ?? name;
  return basename.replace(/\.[^.]+$/u, "") || "未命名读物";
}

function baseSource(input: ReaderOpenInput, objectUrl?: string) {
  return {
    name: input.file.name,
    format: input.format,
    mime: input.file.type || mimeForFormat(input.format),
    size: input.file.size,
    ...(objectUrl === undefined ? {} : { objectUrl }),
  } as const;
}

function mimeForFormat(format: ReaderFormat): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "epub":
    case "cbz":
      return "application/zip";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "html":
      return "text/html";
    case "markdown":
      return "text/markdown";
    default:
      return "text/plain";
  }
}

function makeBook(
  input: ReaderOpenInput,
  sections: ReadonlyArray<ReaderSection>,
  metadata: {
    title?: string;
    author?: string;
    language?: string;
    coverUrl?: string;
    toc?: ReadonlyArray<ReaderTocItem>;
  } = {},
): ReaderBook {
  const now = Date.now();
  return {
    id: input.id,
    title: metadata.title?.trim() || titleFromName(input.file.name),
    ...(metadata.author === undefined ? {} : { author: metadata.author }),
    ...(metadata.language === undefined ? {} : { language: metadata.language }),
    ...(metadata.coverUrl === undefined ? {} : { coverUrl: metadata.coverUrl }),
    source: baseSource(input),
    sections,
    ...(metadata.toc === undefined ? {} : { toc: metadata.toc }),
    importedAt: now,
    updatedAt: now,
    tags: [displayFormat(input.format)],
  };
}

function readerFormatForDocument(format: DocumentContentPackage["format"]): ReaderFormat {
  return format === "image" ? "unknown" : format;
}

/**
 * Rehydrate a ReaderBook from the normalized Document contract. This path is
 * intentionally synchronous: the source file is still handed over for
 * durable storage, while parsing work has already happened in Document.
 */
export function openReaderContentPackage(
  file: File,
  id: string,
  content: DocumentContentPackage,
): ReaderBook {
  const format = readerFormatForDocument(content.format);
  const input: ReaderOpenInput = { file, id, format };
  const inferredTitle =
    content.metadata.title ?? content.blocks.find((block) => block.kind === "heading")?.label;
  const sections = content.blocks.map((block) => {
    const kind: ReaderSection["kind"] =
      block.kind === "image" ? "image" : block.kind === "page" ? "pdf-page" : "text";
    const sanitizedHtml = block.html === undefined ? undefined : sanitizeHtml(block.html).html;
    return {
      id: block.id,
      order: block.order,
      label: block.label,
      kind,
      text: block.text,
      ...(sanitizedHtml === undefined ? {} : { html: sanitizedHtml }),
      ...(block.kind === "image" && block.href !== undefined
        ? { imageUrl: safeUrl(block.href) }
        : {}),
      ...(block.pageNumber === undefined ? {} : { pageNumber: block.pageNumber }),
      ...(block.href === undefined ? {} : { href: block.href }),
    } satisfies ReaderSection;
  });
  return makeBook(input, sections, {
    ...(inferredTitle === undefined ? {} : { title: inferredTitle }),
    ...(content.metadata.author === undefined ? {} : { author: content.metadata.author }),
    ...(content.metadata.language === undefined ? {} : { language: content.metadata.language }),
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function safeUrl(value: string): string {
  const trimmed = value.trim();
  if (/^(?:https?:|mailto:|#|\/|\.\/|\.\.\/|data:image\/)/iu.test(trimmed)) return trimmed;
  return "#";
}

const SAFE_INLINE_STYLE_PROPERTIES = new Set([
  "background-color",
  "border",
  "border-bottom",
  "border-left",
  "border-radius",
  "border-right",
  "border-top",
  "color",
  "direction",
  "display",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "height",
  "letter-spacing",
  "line-height",
  "list-style",
  "list-style-type",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "text-decoration",
  "text-indent",
  "text-transform",
  "vertical-align",
  "white-space",
  "width",
  "word-spacing",
  "writing-mode",
]);

/** Keep common publication typography while rejecting executable/escaping CSS. */
export function sanitizeInlineStyle(value: string): string | undefined {
  const declarations = value.split(";").flatMap((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator <= 0) return [];
    const property = declaration.slice(0, separator).trim().toLocaleLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    if (
      !SAFE_INLINE_STYLE_PROPERTIES.has(property) ||
      propertyValue.length === 0 ||
      /[{}<>]|(?:url|expression|javascript|vbscript|@import)/iu.test(propertyValue)
    ) {
      return [];
    }
    const cleanedValue = propertyValue.replace(/\s*!important\s*$/iu, "").trim();
    return cleanedValue.length > 0 ? [`${property}: ${cleanedValue}`] : [];
  });
  return declarations.length > 0 ? declarations.join("; ") : undefined;
}

function inlineMarkdown(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/gu, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/gu, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/gu, "<em>$1</em>");
  html = html.replace(/_([^_]+)_/gu, "<em>$1</em>");
  html = html.replace(/!?\[([^\]]+)\]\(([^)]+)\)/gu, (_match, label: string, url: string) => {
    const href = safeUrl(url);
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  return html;
}

function markdownToHtml(markdown: string): { html: string; title?: string } {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let inCode = false;
  let code: string[] = [];
  let title: string | undefined;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    html.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushCode = () => {
    if (code.length === 0) return;
    html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
  };

  for (const line of lines) {
    if (/^\s*```/u.test(line)) {
      flushParagraph();
      flushList();
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 1;
      const value = heading[2] ?? "";
      if (title === undefined && level <= 2) title = value;
      html.push(`<h${level}>${inlineMarkdown(value)}</h${level}>`);
      continue;
    }
    const listItem = /^\s*[-*+]\s+(.+)$/u.exec(line);
    if (listItem !== null) {
      flushParagraph();
      list.push(listItem[1] ?? "");
      continue;
    }
    if (/^\s*>\s?/u.test(line)) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${inlineMarkdown(line.replace(/^\s*>\s?/u, ""))}</blockquote>`);
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  if (inCode) flushCode();
  return { html: html.join("\n"), ...(title === undefined ? {} : { title }) };
}

function textSections(text: string, format: ReaderFormat): ReadonlyArray<ReaderSection> {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  const blocks = normalized
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const sourceBlocks = blocks.length > 0 ? blocks : [normalized || "暂无内容"];
  return sourceBlocks.map((block, order) => ({
    id: `section-${order + 1}`,
    order,
    label: format === "txt" ? `段落 ${order + 1}` : `Section ${order + 1}`,
    kind: "text" as const,
    text: block,
    ...(format === "txt" ? { html: `<p>${escapeHtml(block).replace(/\n/gu, "<br />")}</p>` } : {}),
  }));
}

function sanitizeHtml(rawHtml: string): { html: string; text: string; title?: string } {
  const parser = new DOMParser();
  const document = parser.parseFromString(rawHtml, "text/html");
  for (const element of document.querySelectorAll(
    "script, style, iframe, object, embed, form, link",
  )) {
    element.remove();
  }
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      const name = attribute.name.toLocaleLowerCase();
      const value = attribute.value;
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
      } else if (name === "style") {
        const safe = sanitizeInlineStyle(value);
        if (safe === undefined) element.removeAttribute(attribute.name);
        else element.setAttribute(attribute.name, safe);
      } else if (name === "href" || name === "src" || name === "poster") {
        element.setAttribute(attribute.name, safeUrl(value));
      }
    }
  }
  const heading = document.querySelector("h1, h2, title")?.textContent?.trim();
  return {
    html: document.body?.innerHTML ?? "",
    text: document.body?.textContent?.replace(/\s+/gu, " ").trim() ?? "",
    ...(heading ? { title: heading } : {}),
  };
}

async function openText(input: ReaderOpenInput): Promise<ReaderBook> {
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

function entryMap(entries: ReadonlyArray<Entry>): Map<string, FileEntry> {
  return new Map(
    entries
      .filter((entry): entry is FileEntry => !entry.directory)
      .map((entry) => [normalizeArchivePath(entry.filename), entry]),
  );
}

function normalizeArchivePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolveArchivePath(base: string, target: string): string {
  const raw = target.split("#")[0] ?? "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A malformed href should simply remain unresolved, never abort the whole book.
  }
  return normalizeArchivePath(`${base}/${decoded}`);
}

function archiveMime(path: string): string {
  const extension = path.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "png") return "image/png";
  if (extension === "avif") return "image/avif";
  if (extension === "bmp") return "image/bmp";
  return "image/jpeg";
}

async function archiveObjectUrl(
  entry: FileEntry,
  mime: string,
  allocated?: string[],
): Promise<string> {
  const blob = await entry.getData(new BlobWriter(mime));
  const url = URL.createObjectURL(blob);
  allocated?.push(url);
  return url;
}

function revokeObjectUrls(urls: ReadonlyArray<string>): void {
  for (const url of urls) URL.revokeObjectURL(url);
}

function localName(element: Element): string {
  return element.localName ?? element.tagName.split(":").pop() ?? element.tagName;
}

function metadataValue(document: Document, name: string): string | undefined {
  const element = [...document.getElementsByTagName("*")].find(
    (candidate) => localName(candidate) === name,
  );
  return element?.textContent?.trim() || undefined;
}

function firstLocalElement(root: Document | Element, name: string): Element | undefined {
  return [...root.getElementsByTagName("*")].find((candidate) => localName(candidate) === name);
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

async function readArchiveText(entry: FileEntry): Promise<string> {
  return entry.getData(new TextWriter());
}

function archiveDirectory(path: string): string {
  return normalizeArchivePath(path).split("/").slice(0, -1).join("/");
}

function directChildren(element: Element, name: string): ReadonlyArray<Element> {
  return [...element.children].filter((child) => localName(child) === name);
}

function manifestHasProperty(properties: string, property: string): boolean {
  return properties
    .split(/\s+/u)
    .some((candidate) => candidate.toLocaleLowerCase() === property.toLocaleLowerCase());
}

function tocTarget(
  base: string,
  target: string | null,
  sectionsByHref: ReadonlyMap<string, ReaderSection>,
): { href?: string; sectionId?: string } {
  if (target === null || target.trim() === "") return {};
  const href = resolveArchivePath(base, target);
  const section = sectionsByHref.get(href);
  return {
    href,
    ...(section === undefined ? {} : { sectionId: section.id }),
  };
}

function tocItem(
  id: string,
  label: string,
  target: { href?: string; sectionId?: string },
  children: ReadonlyArray<ReaderTocItem>,
): ReaderTocItem {
  return {
    id,
    label: label.trim() || "未命名条目",
    ...(target.sectionId === undefined ? {} : { sectionId: target.sectionId }),
    ...(target.href === undefined ? {} : { href: target.href }),
    ...(children.length === 0 ? {} : { children }),
  };
}

function parseEpubNavItems(
  list: Element,
  base: string,
  sectionsByHref: ReadonlyMap<string, ReaderSection>,
  prefix: string,
): ReadonlyArray<ReaderTocItem> {
  return directChildren(list, "li").flatMap((item, index) => {
    const anchor =
      directChildren(item, "a")[0] ??
      [...item.getElementsByTagName("*")].find((element) => localName(element) === "a");
    const nested = directChildren(item, "ol")[0];
    const children =
      nested === undefined
        ? []
        : parseEpubNavItems(nested, base, sectionsByHref, `${prefix}.${index + 1}`);
    const label = anchor?.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    const target = tocTarget(base, anchor?.getAttribute("href") ?? null, sectionsByHref);
    if (label === "" && children.length === 0) return [];
    return [tocItem(`${prefix}.${index + 1}`, label, target, children)];
  });
}

function parseEpubNav(
  raw: string,
  navPath: string,
  sectionsByHref: ReadonlyMap<string, ReaderSection>,
): ReadonlyArray<ReaderTocItem> {
  const document = new DOMParser().parseFromString(raw, "text/html");
  const nav =
    [...document.getElementsByTagName("*")].find((element) => {
      if (localName(element) !== "nav") return false;
      const type = `${element.getAttribute("epub:type") ?? ""} ${element.getAttribute("type") ?? ""}`;
      return /(?:^|\s)toc(?:\s|$)/iu.test(type);
    }) ?? [...document.getElementsByTagName("*")].find((element) => localName(element) === "nav");
  const list =
    nav === undefined
      ? undefined
      : (directChildren(nav, "ol")[0] ??
        [...nav.getElementsByTagName("*")].find((element) => localName(element) === "ol"));
  return list === undefined
    ? []
    : parseEpubNavItems(list, archiveDirectory(navPath), sectionsByHref, "toc");
}

function parseNcxItems(
  container: Element,
  base: string,
  sectionsByHref: ReadonlyMap<string, ReaderSection>,
  prefix: string,
): ReadonlyArray<ReaderTocItem> {
  return directChildren(container, "navPoint").flatMap((point, index) => {
    const label =
      firstLocalElement(point, "navLabel")?.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    const content = firstLocalElement(point, "content");
    const target = tocTarget(base, content?.getAttribute("src") ?? null, sectionsByHref);
    const children = parseNcxItems(point, base, sectionsByHref, `${prefix}.${index + 1}`);
    if (label === "" && children.length === 0) return [];
    return [tocItem(`${prefix}.${index + 1}`, label, target, children)];
  });
}

async function epubToc(
  files: ReadonlyMap<string, FileEntry>,
  manifest: ReadonlyMap<
    string,
    { id: string; href: string; mediaType: string; properties: string }
  >,
  sections: ReadonlyArray<ReaderSection>,
): Promise<ReadonlyArray<ReaderTocItem>> {
  const sectionsByHref = new Map(
    sections.flatMap((section) =>
      section.href === undefined ? [] : [[section.href, section] as const],
    ),
  );
  const navItem = [...manifest.values()].find((item) =>
    manifestHasProperty(item.properties, "nav"),
  );
  if (navItem !== undefined) {
    const entry = files.get(navItem.href);
    if (entry !== undefined) {
      try {
        const items = parseEpubNav(await readArchiveText(entry), navItem.href, sectionsByHref);
        if (items.length > 0) return items;
      } catch {
        // A malformed navigation document should not make the publication unreadable.
      }
    }
  }
  const ncxItem = [...manifest.values()].find(
    (item) => item.mediaType.toLocaleLowerCase() === "application/x-dtbncx+xml",
  );
  if (ncxItem === undefined) return [];
  const entry = files.get(ncxItem.href);
  if (entry === undefined) return [];
  try {
    const document = new DOMParser().parseFromString(
      await readArchiveText(entry),
      "application/xml",
    );
    const navMap = firstLocalElement(document, "navMap");
    return navMap === undefined
      ? []
      : parseNcxItems(navMap, archiveDirectory(ncxItem.href), sectionsByHref, "toc");
  } catch {
    return [];
  }
}

async function openEpub(input: ReaderOpenInput): Promise<ReaderBook> {
  const reader = new ZipReader(new BlobReader(input.file));
  const allocatedUrls: string[] = [];
  let succeeded = false;
  try {
    const entries = await reader.getEntries();
    const files = entryMap(entries);
    const container = files.get("META-INF/container.xml");
    if (container === undefined) throw new Error("EPUB 缺少 META-INF/container.xml");
    const containerDocument = new DOMParser().parseFromString(
      await readArchiveText(container),
      "application/xml",
    );
    const rootfile = [...containerDocument.getElementsByTagName("*")].find(
      (element) => localName(element) === "rootfile",
    );
    const packagePath = rootfile?.getAttribute("full-path");
    if (!packagePath) throw new Error("EPUB 未找到 OPF package");
    const packageEntry = files.get(normalizeArchivePath(packagePath));
    if (packageEntry === undefined) throw new Error(`EPUB OPF 不存在：${packagePath}`);
    const packageDocument = new DOMParser().parseFromString(
      await readArchiveText(packageEntry),
      "application/xml",
    );
    const packageBase = normalizeArchivePath(packagePath).split("/").slice(0, -1).join("/");
    const manifest = new Map<
      string,
      { id: string; href: string; mediaType: string; properties: string }
    >();
    for (const element of [...packageDocument.getElementsByTagName("*")].filter(
      (candidate) => localName(candidate) === "item",
    )) {
      const id = element.getAttribute("id");
      const href = element.getAttribute("href");
      if (id && href)
        manifest.set(id, {
          id,
          href: resolveArchivePath(packageBase, href),
          mediaType: element.getAttribute("media-type") ?? "",
          properties: element.getAttribute("properties") ?? "",
        });
    }
    const spineItems = [...packageDocument.getElementsByTagName("*")]
      .filter((candidate) => localName(candidate) === "itemref")
      .map((candidate) => candidate.getAttribute("idref"))
      .filter((id): id is string => id !== null);
    const sections: ReaderSection[] = [];
    for (const [order, id] of spineItems.entries()) {
      if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const item = manifest.get(id);
      if (item === undefined) continue;
      const entry = files.get(item.href);
      if (entry === undefined) continue;
      const parsed = sanitizeHtml(await readArchiveText(entry));
      const title = parsed.title ?? `Chapter ${order + 1}`;
      const htmlDocument = new DOMParser().parseFromString(parsed.html, "text/html");
      const chapterBase = item.href.split("/").slice(0, -1).join("/");
      for (const image of htmlDocument.querySelectorAll("img[src]")) {
        const source = image.getAttribute("src");
        if (!source) continue;
        const imageEntry = files.get(resolveArchivePath(chapterBase, source));
        if (imageEntry === undefined) {
          image.removeAttribute("src");
          continue;
        }
        image.setAttribute(
          "src",
          await archiveObjectUrl(imageEntry, archiveMime(imageEntry.filename), allocatedUrls),
        );
      }
      sections.push({
        // href is the semantic identity; keep it in the id so a refreshed
        // spine/order does not strand a saved Locator.
        id: `epub:${item.href}`,
        order,
        label: title,
        kind: "text",
        text: parsed.text,
        html: htmlDocument.body?.innerHTML ?? parsed.html,
        href: item.href,
      });
    }
    if (sections.length === 0) throw new Error("EPUB spine 没有可读章节");

    const toc = await epubToc(files, manifest, sections);

    let coverUrl: string | undefined;
    const coverItem =
      [...manifest.values()].find((item) => item.properties.includes("cover-image")) ??
      [...manifest.values()].find(
        (item) => item.mediaType.startsWith("image/") && /cover/iu.test(item.href),
      );
    if (coverItem !== undefined) {
      const coverEntry = files.get(coverItem.href);
      if (coverEntry !== undefined)
        coverUrl = await archiveObjectUrl(
          coverEntry,
          coverItem.mediaType || archiveMime(coverEntry.filename),
          allocatedUrls,
        );
    }
    const title = metadataValue(packageDocument, "title");
    const author = metadataValue(packageDocument, "creator");
    const language = metadataValue(packageDocument, "language");
    const book = makeBook(input, sections, {
      ...(title === undefined ? {} : { title }),
      ...(author === undefined ? {} : { author }),
      ...(language === undefined ? {} : { language }),
      ...(coverUrl === undefined ? {} : { coverUrl }),
      ...(toc.length === 0 ? {} : { toc }),
    });
    succeeded = true;
    return book;
  } finally {
    if (!succeeded) revokeObjectUrls(allocatedUrls);
    await reader.close();
  }
}

function docxBlockText(element: Element): string {
  let text = "";
  for (const descendant of element.getElementsByTagName("*")) {
    const name = localName(descendant);
    if (name === "t") text += descendant.textContent ?? "";
    else if (name === "tab") text += "\t";
    else if (name === "br" || name === "cr") text += "\n";
  }
  return text.replace(/\u00a0/gu, " ").trim();
}

function docxHeadingLevel(paragraph: Element): number | undefined {
  const style = [...paragraph.getElementsByTagName("*")]
    .find((element) => localName(element) === "pStyle")
    ?.getAttribute("w:val")
    ?.trim();
  const match = /^heading([1-6])$/iu.exec(style ?? "");
  return match === null ? undefined : Number(match[1]);
}

function docxTableText(table: Element): string {
  const rows = [...table.getElementsByTagName("*")].filter(
    (element) => localName(element) === "tr",
  );
  return rows
    .map((row) =>
      [...row.getElementsByTagName("*")]
        .filter((element) => localName(element) === "tc")
        .map((cell) => docxBlockText(cell))
        .join("\t"),
    )
    .filter(Boolean)
    .join("\n");
}

/** WordprocessingML is a ZIP package; keep the first adapter text-first and
 * deliberately omit drawings instead of creating broken external URLs. */
async function openDocx(input: ReaderOpenInput): Promise<ReaderBook> {
  const reader = new ZipReader(new BlobReader(input.file));
  try {
    const entries = await reader.getEntries();
    const files = entryMap(entries);
    const documentEntry = files.get("word/document.xml");
    if (documentEntry === undefined) throw new Error("DOCX 缺少 word/document.xml");
    const document = new DOMParser().parseFromString(
      await readArchiveText(documentEntry),
      "application/xml",
    );
    if (document.querySelector("parsererror")) throw new Error("DOCX XML 无法解析");
    const body = firstLocalElement(document, "body");
    if (body === undefined) throw new Error("DOCX 没有可读正文");
    const sections: ReaderSection[] = [];
    let firstHeading: string | undefined;
    for (const block of body.children) {
      if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const kind = localName(block);
      const text = kind === "tbl" ? docxTableText(block) : docxBlockText(block);
      if (!text) continue;
      const headingLevel = kind === "p" ? docxHeadingLevel(block) : undefined;
      if (headingLevel !== undefined && firstHeading === undefined) firstHeading = text;
      const label =
        headingLevel !== undefined
          ? text
          : kind === "tbl"
            ? `表格 ${sections.length + 1}`
            : `段落 ${sections.length + 1}`;
      const escaped = escapeHtml(text).replace(/\n/gu, "<br />");
      sections.push({
        id: `docx:${sections.length + 1}`,
        order: sections.length,
        label,
        kind: "text",
        text,
        html:
          headingLevel === undefined
            ? `<p>${escaped}</p>`
            : `<h${headingLevel}>${escaped}</h${headingLevel}>`,
      });
    }
    if (sections.length === 0) throw new Error("DOCX 没有可读正文");

    const coreEntry = files.get("docProps/core.xml");
    let title: string | undefined;
    let author: string | undefined;
    let language: string | undefined;
    if (coreEntry !== undefined) {
      const core = new DOMParser().parseFromString(
        await readArchiveText(coreEntry),
        "application/xml",
      );
      title = firstLocalElement(core, "title")?.textContent?.trim() || undefined;
      author = firstLocalElement(core, "creator")?.textContent?.trim() || undefined;
      language = firstLocalElement(core, "language")?.textContent?.trim() || undefined;
    }
    const metadata: { title?: string; author?: string; language?: string } = {};
    const resolvedTitle = title ?? firstHeading;
    if (resolvedTitle !== undefined) metadata.title = resolvedTitle;
    if (author !== undefined) metadata.author = author;
    if (language !== undefined) metadata.language = language;
    return makeBook(input, sections, metadata);
  } finally {
    await reader.close();
  }
}

async function openCbz(input: ReaderOpenInput): Promise<ReaderBook> {
  const reader = new ZipReader(new BlobReader(input.file));
  const allocatedUrls: string[] = [];
  let succeeded = false;
  try {
    const entries = await reader.getEntries();
    const images = entries
      .filter(
        (entry): entry is FileEntry => !entry.directory && IMAGE_EXTENSIONS.test(entry.filename),
      )
      .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
    if (images.length === 0) throw new Error("CBZ 中没有可读图片");
    const sections: ReaderSection[] = [];
    for (const [order, entry] of images.entries()) {
      if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const imageUrl = await archiveObjectUrl(entry, archiveMime(entry.filename), allocatedUrls);
      sections.push({
        id: `page-${order + 1}`,
        order,
        label: `Page ${String(order + 1).padStart(3, "0")}`,
        kind: "image",
        text: `Page ${order + 1}`,
        imageUrl,
        imageAlt: entry.filename,
      });
    }
    const coverUrl = sections[0]?.imageUrl;
    const book = makeBook(input, sections, coverUrl === undefined ? {} : { coverUrl });
    succeeded = true;
    return book;
  } finally {
    if (!succeeded) revokeObjectUrls(allocatedUrls);
    await reader.close();
  }
}

async function openPdf(input: ReaderOpenInput): Promise<ReaderBook> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();
  const objectUrl = URL.createObjectURL(input.file);
  try {
    // Let PDF.js stream the Blob URL in its own worker; avoid eagerly copying
    // the entire document into a main-thread ArrayBuffer.
    const document = await pdfjs.getDocument(objectUrl).promise;
    const sections: ReaderSection[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();
      sections.push({
        id: `page-${pageNumber}`,
        order: pageNumber - 1,
        label: `Page ${String(pageNumber).padStart(3, "0")}`,
        kind: "pdf-page",
        text: text || `PDF page ${pageNumber}`,
        pageNumber,
      });
    }
    await document.cleanup();
    return {
      ...makeBook(input, sections),
      source: { ...baseSource(input, objectUrl) },
    };
  } catch (reason) {
    URL.revokeObjectURL(objectUrl);
    throw reason;
  }
}

const textAdapter: ReaderAdapter = {
  id: "text",
  formats: ["txt", "markdown", "html", "fb2"],
  canHandle: ({ format }) => TEXT_FORMATS.has(format),
  open: openText,
};

const docxAdapter: ReaderAdapter = {
  id: "docx",
  formats: ["docx"],
  canHandle: ({ format }) => format === "docx",
  open: openDocx,
};

const epubAdapter: ReaderAdapter = {
  id: "epub",
  formats: ["epub"],
  canHandle: ({ format }) => format === "epub",
  open: openEpub,
};

const cbzAdapter: ReaderAdapter = {
  id: "cbz",
  formats: ["cbz"],
  canHandle: ({ format }) => format === "cbz",
  open: openCbz,
};

const pdfAdapter: ReaderAdapter = {
  id: "pdf",
  formats: ["pdf"],
  canHandle: ({ format }) => format === "pdf",
  open: openPdf,
};

const unsupportedAdapter: ReaderAdapter = {
  id: "future-formats",
  formats: ["cbr", "mobi", "azw3", "unknown"],
  canHandle: () => true,
  open: async ({ format }) => {
    throw new Error(
      `${format.toUpperCase()} 适配器尚未启用；当前可直接阅读 TXT / Markdown / HTML / FB2 / EPUB / PDF / CBZ`,
    );
  },
};

export const readerAdapters: ReadonlyArray<ReaderAdapter> = [
  textAdapter,
  docxAdapter,
  epubAdapter,
  cbzAdapter,
  pdfAdapter,
  unsupportedAdapter,
];

export async function openReaderFile(
  file: File,
  id: string,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  const format = formatForFile(file);
  const adapter = readerAdapters.find((candidate) => candidate.formats.includes(format));
  if (adapter === undefined) throw new Error(`不支持的文件格式：${file.name}`);
  return adapter.open({ file, id, format, signal });
}
