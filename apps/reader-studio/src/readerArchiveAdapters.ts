import {
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";
import type { ReaderBook, ReaderOpenInput, ReaderSection, ReaderTocItem } from "@bcr/reader-core";
import { makeBook } from "./readerAdapterShared";
import { escapeHtml, sanitizeHtml } from "./readerMarkup";
import { firstLocalElement, localName, metadataValue } from "./readerXml";

const IMAGE_EXTENSIONS = /\\.(avif|bmp|gif|jpe?g|png|svg|webp)$/iu;

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

export async function openEpub(input: ReaderOpenInput): Promise<ReaderBook> {
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
export async function openDocx(input: ReaderOpenInput): Promise<ReaderBook> {
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

export async function openCbz(input: ReaderOpenInput): Promise<ReaderBook> {
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
