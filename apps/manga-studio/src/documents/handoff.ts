import { contentHash, type ArtifactRef, type ArtifactStore } from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Effect } from "effect";
import type {
  DocumentContentPackage,
  DocumentHandoff,
  DocumentTranslationPackage,
} from "@bcr/document-core";
import {
  decodeDocumentContentPackage,
  decodeDocumentExportBundle,
  decodeDocumentTranslationPackage,
} from "@bcr/document-core";
import { documentContentToMangaRegions, mangaPageToDocumentPackages } from "./document-adapter";
import { manga } from "../project/store";
import type { MangaPage, MangaSettings, TextRegion } from "../project/model";
import { type MangaStorageContext } from "../project/context";

export interface MangaDocumentArtifactRefs {
  readonly content: ArtifactRef;
  readonly translation: ArtifactRef;
}

export interface MangaDocumentHandoffPayload {
  readonly file: File;
  readonly sourceRef: ArtifactRef;
  readonly content: DocumentContentPackage;
  readonly translation: DocumentTranslationPackage;
  readonly contentRef: ArtifactRef;
  readonly translationRef: ArtifactRef;
}

export interface MangaExportReplayPayload {
  readonly file: File;
  readonly content: DocumentContentPackage;
  readonly translation?: DocumentTranslationPackage | undefined;
  readonly regions: ReadonlyArray<TextRegion>;
}

function mimeForDocumentFormat(format: DocumentHandoff["format"]): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "cbz":
      return "application/zip";
    case "image":
      return "image/*";
    default:
      return "application/octet-stream";
  }
}

/** Resolve a Document handoff from the host ArtifactStore after a refresh. */
export async function fileFromDocumentHandoff(
  runtime: MangaStorageContext,
  handoff: DocumentHandoff,
  upstreamArtifacts?: ArtifactStore,
): Promise<File> {
  if (handoff.file !== undefined) return handoff.file;
  if (handoff.sourceRef === undefined) {
    throw new Error("Document handoff 缺少可恢复的 source Artifact");
  }
  const artifacts = upstreamArtifacts ?? runtime.artifacts;
  const blob = await Effect.runPromise(artifacts.getBlob(handoff.sourceRef));
  return new File([blob], handoff.name, {
    type: handoff.sourceRef.format ?? mimeForDocumentFormat(handoff.format),
  });
}

/** Resolve optional visual content from a Document handoff for region replay. */
export async function regionsFromDocumentHandoff(
  runtime: MangaStorageContext,
  handoff: DocumentHandoff,
  upstreamArtifacts?: ArtifactStore,
): Promise<ReadonlyArray<TextRegion>> {
  const artifacts = upstreamArtifacts ?? runtime.artifacts;
  const content =
    handoff.content ??
    (handoff.contentRef === undefined
      ? undefined
      : decodeDocumentContentPackage(
          JSON.parse(
            new TextDecoder().decode(await Effect.runPromise(artifacts.get(handoff.contentRef))),
          ),
        ));
  if (content === undefined || content.format !== "image") return [];
  const translation =
    handoff.translation ??
    (handoff.translationRef === undefined
      ? undefined
      : decodeDocumentTranslationPackage(
          JSON.parse(
            new TextDecoder().decode(
              await Effect.runPromise(artifacts.get(handoff.translationRef)),
            ),
          ),
        ));
  return documentContentToMangaRegions(content, translation);
}

/** Rehydrate a visual Export Bundle by resolving its immutable source image. */
export async function importMangaExportBundle(
  runtime: MangaStorageContext,
  file: File,
  upstreamArtifacts?: ArtifactStore,
): Promise<MangaExportReplayPayload> {
  let value: unknown;
  try {
    value = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`${file.name} 不是有效的 Document Export Bundle`);
  }
  const bundle = decodeDocumentExportBundle(value);
  if (bundle === undefined) throw new Error(`${file.name} 的 Export Bundle 契约校验失败`);
  if (bundle.content.format !== "image") {
    throw new Error("文本 Export Bundle 请交给 Reader Studio；Manga 只接收视觉内容");
  }
  const sourceRef = bundle.content.sourceRef;
  if (sourceRef === undefined) {
    throw new Error("视觉 Export Bundle 缺少 source Artifact，无法恢复原始页面");
  }
  const artifacts = upstreamArtifacts ?? runtime.artifacts;
  let blob: Blob;
  try {
    blob = await Effect.runPromise(artifacts.getBlob(sourceRef));
  } catch {
    throw new Error(`视觉 Export Bundle 的 source Artifact 不可用：${sourceRef.id}`);
  }
  const imageFile = new File([blob], bundle.content.sourceName, {
    type: sourceRef.format ?? "image/png",
  });
  return {
    file: imageFile,
    content: bundle.content,
    ...(bundle.translation === undefined ? {} : { translation: bundle.translation }),
    regions: documentContentToMangaRegions(bundle.content, bundle.translation),
  };
}

function documentArtifactRef(
  runtime: MangaStorageContext,
  kind: "content" | "translation",
  bytes: Uint8Array,
): ArtifactRef {
  const hash = contentHash(bytes);
  const storage: ArtifactRef["storage"] = runtime.binary instanceof MemoryStore ? "memory" : "opfs";
  return {
    id: `document/manga/${kind}/${hash}`,
    type: kind === "content" ? "document/content-package" : "document/translation-package",
    storage,
    format: "json",
    hash,
  };
}

async function putDocumentArtifact(
  runtime: MangaStorageContext,
  sharedArtifacts: ArtifactStore | undefined,
  ref: ArtifactRef,
  bytes: Uint8Array,
): Promise<void> {
  await Effect.runPromise(runtime.artifacts.put(ref, bytes));
  if (sharedArtifacts === undefined || sharedArtifacts === runtime.artifacts) return;
  try {
    await Effect.runPromise(sharedArtifacts.put(ref, bytes));
  } catch (error) {
    manga.log("warn", `document bridge · host mirror unavailable · ${String(error)}`);
  }
}

/** Persist the current page as canonical Document packages in both storage planes. */
export async function persistMangaDocumentPackages(
  runtime: MangaStorageContext,
  page: MangaPage,
  sourceLanguage: MangaSettings["sourceLanguage"],
  sharedArtifacts?: ArtifactStore,
): Promise<MangaDocumentArtifactRefs> {
  const packages = mangaPageToDocumentPackages(page, sourceLanguage, {
    createdAt: page.createdAt ?? 0,
  });
  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(JSON.stringify(packages.content));
  const translationBytes = encoder.encode(JSON.stringify(packages.translation));
  const content = documentArtifactRef(runtime, "content", contentBytes);
  const translation = documentArtifactRef(runtime, "translation", translationBytes);
  await putDocumentArtifact(runtime, sharedArtifacts, content, contentBytes);
  await putDocumentArtifact(runtime, sharedArtifacts, translation, translationBytes);
  return { content, translation };
}

/** Materialize the active page and canonical OCR/translation packages for Document Studio. */
export async function prepareMangaDocumentHandoff(
  runtime: MangaStorageContext,
  hostArtifacts: ArtifactStore,
  page: MangaPage,
  sourceLanguage: MangaSettings["sourceLanguage"],
): Promise<MangaDocumentHandoffPayload> {
  const sourceRef = page.source.ref;
  if (sourceRef === undefined) {
    throw new Error("示例页面没有可交接的源 Artifact，请先导入原始图片");
  }
  const blob = await Effect.runPromise(runtime.artifacts.getBlob(sourceRef));
  const file = new File([blob], page.source.name, {
    type: sourceRef.format ?? "image/*",
  });
  await Effect.runPromise(hostArtifacts.putStream(sourceRef, blob.stream()));
  const packages = mangaPageToDocumentPackages(page, sourceLanguage, {
    createdAt: page.createdAt ?? 0,
  });
  const refs = await persistMangaDocumentPackages(runtime, page, sourceLanguage, hostArtifacts);
  return {
    file,
    sourceRef,
    content: packages.content,
    translation: packages.translation,
    contentRef: refs.content,
    translationRef: refs.translation,
  };
}
