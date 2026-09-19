import { contentHash, hashReadableStream, type ArtifactRef } from "@bcr/core";
import {
  createDocumentJob,
  decodeDocumentContentPackage,
  decodeDocumentExportBundle,
  decodeDocumentTranslationPackage,
  documentContentText,
  markReadyStages,
  updateStage,
  type DocumentContentPackage,
  type DocumentFormat,
  type DocumentHandoff,
  type DocumentJob,
  type DocumentTranslationPackage,
} from "@bcr/document-core";
import type { RuntimeServices } from "@bcr/react";
import { Effect } from "effect";

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLocaleLowerCase() || "bin";
}

/** Store a source in the shared runtime namespace so Worker tasks can consume it. */
export async function importDocumentFile(
  services: RuntimeServices,
  file: File,
): Promise<ArtifactRef> {
  const hash = await hashReadableStream(file.stream());
  const ref: ArtifactRef = {
    id: `document/source/${hash}`,
    type: `file/${extensionOf(file)}`,
    storage: "opfs",
    format: file.type || undefined,
    hash,
  };
  await Effect.runPromise(services.artifacts.putStream(ref, file.stream()));
  return ref;
}

function mimeForDocumentFormat(format: DocumentFormat): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "epub":
      return "application/epub+zip";
    case "cbz":
      return "application/vnd.comicbook+zip";
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

async function packageFromArtifact<T>(
  services: RuntimeServices,
  ref: ArtifactRef,
  decode: (value: unknown) => T | undefined,
): Promise<T> {
  const bytes = await Effect.runPromise(services.artifacts.get(ref));
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

async function writeContentPackage(
  services: RuntimeServices,
  content: DocumentContentPackage,
  prefix: string,
): Promise<ArtifactRef> {
  const bytes = new TextEncoder().encode(JSON.stringify(content));
  const hash = contentHash(bytes);
  const ref: ArtifactRef = {
    id: `document/content/${prefix}/${hash}`,
    type: "document/content-package",
    storage: "opfs",
    format: "json",
    hash,
  };
  await Effect.runPromise(services.artifacts.put(ref, bytes));
  return ref;
}

async function writeTranslationPackage(
  services: RuntimeServices,
  translation: DocumentTranslationPackage,
  prefix: string,
): Promise<ArtifactRef> {
  const bytes = new TextEncoder().encode(JSON.stringify(translation));
  const hash = contentHash(bytes);
  const ref: ArtifactRef = {
    id: `document/translation/${prefix}/${hash}`,
    type: "document/translation-package",
    storage: "opfs",
    format: "json",
    hash,
  };
  await Effect.runPromise(services.artifacts.put(ref, bytes));
  return ref;
}

/** Only visual OCR provenance may complete the planned image OCR stage. */
function isVisualOcrContent(content: DocumentContentPackage): boolean {
  if (content.format !== "image") return false;
  const adapter = content.provenance.adapter;
  return (
    adapter.startsWith("manga.ocr.") ||
    adapter === "manga.review.regions" ||
    adapter.startsWith("document.ocr.")
  );
}

/** Rebuild a durable Document job from a Reader/Manga handoff. */
export async function importDocumentHandoff(
  services: RuntimeServices,
  handoff: DocumentHandoff,
): Promise<{ readonly job: DocumentJob; readonly file: File }> {
  const file =
    handoff.file ??
    (handoff.sourceRef === undefined
      ? undefined
      : new File(
          [await Effect.runPromise(services.artifacts.getBlob(handoff.sourceRef))],
          handoff.name,
          { type: handoff.sourceRef.format ?? mimeForDocumentFormat(handoff.format) },
        ));
  if (file === undefined) {
    throw new Error("Document handoff 缺少可恢复的 source Artifact，请回到来源工作台重新交接");
  }
  const sourceRef = await importDocumentFile(services, file);
  const content =
    handoff.content ??
    (handoff.contentRef === undefined
      ? undefined
      : await packageFromArtifact(services, handoff.contentRef, decodeDocumentContentPackage));
  const translation =
    handoff.translation ??
    (handoff.translationRef === undefined
      ? undefined
      : await packageFromArtifact(
          services,
          handoff.translationRef,
          decodeDocumentTranslationPackage,
        ));
  const contentRef =
    content === undefined
      ? undefined
      : (handoff.contentRef ?? (await writeContentPackage(services, content, "handoff")));
  const translationRef =
    translation === undefined
      ? undefined
      : (handoff.translationRef ??
        (await writeTranslationPackage(services, translation, "handoff")));
  let job = markReadyStages(
    createDocumentJob({
      id: `document-handoff-${handoff.id}`,
      name: handoff.name,
      format: handoff.format,
      size: handoff.size || file.size,
      sourceRef,
      sourceTextPreview:
        content === undefined
          ? undefined
          : documentContentText(content).replace(/\s+/gu, " ").trim().slice(0, 240),
    }),
  );
  const completedAt = Date.now();
  if (contentRef !== undefined) {
    job = updateStage(job, "extract", {
      status: "done",
      progress: 1,
      completedAt,
      artifact: contentRef,
      adapter: content?.provenance.adapter ?? "handoff.content",
    });
    if (content !== undefined && isVisualOcrContent(content)) {
      job = updateStage(job, "ocr", {
        status: "done",
        progress: 1,
        completedAt,
        artifact: contentRef,
        adapter: content.provenance.adapter,
        capability: "adapter",
        execution: {
          runtime: "wasm",
          operation: content.provenance.adapter,
          cache: "disabled",
        },
      });
    } else if (content !== undefined && job.format === "image") {
      job = updateStage(job, "ocr", {
        status: "blocked",
        progress: 0,
        capability: "planned",
        detail: "该图片内容包没有视觉 OCR provenance，请交给 Manga 或重新运行 OCR",
      });
    }
  }
  if (translationRef !== undefined) {
    job = updateStage(job, "translate", {
      status: "done",
      progress: 1,
      completedAt,
      artifact: translationRef,
      adapter: translation?.provenance.adapter ?? "handoff.translation",
    });
  }
  return { job, file };
}

/** Rehydrate a Document job from its lossless JSON Export Bundle. */
export async function importDocumentExportBundle(
  services: RuntimeServices,
  file: File,
): Promise<{ readonly job: DocumentJob; readonly file: File }> {
  let value: unknown;
  try {
    value = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`${file.name} 不是有效的 Document Export Bundle`);
  }
  const bundle = decodeDocumentExportBundle(value);
  if (bundle === undefined) throw new Error(`${file.name} 的 Export Bundle 契约校验失败`);
  const sourceRef = bundle.content.sourceRef;
  if (sourceRef === undefined) {
    throw new Error("Document Export Bundle 缺少 source Artifact，无法恢复源文件");
  }
  let sourceBlob: Blob;
  try {
    sourceBlob = await Effect.runPromise(services.artifacts.getBlob(sourceRef));
  } catch {
    throw new Error(`Document Export Bundle 的 source Artifact 不可用：${sourceRef.id}`);
  }
  // Materialize OPFS-backed data before refreshing the same content-addressed source path.
  const sourceBytes = await sourceBlob.arrayBuffer();
  const sourceFile = new File([sourceBytes], bundle.content.sourceName, {
    type: sourceRef.format ?? mimeForDocumentFormat(bundle.content.format),
  });
  const imported = await importDocumentHandoff(services, {
    id: `document-export-${contentHash(new TextEncoder().encode(file.name)).slice(0, 16)}`,
    jobId: bundle.content.id,
    target: "document",
    name: bundle.content.sourceName,
    format: bundle.content.format,
    size: sourceFile.size,
    file: sourceFile,
    sourceRef,
    content: bundle.content,
    ...(bundle.translation === undefined ? {} : { translation: bundle.translation }),
    createdAt: Date.now(),
  });
  return { job: imported.job, file: imported.file };
}
