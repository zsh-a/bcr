import { storeStructuredContent } from "./structuredContent";
import { openLazyTxt, LAZY_TXT_MIN_BYTES } from "./lazyTxt";
import { materializeReaderContent } from "./readerContent";
import { contentHash, hashReadableStream, type ArtifactRef, type ArtifactStore } from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Effect } from "effect";
import type { ReaderBook } from "@bcr/reader-core";
import {
  decodeDocumentContentPackage,
  decodeDocumentExportBundle,
  decodeDocumentTranslationPackage,
  type DocumentContentPackage,
  type DocumentHandoff,
  type DocumentTranslationPackage,
} from "@bcr/document-core";
import { formatForFile, openReaderContentPackage, openReaderFile } from "./adapters";
import { readerBookToDocumentContent } from "./document-adapter";
import { createReaderParseSession, ReaderParseWorkerError } from "./parse-session";
import type { ReaderRuntime } from "./readerRuntimeCore";

export async function parseReaderFile(
  runtime: ReaderRuntime,
  file: File,
  id: string,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  return storeStructuredContent(
    runtime,
    await parseReaderSource(runtime, file, id, signal),
    signal,
  );
}

async function parseReaderSource(
  runtime: ReaderRuntime,
  file: File,
  id: string,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  const format = formatForFile(file);
  if (format === "txt" && file.size >= LAZY_TXT_MIN_BYTES) {
    return openLazyTxt({ file, id, format, ...(signal ? { signal } : {}) });
  }
  // Resource providers own live archive/PDF handles and cannot cross structured clone.
  if (format === "pdf" || format === "epub" || format === "cbz") {
    return openReaderFile(file, id, signal);
  }
  runtime.parseSession ??= createReaderParseSession();
  runtime.parserMode = runtime.parseSession === undefined ? "main" : "worker";
  if (runtime.parseSession === undefined) return openReaderFile(file, id, signal);
  try {
    return await runtime.parseSession.open(file, id, signal);
  } catch (reason) {
    if (signal?.aborted) throw reason;
    if (reason instanceof ReaderParseWorkerError) return openReaderFile(file, id, signal);
    throw reason;
  }
}

export async function importReaderFile(
  runtime: ReaderRuntime,
  file: File,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const hash = await hashReadableStream(file.stream());
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const format = formatForFile(file);
  const storage: ArtifactRef["storage"] = runtime.binary instanceof MemoryStore ? "memory" : "opfs";
  const ref: ArtifactRef = {
    id: `reader/${hash}`,
    type: "file/publication",
    storage,
    format: file.type || format,
    hash,
  };
  await Effect.runPromise(runtime.artifacts.putStream(ref, file.stream()));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const book = await parseReaderFile(runtime, file, `book-${hash.slice(0, 16)}`, signal);
  return {
    ...book,
    source: {
      ...book.source,
      ref: {
        id: ref.id,
        hash,
        storage: storage === "memory" ? "memory" : "opfs",
        mime: file.type || book.source.mime,
        size: file.size,
      },
    },
  };
}

/** Import a Document Studio handoff without parsing the publication twice. */
export async function importReaderContentPackage(
  runtime: ReaderRuntime,
  file: File,
  content: DocumentContentPackage,
  translation?: DocumentTranslationPackage,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const hash = await hashReadableStream(file.stream());
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const storage: ArtifactRef["storage"] = runtime.binary instanceof MemoryStore ? "memory" : "opfs";
  const ref: ArtifactRef = {
    id: `reader/${hash}`,
    type: "file/publication",
    storage,
    format: file.type || content.format,
    hash,
  };
  await Effect.runPromise(runtime.artifacts.putStream(ref, file.stream()));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const book = openReaderContentPackage(file, `book-${hash.slice(0, 16)}`, content, translation);
  return {
    ...book,
    source: {
      ...book.source,
      ref: {
        id: ref.id,
        hash,
        storage: storage === "memory" ? "memory" : "opfs",
        mime: file.type || book.source.mime,
        size: file.size,
      },
    },
  };
}

/** Import a canonical JSON export without invoking a format-specific parser. */
export async function importReaderExportBundle(
  runtime: ReaderRuntime,
  file: File,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  let value: unknown;
  try {
    value = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`${file.name} 不是有效的 Document Export Bundle`);
  }
  const bundle = decodeDocumentExportBundle(value);
  if (bundle === undefined) throw new Error(`${file.name} 的 Export Bundle 契约校验失败`);
  if (bundle.content.format === "image") {
    throw new Error("视觉 Export Bundle 请交给 Manga Studio；Reader 只接收文本出版物");
  }
  return importReaderContentPackage(runtime, file, bundle.content, bundle.translation, signal);
}

function mimeForDocumentFormat(format: DocumentHandoff["format"]): string {
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
    case "image":
      return "image/*";
    default:
      return "text/plain";
  }
}

async function fileFromHandoffArtifact(
  artifacts: ArtifactStore,
  handoff: DocumentHandoff,
): Promise<File> {
  if (handoff.sourceRef === undefined) {
    throw new Error("Document handoff 缺少可恢复的 source Artifact");
  }
  const blob = await Effect.runPromise(artifacts.getBlob(handoff.sourceRef));
  return new File([blob], handoff.name, {
    type: handoff.sourceRef.format ?? mimeForDocumentFormat(handoff.format),
  });
}

async function packageFromArtifact<T>(
  artifacts: ArtifactStore,
  ref: ArtifactRef,
  decode: (value: unknown) => T | undefined,
): Promise<T> {
  const bytes = await Effect.runPromise(artifacts.get(ref));
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error(`Document handoff Artifact ${ref.id} 不是有效 JSON`);
  }
  const decoded = decode(value);
  if (decoded === undefined) throw new Error(`Document handoff Artifact ${ref.id} 契约校验失败`);
  return decoded;
}

/**
 * Import a Document handoff from either its tab-local fast path or durable
 * Artifact refs. Upstream artifacts can be supplied by the Studio host when
 * the target app owns a separate OPFS namespace.
 */
export async function importReaderDocumentHandoff(
  runtime: ReaderRuntime,
  handoff: DocumentHandoff,
  upstreamArtifacts?: ArtifactStore,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const artifacts = upstreamArtifacts ?? runtime.artifacts;
  const file = handoff.file ?? (await fileFromHandoffArtifact(artifacts, handoff));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const content =
    handoff.content ??
    (handoff.contentRef === undefined
      ? undefined
      : await packageFromArtifact(artifacts, handoff.contentRef, decodeDocumentContentPackage));
  const translation =
    handoff.translation ??
    (handoff.translationRef === undefined
      ? undefined
      : await packageFromArtifact(
          artifacts,
          handoff.translationRef,
          decodeDocumentTranslationPackage,
        ));
  if (content === undefined) return importReaderFile(runtime, file, signal);
  return importReaderContentPackage(runtime, file, content, translation, signal);
}

export interface ReaderDocumentHandoffPayload {
  readonly file: File;
  readonly sourceRef: ArtifactRef;
  readonly content: DocumentContentPackage;
  readonly contentRef: ArtifactRef;
}

function sourceExtension(name: string): string {
  return name.split(".").pop()?.toLocaleLowerCase() || "bin";
}

/**
 * Materialize a Reader publication in the host Document namespace and write
 * its canonical projection. Both refs are content-addressed, so a refresh or
 * a separate target tab can rebuild the handoff without a File handle.
 */
export async function prepareReaderDocumentHandoff(
  runtime: ReaderRuntime,
  hostArtifacts: ArtifactStore,
  book: ReaderBook,
): Promise<ReaderDocumentHandoffPayload> {
  const source = book.source.ref;
  if (source === undefined) {
    throw new Error("示例读物没有可交接的源 Artifact，请先导入原始文件");
  }
  const sourceArtifact: ArtifactRef = {
    id: source.id,
    type: "file/publication",
    storage: source.storage,
    format: source.mime,
    hash: source.hash,
  };
  const blob = await Effect.runPromise(runtime.artifacts.getBlob(sourceArtifact));
  const file = new File([blob], book.source.name, { type: book.source.mime });
  const sourceRef: ArtifactRef = {
    id: `document/source/${source.hash}`,
    type: `file/${sourceExtension(book.source.name)}`,
    storage: "opfs",
    format: book.source.mime || undefined,
    hash: source.hash,
  };
  await Effect.runPromise(hostArtifacts.putStream(sourceRef, blob.stream()));

  const content = readerBookToDocumentContent(await materializeReaderContent(book), sourceRef);
  const bytes = new TextEncoder().encode(JSON.stringify(content));
  const hash = contentHash(bytes);
  const contentRef: ArtifactRef = {
    id: `document/content/reader/${hash}`,
    type: "document/content-package",
    storage: "opfs",
    format: "json",
    hash,
  };
  await Effect.runPromise(hostArtifacts.put(contentRef, bytes));
  return { file, sourceRef, content, contentRef };
}
