import type { ArtifactRef } from "@bcr/core";
import {
  createDocumentContentPackage,
  type DocumentBlock,
  type DocumentContentMetadata,
} from "./content";
import type { DocumentFormat } from "./model";

export type DocumentTranslationStatus = "translated" | "needs-review" | "skipped" | "error";

/** A translated view of a source block; the source block identity never changes. */
export interface DocumentTranslationBlock extends DocumentBlock {
  readonly translatedText: string;
  readonly status: DocumentTranslationStatus;
  readonly confidence?: number | undefined;
}

export interface DocumentTranslationProvenance {
  readonly adapter: string;
  readonly createdAt: number;
  readonly sourceHash?: string | undefined;
  readonly parentArtifact?: ArtifactRef | undefined;
}

/** Versioned translation payload consumed by review and typeset adapters. */
export interface DocumentTranslationPackage {
  readonly version: 1;
  readonly id: string;
  readonly sourceContentId: string;
  readonly sourceName: string;
  readonly format: DocumentFormat;
  readonly sourceLanguage?: string | undefined;
  readonly targetLanguage: string;
  readonly metadata: DocumentContentMetadata;
  readonly blocks: ReadonlyArray<DocumentTranslationBlock>;
  readonly sourceRef?: ArtifactRef | undefined;
  readonly provenance: DocumentTranslationProvenance;
}

export interface DocumentTranslationPackageInput {
  readonly id: string;
  readonly sourceContentId: string;
  readonly sourceName: string;
  readonly format: DocumentFormat;
  readonly sourceLanguage?: string | undefined;
  readonly targetLanguage: string;
  readonly metadata?: DocumentContentMetadata | undefined;
  readonly sourceRef?: ArtifactRef | undefined;
  readonly blocks: ReadonlyArray<
    Partial<DocumentTranslationBlock> & {
      readonly text: string;
      readonly translatedText: string;
    }
  >;
  readonly adapter: string;
  readonly createdAt?: number | undefined;
}

export interface DocumentTranslationStats {
  readonly blockCount: number;
  readonly translatedCount: number;
  readonly reviewCount: number;
  readonly sourceCharacterCount: number;
  readonly translatedCharacterCount: number;
}

const STATUSES: ReadonlySet<DocumentTranslationStatus> = new Set([
  "translated",
  "needs-review",
  "skipped",
  "error",
]);

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/gu, "\n").trim() : "";
}

function cleanOptional(value: unknown): string | undefined {
  const result = cleanText(value);
  return result.length === 0 ? undefined : result;
}

function stableId(value: string, fallback: string): string {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return normalized.length === 0 ? fallback : normalized;
}

function translationStatus(value: unknown, translatedText: string): DocumentTranslationStatus {
  const status = STATUSES.has(value as DocumentTranslationStatus)
    ? (value as DocumentTranslationStatus)
    : "needs-review";
  return status === "translated" && translatedText.length === 0 ? "needs-review" : status;
}

function confidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

function normalizedBlocks(input: DocumentTranslationPackageInput): {
  readonly metadata: DocumentContentMetadata;
  readonly blocks: ReadonlyArray<DocumentTranslationBlock>;
} {
  const source = createDocumentContentPackage({
    id: input.sourceContentId,
    format: input.format,
    sourceName: input.sourceName,
    metadata: input.metadata,
    sourceRef: input.sourceRef,
    sourceHash: input.sourceRef?.hash,
    adapter: input.adapter,
    blocks: input.blocks,
    createdAt: input.createdAt,
  });
  return {
    metadata: source.metadata,
    blocks: source.blocks.map((block, index) => {
      const candidate = input.blocks[index];
      const translatedText = cleanText(candidate?.translatedText);
      const score = confidence(candidate?.confidence);
      return {
        ...block,
        translatedText,
        status: translationStatus(candidate?.status, translatedText),
        ...(score === undefined ? {} : { confidence: score }),
      };
    }),
  };
}

export function createDocumentTranslationPackage(
  input: DocumentTranslationPackageInput,
): DocumentTranslationPackage {
  const sourceContentId = cleanOptional(input.sourceContentId) ?? "document-content";
  const sourceName = cleanOptional(input.sourceName) ?? "未命名文档";
  const targetLanguage = cleanOptional(input.targetLanguage) ?? "zh-Hans";
  const sourceLanguage = cleanOptional(input.sourceLanguage);
  const normalized = normalizedBlocks(input);
  const createdAt =
    typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
      ? input.createdAt
      : Date.now();
  const sourceHash = cleanOptional(input.sourceRef?.hash);
  return {
    version: 1,
    id: cleanOptional(input.id) ?? `translation-${stableId(sourceContentId, targetLanguage)}`,
    sourceContentId,
    sourceName,
    format: input.format,
    ...(sourceLanguage === undefined ? {} : { sourceLanguage }),
    targetLanguage,
    metadata: normalized.metadata,
    blocks: normalized.blocks,
    ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }),
    provenance: {
      adapter: cleanOptional(input.adapter) ?? "unknown",
      createdAt,
      ...(sourceHash === undefined ? {} : { sourceHash }),
      ...(input.sourceRef === undefined ? {} : { parentArtifact: input.sourceRef }),
    },
  };
}

function isDocumentFormat(value: unknown): value is DocumentFormat {
  return (
    value === "txt" ||
    value === "markdown" ||
    value === "html" ||
    value === "docx" ||
    value === "fb2" ||
    value === "epub" ||
    value === "pdf" ||
    value === "cbz" ||
    value === "image" ||
    value === "unknown"
  );
}

function isArtifactRef(value: unknown): value is ArtifactRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ArtifactRef>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.type === "string" &&
    (candidate.storage === "memory" ||
      candidate.storage === "shared-memory" ||
      candidate.storage === "opfs")
  );
}

function decodeBlock(
  value: unknown,
):
  | (Partial<DocumentTranslationBlock> & { readonly text: string; readonly translatedText: string })
  | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<DocumentTranslationBlock>;
  if (typeof candidate.text !== "string" || typeof candidate.translatedText !== "string") {
    return undefined;
  }
  return { ...candidate, text: candidate.text, translatedText: candidate.translatedText };
}

/** Validate canonical payloads and migrate the pre-contract `sections` shape. */
export function decodeDocumentTranslationPackage(
  value: unknown,
): DocumentTranslationPackage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<DocumentTranslationPackage> & {
    readonly sections?: unknown;
    readonly adapter?: unknown;
  };
  if (candidate.version !== 1) return undefined;
  const legacySections = Array.isArray(candidate.sections) && !Array.isArray(candidate.blocks);
  const sourceName = cleanOptional(candidate.sourceName);
  if (sourceName === undefined) return undefined;
  const format = isDocumentFormat(candidate.format)
    ? candidate.format
    : legacySections
      ? "unknown"
      : undefined;
  const sourceContentId =
    cleanOptional(candidate.sourceContentId) ??
    (legacySections ? `document-content-legacy-${stableId(sourceName, "source")}` : undefined);
  const targetLanguage =
    cleanOptional(candidate.targetLanguage) ?? (legacySections ? "zh-Hans" : undefined);
  if (format === undefined || sourceContentId === undefined || targetLanguage === undefined) {
    return undefined;
  }
  const rawBlocks = Array.isArray(candidate.blocks)
    ? candidate.blocks
    : Array.isArray(candidate.sections)
      ? candidate.sections
      : undefined;
  if (rawBlocks === undefined) return undefined;
  const blocks = rawBlocks.map(decodeBlock);
  if (blocks.some((block) => block === undefined)) return undefined;
  const rawProvenance = candidate.provenance;
  const provenance =
    typeof rawProvenance === "object" && rawProvenance !== null
      ? (rawProvenance as Partial<DocumentTranslationProvenance>)
      : undefined;
  const adapter =
    cleanOptional(provenance?.adapter) ?? cleanOptional(candidate.adapter) ?? "legacy.translate";
  const createdAt =
    typeof provenance?.createdAt === "number" && Number.isFinite(provenance.createdAt)
      ? provenance.createdAt
      : undefined;
  const sourceRef = isArtifactRef(candidate.sourceRef) ? candidate.sourceRef : undefined;
  return createDocumentTranslationPackage({
    id: cleanOptional(candidate.id) ?? `translation-legacy-${stableId(sourceName, "source")}`,
    sourceContentId,
    sourceName,
    format,
    ...(typeof candidate.sourceLanguage === "string"
      ? { sourceLanguage: candidate.sourceLanguage }
      : {}),
    targetLanguage,
    metadata: candidate.metadata,
    ...(sourceRef === undefined ? {} : { sourceRef }),
    blocks: blocks.filter(
      (
        block,
      ): block is Partial<DocumentTranslationBlock> & {
        readonly text: string;
        readonly translatedText: string;
      } => block !== undefined,
    ),
    adapter,
    ...(createdAt === undefined ? {} : { createdAt }),
  });
}

export function documentTranslationStats(
  translation: DocumentTranslationPackage,
): DocumentTranslationStats {
  const translated = translation.blocks.filter(
    (block) => block.status === "translated" && block.translatedText.length > 0,
  );
  const review = translation.blocks.filter((block) => block.status === "needs-review");
  return {
    blockCount: translation.blocks.length,
    translatedCount: translated.length,
    reviewCount: review.length,
    sourceCharacterCount: translation.blocks.reduce((total, block) => total + block.text.length, 0),
    translatedCharacterCount: translation.blocks.reduce(
      (total, block) => total + block.translatedText.length,
      0,
    ),
  };
}
