import type { ArtifactRef } from "@bcr/core";
import type { DocumentFormat } from "./model";

/** Normalized geometry shared by OCR, typesetting and future visual review. */
export interface DocumentBlockGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number | undefined;
}

export type DocumentBlockKind = "heading" | "paragraph" | "quote" | "code" | "image" | "page";
/** Inline writing mode used by visual sources such as manga speech bubbles. */
export type DocumentBlockWritingMode = "horizontal-tb" | "vertical-rl";

/** A format-neutral unit that can be rendered, indexed or sent to translation. */
export interface DocumentBlock {
  readonly id: string;
  readonly order: number;
  readonly kind: DocumentBlockKind;
  readonly label: string;
  readonly text: string;
  readonly html?: string | undefined;
  readonly pageNumber?: number | undefined;
  readonly href?: string | undefined;
  readonly geometry?: DocumentBlockGeometry | undefined;
  readonly writingMode?: DocumentBlockWritingMode | undefined;
  readonly confidence?: number | undefined;
}

export interface DocumentContentMetadata {
  readonly title?: string | undefined;
  readonly author?: string | undefined;
  readonly language?: string | undefined;
  readonly direction?: "ltr" | "rtl" | "ttb" | undefined;
}

export interface DocumentContentProvenance {
  readonly adapter: string;
  readonly createdAt: number;
  readonly sourceHash?: string | undefined;
  readonly parentArtifact?: ArtifactRef | undefined;
}

/** Versioned canonical payload exchanged between Document, Reader and Manga. */
export interface DocumentContentPackage {
  readonly version: 1;
  readonly id: string;
  readonly format: DocumentFormat;
  readonly sourceName: string;
  readonly sourceRef?: ArtifactRef | undefined;
  readonly metadata: DocumentContentMetadata;
  readonly blocks: ReadonlyArray<DocumentBlock>;
  readonly provenance: DocumentContentProvenance;
}

export interface DocumentContentStats {
  readonly blockCount: number;
  readonly textBlockCount: number;
  readonly characterCount: number;
  readonly wordCount: number;
  readonly pageCount: number;
}

export interface DocumentContentPackageInput {
  readonly id: string;
  readonly format: DocumentFormat;
  readonly sourceName: string;
  readonly sourceRef?: ArtifactRef | undefined;
  readonly metadata?: DocumentContentMetadata | undefined;
  readonly blocks: ReadonlyArray<Partial<DocumentBlock> & { readonly text: string }>;
  readonly adapter: string;
  readonly sourceHash?: string | undefined;
  readonly createdAt?: number | undefined;
}

const BLOCK_KINDS: ReadonlySet<DocumentBlockKind> = new Set([
  "heading",
  "paragraph",
  "quote",
  "code",
  "image",
  "page",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function blockKind(value: unknown): DocumentBlockKind {
  return typeof value === "string" && BLOCK_KINDS.has(value as DocumentBlockKind)
    ? (value as DocumentBlockKind)
    : "paragraph";
}

function writingMode(value: unknown): DocumentBlockWritingMode | undefined {
  return value === "horizontal-tb" || value === "vertical-rl" ? value : undefined;
}

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

function normalizeGeometry(value: unknown): DocumentBlockGeometry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<DocumentBlockGeometry>;
  if (
    typeof candidate.x !== "number" ||
    typeof candidate.y !== "number" ||
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number" ||
    ![candidate.x, candidate.y, candidate.width, candidate.height].every(Number.isFinite)
  ) {
    return undefined;
  }
  const rotation =
    typeof candidate.rotation === "number" && Number.isFinite(candidate.rotation)
      ? candidate.rotation
      : undefined;
  return {
    x: clamp(candidate.x, 0, 100),
    y: clamp(candidate.y, 0, 100),
    width: clamp(candidate.width, 0, 100),
    height: clamp(candidate.height, 0, 100),
    ...(rotation === undefined ? {} : { rotation }),
  };
}

function normalizeBlock(
  value: Partial<DocumentBlock> & { readonly text: string },
  index: number,
): DocumentBlock {
  const id = cleanOptional(value.id) ?? `block-${index + 1}`;
  const label = cleanOptional(value.label) ?? `Block ${index + 1}`;
  const html = cleanOptional(value.html);
  const href = cleanOptional(value.href);
  const pageNumber =
    typeof value.pageNumber === "number" && Number.isFinite(value.pageNumber)
      ? Math.max(1, Math.floor(value.pageNumber))
      : undefined;
  const geometry = normalizeGeometry(value.geometry);
  const mode = writingMode(value.writingMode);
  const confidence =
    typeof value.confidence === "number" && Number.isFinite(value.confidence)
      ? clamp(value.confidence, 0, 1)
      : undefined;
  return {
    id,
    order: index,
    kind: blockKind(value.kind),
    label,
    text: cleanText(value.text),
    ...(html === undefined ? {} : { html }),
    ...(pageNumber === undefined ? {} : { pageNumber }),
    ...(href === undefined ? {} : { href }),
    ...(geometry === undefined ? {} : { geometry }),
    ...(mode === undefined ? {} : { writingMode: mode }),
    ...(confidence === undefined ? {} : { confidence }),
  };
}

function normalizeBlocks(
  blocks: ReadonlyArray<Partial<DocumentBlock> & { readonly text: string }>,
): ReadonlyArray<DocumentBlock> {
  const used = new Set<string>();
  return blocks.map((block, index) => {
    const normalized = normalizeBlock(block, index);
    let id = normalized.id;
    let suffix = 2;
    while (used.has(id)) {
      id = `${normalized.id}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return id === normalized.id ? normalized : { ...normalized, id };
  });
}

function metadataOf(value: unknown): DocumentContentMetadata {
  if (typeof value !== "object" || value === null) return {};
  const candidate = value as Partial<DocumentContentMetadata>;
  const title = cleanOptional(candidate.title);
  const author = cleanOptional(candidate.author);
  const language = cleanOptional(candidate.language);
  const direction =
    candidate.direction === "ltr" || candidate.direction === "rtl" || candidate.direction === "ttb"
      ? candidate.direction
      : undefined;
  return {
    ...(title === undefined ? {} : { title }),
    ...(author === undefined ? {} : { author }),
    ...(language === undefined ? {} : { language }),
    ...(direction === undefined ? {} : { direction }),
  };
}

/** Build a deterministic, bounded canonical payload from an adapter result. */
export function createDocumentContentPackage(
  input: DocumentContentPackageInput,
): DocumentContentPackage {
  const blocks = normalizeBlocks(input.blocks);
  const metadata = metadataOf(input.metadata);
  const sourceName = cleanOptional(input.sourceName) ?? "未命名文档";
  const sourceHash = cleanOptional(input.sourceHash);
  const createdAt =
    typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
      ? input.createdAt
      : Date.now();
  return {
    version: 1,
    id: cleanOptional(input.id) ?? `document-${stableId(sourceName, input.format)}`,
    format: input.format,
    sourceName,
    ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }),
    metadata,
    blocks,
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

function decodeBlock(value: unknown, index: number): DocumentBlock | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<DocumentBlock>;
  if (typeof candidate.text !== "string") return undefined;
  return normalizeBlock({ ...candidate, text: candidate.text }, index);
}

/** Validate new payloads and migrate the v1 `sections` extractor shape. */
export function decodeDocumentContentPackage(value: unknown): DocumentContentPackage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<DocumentContentPackage> & {
    readonly sections?: unknown;
  };
  const legacySections = Array.isArray(candidate.sections) && !Array.isArray(candidate.blocks);
  const sourceName = cleanOptional(candidate.sourceName);
  const id =
    cleanOptional(candidate.id) ??
    (legacySections && sourceName !== undefined
      ? `document-legacy-${sourceName
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .slice(0, 48)}`
      : undefined);
  if (
    candidate.version !== 1 ||
    id === undefined ||
    !isDocumentFormat(candidate.format) ||
    sourceName === undefined
  ) {
    return undefined;
  }
  const rawBlocks = Array.isArray(candidate.blocks)
    ? candidate.blocks
    : Array.isArray(candidate.sections)
      ? candidate.sections
      : [];
  const decodedBlocks = rawBlocks.map((item, index) => decodeBlock(item, index));
  if (decodedBlocks.some((block) => block === undefined)) return undefined;
  const blocks = normalizeBlocks(
    decodedBlocks.filter((block): block is DocumentBlock => block !== undefined),
  );
  const sourceRef = isArtifactRef(candidate.sourceRef) ? candidate.sourceRef : undefined;
  const rawProvenance = candidate.provenance;
  const provenance =
    typeof rawProvenance === "object" && rawProvenance !== null
      ? (rawProvenance as Partial<DocumentContentProvenance>)
      : undefined;
  const adapter = cleanOptional(provenance?.adapter) ?? "legacy.extract";
  const createdAt =
    typeof provenance?.createdAt === "number" && Number.isFinite(provenance.createdAt)
      ? provenance.createdAt
      : Date.now();
  const sourceHash = cleanOptional(provenance?.sourceHash);
  const parentArtifact = isArtifactRef(provenance?.parentArtifact)
    ? provenance.parentArtifact
    : sourceRef;
  return {
    version: 1,
    id,
    format: candidate.format,
    sourceName,
    ...(sourceRef === undefined ? {} : { sourceRef }),
    metadata: metadataOf(candidate.metadata),
    blocks,
    provenance: {
      adapter,
      createdAt,
      ...(sourceHash === undefined ? {} : { sourceHash }),
      ...(parentArtifact === undefined ? {} : { parentArtifact }),
    },
  };
}

export function documentContentText(content: DocumentContentPackage): string {
  return content.blocks
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n\n");
}

export function documentContentStats(content: DocumentContentPackage): DocumentContentStats {
  const textBlocks = content.blocks.filter((block) => block.text.length > 0);
  const text = documentContentText(content);
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const pages = content.blocks.flatMap((block) =>
    block.pageNumber === undefined ? [] : [block.pageNumber],
  );
  return {
    blockCount: content.blocks.length,
    textBlockCount: textBlocks.length,
    characterCount: text.length,
    wordCount: words.length,
    pageCount: pages.length === 0 ? 0 : Math.max(...pages),
  };
}
