import type { ArtifactRef } from "@bcr/core";
import {
  createDocumentContentPackage,
  createDocumentTranslationPackage,
  type DocumentContentPackage,
  type DocumentTranslationPackage,
} from "@bcr/document-core";
import type {
  MangaOcrAdapterId,
  MangaOcrArtifact,
  MangaPage,
  MangaSourceLanguage,
  MangaTranslationArtifact,
  TextRegion,
} from "./model";

export interface MangaDocumentProjectionOptions {
  readonly sourceName?: string | undefined;
  readonly sourceRef?: ArtifactRef | undefined;
  readonly sourceLanguage?: MangaSourceLanguage | undefined;
  readonly contentId?: string | undefined;
  readonly translationId?: string | undefined;
  /** Stable provenance timestamp when a projection is persisted as an artifact. */
  readonly createdAt?: number | undefined;
}

export interface MangaDocumentPackages {
  readonly content: DocumentContentPackage;
  readonly translation: DocumentTranslationPackage;
}

function slug(value: string): string {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return normalized.length === 0 ? "page" : normalized;
}

function directionFor(lines: ReadonlyArray<{ readonly writingMode: string }>): "ltr" | "ttb" {
  return lines.some((line) => line.writingMode === "vertical-rl") ? "ttb" : "ltr";
}

function ocrAdapter(value: MangaOcrAdapterId): string {
  return `manga.ocr.${value}`;
}

/** Convert a Manga OCR artifact into the canonical visual content contract. */
export function mangaOcrToDocumentContentPackage(
  ocr: MangaOcrArtifact,
  options: MangaDocumentProjectionOptions = {},
): DocumentContentPackage {
  const sourceName = options.sourceName?.trim() || ocr.sourceName;
  const sourceLanguage = options.sourceLanguage;
  return createDocumentContentPackage({
    id: options.contentId?.trim() || `manga-content-${slug(sourceName)}`,
    format: "image",
    sourceName,
    ...(options.sourceRef === undefined ? {} : { sourceRef: options.sourceRef }),
    metadata: {
      title: sourceName.replace(/\.[^.]+$/u, ""),
      ...(sourceLanguage === undefined ? {} : { language: sourceLanguage }),
      direction: directionFor(ocr.lines),
    },
    sourceHash: options.sourceRef?.hash,
    adapter: ocrAdapter(ocr.adapter),
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    blocks: ocr.lines.map((line) => ({
      id: line.id,
      kind: "paragraph" as const,
      label: line.label,
      text: line.text,
      geometry: {
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
        rotation: line.rotation,
      },
      writingMode: line.writingMode,
      confidence: line.confidence,
    })),
  });
}

/** Convert Manga translation lines while preserving the OCR block identities. */
export function mangaTranslationToDocumentTranslationPackage(
  content: DocumentContentPackage,
  translation: MangaTranslationArtifact,
  options: MangaDocumentProjectionOptions = {},
): DocumentTranslationPackage {
  const translatedById = new Map(translation.lines.map((line) => [line.id, line]));
  return createDocumentTranslationPackage({
    id:
      options.translationId?.trim() ||
      `manga-translation-${slug(content.sourceName)}-${translation.targetLanguage}`,
    sourceContentId: content.id,
    sourceName: content.sourceName,
    format: content.format,
    ...(options.sourceLanguage === undefined
      ? { sourceLanguage: translation.sourceLanguage }
      : { sourceLanguage: options.sourceLanguage }),
    targetLanguage: "zh-Hans",
    metadata: content.metadata,
    ...(content.sourceRef === undefined ? {} : { sourceRef: content.sourceRef }),
    adapter: `manga.translate.${translation.adapter}`,
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    blocks: content.blocks.map((block) => {
      const line = translatedById.get(block.id);
      return {
        ...block,
        translatedText: line?.translatedText ?? "",
        status: line === undefined ? ("skipped" as const) : ("needs-review" as const),
      };
    }),
  });
}

function reviewStatus(region: TextRegion): "translated" | "needs-review" {
  return region.status === "reviewed" && region.translatedText.trim().length > 0
    ? "translated"
    : "needs-review";
}

/** Rebuild editable Manga regions from a visual canonical package. */
export function documentContentToMangaRegions(
  content: DocumentContentPackage,
  translation?: DocumentTranslationPackage,
): ReadonlyArray<TextRegion> {
  if (content.format !== "image") {
    throw new Error("只有 image Content Package 可以重放为 Manga 页面");
  }
  const translatedById = new Map(translation?.blocks.map((block) => [block.id, block]) ?? []);
  return content.blocks.flatMap((block) => {
    const sourceText = block.text.trim();
    const translatedBlock = translatedById.get(block.id);
    const translatedText = translatedBlock?.translatedText.trim() ?? "";
    if (sourceText.length === 0 && translatedText.length === 0) return [];
    const geometry = block.geometry;
    if (geometry === undefined) {
      throw new Error(`视觉 Content Package 的 block「${block.id}」缺少 geometry`);
    }
    return [
      {
        id: block.id,
        label: block.label,
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
        rotation: geometry.rotation ?? 0,
        writingMode: block.writingMode ?? "horizontal-tb",
        sourceText,
        translatedText,
        confidence: block.confidence ?? 0,
        status:
          translatedBlock?.status === "translated" && translatedText.length > 0
            ? ("reviewed" as const)
            : ("needs-review" as const),
      },
    ];
  });
}

/** Build a canonical content package from the current manual/visual regions. */
export function mangaRegionsToDocumentContentPackage(
  sourceName: string,
  regions: ReadonlyArray<TextRegion>,
  options: MangaDocumentProjectionOptions = {},
): DocumentContentPackage {
  return createDocumentContentPackage({
    id: options.contentId?.trim() || `manga-content-${slug(sourceName)}`,
    format: "image",
    sourceName,
    ...(options.sourceRef === undefined ? {} : { sourceRef: options.sourceRef }),
    metadata: {
      title: sourceName.replace(/\.[^.]+$/u, ""),
      ...(options.sourceLanguage === undefined ? {} : { language: options.sourceLanguage }),
      direction: directionFor(regions),
    },
    sourceHash: options.sourceRef?.hash,
    adapter: "manga.review.regions",
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    blocks: regions.map((region) => ({
      id: region.id,
      kind: "paragraph" as const,
      label: region.label,
      text: region.sourceText,
      geometry: {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        rotation: region.rotation,
      },
      writingMode: region.writingMode,
      confidence: region.confidence,
    })),
  });
}

/** Project the currently reviewed regions into a translation package. */
export function mangaRegionsToDocumentTranslationPackage(
  content: DocumentContentPackage,
  regions: ReadonlyArray<TextRegion>,
  options: MangaDocumentProjectionOptions = {},
): DocumentTranslationPackage {
  const regionsById = new Map(regions.map((region) => [region.id, region]));
  return createDocumentTranslationPackage({
    id: options.translationId?.trim() || `manga-translation-${slug(content.sourceName)}-zh`,
    sourceContentId: content.id,
    sourceName: content.sourceName,
    format: content.format,
    ...(options.sourceLanguage === undefined ? {} : { sourceLanguage: options.sourceLanguage }),
    targetLanguage: "zh-Hans",
    metadata: content.metadata,
    ...(content.sourceRef === undefined ? {} : { sourceRef: content.sourceRef }),
    adapter: "manga.review.translation",
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    blocks: content.blocks.map((block) => {
      const region = regionsById.get(block.id);
      return {
        ...block,
        translatedText: region?.translatedText ?? "",
        status: region === undefined ? ("skipped" as const) : reviewStatus(region),
      };
    }),
  });
}

/** Convenience projection used by shared search and future handoff surfaces. */
export function mangaPageToDocumentPackages(
  page: Pick<MangaPage, "id" | "source" | "regions">,
  sourceLanguage?: MangaSourceLanguage,
  projection: Pick<MangaDocumentProjectionOptions, "createdAt"> = {},
): MangaDocumentPackages {
  const options: MangaDocumentProjectionOptions = {
    sourceRef: page.source.ref,
    sourceLanguage,
    contentId: `${page.id}:content`,
    translationId: `${page.id}:translation`,
    ...(projection.createdAt === undefined ? {} : { createdAt: projection.createdAt }),
  };
  const content = mangaRegionsToDocumentContentPackage(page.source.name, page.regions, options);
  return {
    content,
    translation: mangaRegionsToDocumentTranslationPackage(content, page.regions, options),
  };
}
