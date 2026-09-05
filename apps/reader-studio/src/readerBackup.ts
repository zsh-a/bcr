import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { hashReadableStream, type ArtifactRef } from "@bcr/core";
import { Effect } from "effect";
import { MemoryStore } from "@bcr/storage-opfs";
import type { ReaderBook, ReaderTocItem } from "@bcr/reader-core";
import { DEFAULT_READER_SETTINGS, type ReaderSettings, type ReaderState } from "./model";
import {
  persistBook,
  restoredAnnotations,
  restoredBookmarks,
  type PersistedBook,
} from "./readerPersistence";
import { normalizeReaderProgress } from "./session-contract";
import { parseReaderFile } from "./readerImports";
import { sanitizeHtml } from "./readerMarkup";
import type { ReaderRuntime } from "./readerRuntimeCore";

const MAX_BYTES = 512 * 1024 * 1024;
const MANIFEST = "reader.json";
interface BackupBook {
  readonly book: PersistedBook;
  readonly source?: { readonly path: string; readonly hash: string; readonly size: number };
}
export interface ReaderBackup {
  readonly format: "bcr-reader-backup";
  readonly version: 1;
  readonly createdAt: number;
  readonly books: ReadonlyArray<BackupBook>;
  readonly progressByBook: ReaderState["progressByBook"];
  readonly bookmarksByBook: ReaderState["bookmarksByBook"];
  readonly annotationsByBook: ReaderState["annotationsByBook"];
  readonly settings: ReaderSettings;
}
export interface PreparedReaderBackup {
  readonly manifest: ReaderBackup;
  readonly sources: ReadonlyMap<string, Blob>;
}
type Report = (message: string) => void;
function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("已取消", "AbortError");
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function safeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length < 512 &&
    !["__proto__", "constructor", "prototype"].includes(value)
  );
}

function backupToc(
  raw: unknown,
  sectionIds: ReadonlySet<string>,
  depth = 0,
): ReadonlyArray<ReaderTocItem> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || depth > 24 || raw.length > 5000) throw new Error("备份目录格式无效");
  return raw.map((item: unknown) => {
    if (!object(item) || !safeId(item["id"]) || typeof item["label"] !== "string")
      throw new Error("备份目录格式无效");
    const children = backupToc(item["children"], sectionIds, depth + 1);
    return {
      id: item["id"],
      label: item["label"],
      ...(typeof item["sectionId"] === "string" && sectionIds.has(item["sectionId"])
        ? { sectionId: item["sectionId"] }
        : {}),
      ...(typeof item["href"] === "string" ? { href: item["href"] } : {}),
      ...(children === undefined ? {} : { children }),
    };
  });
}

/** Validate before opening parsers or writing artifacts. Unknown versions fail closed. */
export function decodeReaderBackup(value: unknown): ReaderBackup {
  const fail = (): never => {
    throw new Error("备份格式无效或版本不受支持，请选择 Reader 导出的 ZIP 备份");
  };
  if (
    !object(value) ||
    value["format"] !== "bcr-reader-backup" ||
    value["version"] !== 1 ||
    !finite(value["createdAt"]) ||
    !Array.isArray(value["books"]) ||
    value["books"].length > 5000
  )
    return fail();
  const ids = new Set<string>();
  const books: BackupBook[] = value["books"].map((entry: unknown) => {
    if (!object(entry) || !object(entry["book"])) return fail();
    const book = entry["book"];
    if (
      !safeId(book["id"]) ||
      ids.has(book["id"]) ||
      typeof book["title"] !== "string" ||
      !finite(book["importedAt"]) ||
      !finite(book["updatedAt"]) ||
      !strings(book["tags"]) ||
      !object(book["source"]) ||
      !Array.isArray(book["sections"]) ||
      book["sections"].length === 0
    )
      return fail();
    ids.add(book["id"]);
    const source = book["source"];
    if (
      typeof source["name"] !== "string" ||
      typeof source["mime"] !== "string" ||
      !finite(source["size"]) ||
      source["size"] < 0 ||
      !["txt", "markdown", "html", "docx", "epub", "pdf", "cbz"].includes(String(source["format"]))
    )
      return fail();
    const sectionIds = new Set<string>();
    for (const section of book["sections"]) {
      if (
        !object(section) ||
        !safeId(section["id"]) ||
        sectionIds.has(section["id"]) ||
        !finite(section["order"]) ||
        typeof section["label"] !== "string" ||
        typeof section["text"] !== "string" ||
        !["text", "image", "pdf-page"].includes(String(section["kind"])) ||
        (section["html"] !== undefined && typeof section["html"] !== "string")
      )
        return fail();
      sectionIds.add(section["id"]);
    }
    if (entry["source"] !== undefined) {
      const file = entry["source"];
      if (
        !object(file) ||
        typeof file["hash"] !== "string" ||
        !/^[a-f0-9]{64}$/u.test(file["hash"]) ||
        file["path"] !== `sources/${file["hash"]}` ||
        !finite(file["size"]) ||
        file["size"] < 0
      )
        return fail();
    } else if (["pdf", "epub", "docx", "cbz"].includes(String(source["format"]))) return fail();
    // Keep a narrow, validated projection. Never trust paths/refs/URLs in JSON.
    const persisted = book as unknown as PersistedBook;
    const toc = backupToc(book["toc"], sectionIds);
    return {
      book: {
        id: persisted.id,
        ...(toc === undefined ? {} : { toc }),
        title: persisted.title,
        ...(typeof book["author"] === "string" ? { author: book["author"] } : {}),
        ...(typeof book["language"] === "string" ? { language: book["language"] } : {}),
        source: {
          name: persisted.source.name,
          mime: persisted.source.mime,
          format: persisted.source.format,
          size: persisted.source.size,
        },
        sections: persisted.sections.map((section, order) => ({
          id: section.id,
          order,
          label: section.label,
          kind: section.kind,
          text: section.text,
          ...(typeof section.html === "string" ? { html: sanitizeHtml(section.html).html } : {}),
          ...(finite(section.pageNumber) ? { pageNumber: section.pageNumber } : {}),
          ...(finite(section.pageAspectRatio) && section.pageAspectRatio > 0
            ? { pageAspectRatio: section.pageAspectRatio }
            : {}),
          ...(typeof section.href === "string" ? { href: section.href } : {}),
        })),
        importedAt: persisted.importedAt,
        updatedAt: persisted.updatedAt,
        tags: persisted.tags,
      },
      ...(entry["source"] === undefined
        ? {}
        : { source: entry["source"] as unknown as NonNullable<BackupBook["source"]> }),
    };
  });
  const settings = value["settings"];
  if (
    !object(settings) ||
    !["paper", "night", "sage"].includes(String(settings["theme"])) ||
    !["scroll", "paged"].includes(String(settings["layout"])) ||
    !["sans", "serif", "kai"].includes(String(settings["fontFamily"])) ||
    !["sans", "serif", "mono"].includes(String(settings["latinFontFamily"])) ||
    !["narrow", "wide"].includes(String(settings["contentWidth"])) ||
    !finite(settings["fontSize"]) ||
    settings["fontSize"] < 12 ||
    settings["fontSize"] > 48 ||
    !finite(settings["lineHeight"]) ||
    settings["lineHeight"] < 1 ||
    settings["lineHeight"] > 3
  )
    return fail();
  for (const key of ["progressByBook", "bookmarksByBook", "annotationsByBook"])
    if (!object(value[key])) return fail();
  const projected = books.map((entry) => entry.book);
  return {
    format: "bcr-reader-backup",
    version: 1,
    createdAt: value["createdAt"],
    books,
    settings: { ...DEFAULT_READER_SETTINGS, ...settings } as ReaderSettings,
    progressByBook: normalizeReaderProgress(projected, value["progressByBook"]),
    bookmarksByBook: restoredBookmarks(projected, value["bookmarksByBook"]),
    annotationsByBook: restoredAnnotations(projected, value["annotationsByBook"]),
  };
}

export async function createReaderBackup(
  runtime: ReaderRuntime,
  state: ReaderState,
  report: Report = () => {},
  signal?: AbortSignal,
): Promise<Blob> {
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  const books: BackupBook[] = [];
  const written = new Set<string>();
  let bytes = 0;
  try {
    for (const book of state.library) {
      check(signal);
      report(`正在备份 ${books.length + 1}/${state.library.length} · ${book.title}`);
      let source: BackupBook["source"];
      if (book.source.ref !== undefined) {
        const ref = book.source.ref;
        const blob = await Effect.runPromise(
          runtime.artifacts.getBlob({
            id: ref.id,
            hash: ref.hash,
            storage: ref.storage,
            type: "file/publication",
            format: ref.mime,
          }),
        );
        if (bytes + blob.size > MAX_BYTES)
          throw new Error("当前备份上限为 512 MiB，请缩小书库后重试");
        const hash = await hashReadableStream(blob.stream());
        if (hash !== ref.hash) throw new Error(`${book.title} 的源文件校验失败，备份未生成`);
        source = { path: `sources/${hash}`, hash, size: blob.size };
        if (!written.has(source.path)) {
          bytes += blob.size;
          if (bytes > MAX_BYTES) throw new Error("当前备份上限为 512 MiB，请缩小书库后重试");
          await zip.add(source.path, new BlobReader(blob), {
            level: 0,
            ...(signal ? { signal } : {}),
          });
          written.add(source.path);
        }
      } else if (["pdf", "epub", "docx", "cbz"].includes(book.source.format))
        throw new Error(`${book.title} 缺少源文件，无法创建完整备份`);
      books.push({ book: persistBook(book), ...(source === undefined ? {} : { source }) });
    }
    const manifest: ReaderBackup = {
      format: "bcr-reader-backup",
      version: 1,
      createdAt: Date.now(),
      books,
      progressByBook: state.progressByBook,
      bookmarksByBook: state.bookmarksByBook,
      annotationsByBook: state.annotationsByBook,
      settings: state.settings,
    };
    const raw = JSON.stringify(manifest);
    if (new Blob([raw]).size > 64 * 1024 * 1024)
      throw new Error("书库文字快照超过 64 MiB 上限，备份未生成");
    await zip.add(MANIFEST, new TextReader(raw), signal ? { signal } : {});
    check(signal);
    return await zip.close();
  } catch (reason) {
    await zip.close().catch(() => undefined);
    throw reason;
  }
}

export async function inspectReaderBackup(
  file: Blob,
  report: Report = () => {},
  signal?: AbortSignal,
): Promise<PreparedReaderBackup> {
  if (file.size > MAX_BYTES + 64 * 1024 * 1024)
    throw new Error("备份超过大小上限（512 MiB 源文件 + 64 MiB 清单）");
  const zip = new ZipReader(new BlobReader(file));
  try {
    const entries = await zip.getEntries();
    const files = entries.filter((entry) => !entry.directory);
    if (new Set(files.map((entry) => entry.filename)).size !== files.length)
      throw new Error("备份包含重复文件路径");
    const entry = files.find((item) => item.filename === MANIFEST);
    if (entry === undefined || entry.uncompressedSize > 64 * 1024 * 1024)
      throw new Error("备份清单缺失或过大");
    const manifest = decodeReaderBackup(
      JSON.parse(
        await entry.getData(new TextWriter(), {
          ...(signal ? { signal } : {}),
          checkSignature: true,
        }),
      ),
    );
    const sources = new Map<string, Blob>();
    let size = 0;
    for (const { book, source } of manifest.books) {
      check(signal);
      report(`正在校验 · ${book.title}`);
      if (source === undefined || sources.has(source.path)) continue;
      const data = files.find((item) => item.filename === source.path);
      size += source.size;
      if (data === undefined || data.uncompressedSize !== source.size || size > MAX_BYTES)
        throw new Error(`${book.title} 的源文件缺失或大小异常`);
      const blob = await data.getData(new BlobWriter(book.source.mime), {
        ...(signal ? { signal } : {}),
        checkSignature: true,
      });
      if (blob.size !== source.size || (await hashReadableStream(blob.stream())) !== source.hash)
        throw new Error(`${book.title} 的源文件校验失败`);
      sources.set(source.path, blob);
    }
    return { manifest, sources };
  } finally {
    await zip.close();
  }
}

export function backupNewBooks(
  backup: PreparedReaderBackup,
  library: ReadonlyArray<ReaderBook>,
): ReadonlyArray<BackupBook> {
  const ids = new Set(library.map((book) => book.id));
  const hashes = new Set(
    library.flatMap((book) => (book.source.ref ? [book.source.ref.hash] : [])),
  );
  return backup.manifest.books.filter(({ book, source }) => {
    if (ids.has(book.id) || (source !== undefined && hashes.has(source.hash))) return false;
    ids.add(book.id);
    if (source !== undefined) hashes.add(source.hash);
    return true;
  });
}

/** Stage every new publication before publishing a single library change. */
export async function prepareReaderRestore(
  runtime: ReaderRuntime,
  backup: PreparedReaderBackup,
  library: ReadonlyArray<ReaderBook>,
  report: Report = () => {},
  signal?: AbortSignal,
): Promise<ReaderBook[]> {
  const books: ReaderBook[] = [];
  try {
    for (const { book, source } of backupNewBooks(backup, library)) {
      check(signal);
      report(`正在恢复 · ${book.title}`);
      if (source === undefined) {
        books.push(book);
        continue;
      }
      const blob = backup.sources.get(source.path);
      if (blob === undefined) throw new Error(`${book.title} 的源文件不可用`);
      const ref: ArtifactRef = {
        id: `reader/${source.hash}`,
        type: "file/publication",
        hash: source.hash,
        storage: runtime.binary instanceof MemoryStore ? "memory" : "opfs",
        format: book.source.mime,
      };
      const binary = ["pdf", "epub", "docx", "cbz"].includes(book.source.format);
      const parsed = binary
        ? await parseReaderFile(
            runtime,
            new File([blob], book.source.name, { type: book.source.mime }),
            book.id,
            signal,
          )
        : book;
      const restored: ReaderBook = {
        ...parsed,
        title: book.title,
        author: book.author,
        language: book.language,
        tags: book.tags,
        importedAt: book.importedAt,
        updatedAt: book.updatedAt,
        source: {
          ...parsed.source,
          ref: {
            id: ref.id,
            hash: source.hash,
            size: blob.size,
            mime: book.source.mime,
            storage: ref.storage === "memory" ? "memory" : "opfs",
          },
        },
      };
      books.push(restored);
      await Effect.runPromise(runtime.artifacts.putStream(ref, blob.stream()));
    }
    check(signal);
    return books;
  } catch (reason) {
    for (const book of books) {
      for (const url of [
        book.source.objectUrl,
        book.coverUrl,
        ...book.sections.map((section) => section.imageUrl),
      ])
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    }
    throw reason;
  }
}
