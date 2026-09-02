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
} from "@bcr/reader-core";

const TEXT_FORMATS = new Set<ReaderFormat>(["txt", "markdown", "html", "fb2"]);
const IMAGE_EXTENSIONS = /\.(avif|bmp|gif|jpe?g|png|webp)$/iu;

export function formatForFile(file: Pick<File, "name" | "type">): ReaderFormat {
  const extension = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (extension === "md" || extension === "markdown" || extension === "mdown") return "markdown";
  if (extension === "html" || extension === "htm" || file.type === "text/html") return "html";
  if (extension === "txt" || file.type === "text/plain") return "txt";
  if (extension === "epub" || file.type === "application/epub+zip") return "epub";
  if (extension === "pdf" || file.type === "application/pdf") return "pdf";
  if (extension === "cbz" || file.type === "application/vnd.comicbook+zip") return "cbz";
  if (extension === "cbr" || file.type === "application/vnd.comicbook-rar") return "cbr";
  if (extension === "fb2") return "fb2";
  if (extension === "mobi") return "mobi";
  if (extension === "azw3" || extension === "azw") return "azw3";
  return "unknown";
}

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
  metadata: { title?: string; author?: string; language?: string; coverUrl?: string } = {},
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
    importedAt: now,
    updatedAt: now,
    tags: [displayFormat(input.format)],
  };
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
      if (name.startsWith("on") || name === "style") element.removeAttribute(attribute.name);
      if (name === "href" || name === "src" || name === "poster") {
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
  return normalizeArchivePath(`${base}/${decodeURIComponent(target.split("#")[0] ?? "")}`);
}

function archiveMime(path: string): string {
  const extension = path.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "png") return "image/png";
  if (extension === "avif") return "image/avif";
  return "image/jpeg";
}

async function archiveObjectUrl(entry: FileEntry, mime: string): Promise<string> {
  const blob = await entry.getData(new BlobWriter(mime));
  return URL.createObjectURL(blob);
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

async function readArchiveText(entry: FileEntry): Promise<string> {
  return entry.getData(new TextWriter());
}

async function openEpub(input: ReaderOpenInput): Promise<ReaderBook> {
  const reader = new ZipReader(new BlobReader(input.file));
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
    const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
    for (const element of [...packageDocument.getElementsByTagName("*")].filter(
      (candidate) => localName(candidate) === "item",
    )) {
      const id = element.getAttribute("id");
      const href = element.getAttribute("href");
      if (id && href)
        manifest.set(id, {
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
          await archiveObjectUrl(imageEntry, archiveMime(imageEntry.filename)),
        );
      }
      sections.push({
        id: `section-${order + 1}`,
        order,
        label: title,
        kind: "text",
        text: parsed.text,
        html: htmlDocument.body?.innerHTML ?? parsed.html,
        href: item.href,
      });
    }
    if (sections.length === 0) throw new Error("EPUB spine 没有可读章节");

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
        );
    }
    const title = metadataValue(packageDocument, "title");
    const author = metadataValue(packageDocument, "creator");
    const language = metadataValue(packageDocument, "language");
    return makeBook(input, sections, {
      ...(title === undefined ? {} : { title }),
      ...(author === undefined ? {} : { author }),
      ...(language === undefined ? {} : { language }),
      ...(coverUrl === undefined ? {} : { coverUrl }),
    });
  } finally {
    await reader.close();
  }
}

async function openCbz(input: ReaderOpenInput): Promise<ReaderBook> {
  const reader = new ZipReader(new BlobReader(input.file));
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
      const imageUrl = await archiveObjectUrl(entry, archiveMime(entry.filename));
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
    return makeBook(input, sections, coverUrl === undefined ? {} : { coverUrl });
  } finally {
    await reader.close();
  }
}

async function openPdf(input: ReaderOpenInput): Promise<ReaderBook> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();
  const document = await pdfjs.getDocument({ data: await input.file.arrayBuffer() }).promise;
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
    source: { ...baseSource(input, URL.createObjectURL(input.file)) },
  };
}

const textAdapter: ReaderAdapter = {
  id: "text",
  formats: ["txt", "markdown", "html", "fb2"],
  canHandle: ({ format }) => TEXT_FORMATS.has(format),
  open: openText,
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
      `${format.toUpperCase()} 适配器尚未启用；当前可直接阅读 TXT / Markdown / HTML / EPUB / PDF / CBZ`,
    );
  },
};

export const readerAdapters: ReadonlyArray<ReaderAdapter> = [
  textAdapter,
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
