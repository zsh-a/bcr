import type { ArtifactRef } from "@bcr/core";
import {
  createDocumentContentPackage,
  type DocumentContentPackage,
  type DocumentBlockWritingMode,
} from "./content";

/** The small, format-neutral line contract emitted by a visual OCR adapter. */
export interface DocumentOcrLine {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number | undefined;
  readonly writingMode?: DocumentBlockWritingMode | undefined;
  readonly text: string;
  readonly confidence?: number | undefined;
  readonly pageNumber?: number | undefined;
}

export interface DocumentOcrContentInput {
  readonly id: string;
  readonly sourceName: string;
  readonly sourceRef?: ArtifactRef | undefined;
  readonly sourceHash?: string | undefined;
  readonly sourceLanguage?: string | undefined;
  readonly lines: ReadonlyArray<DocumentOcrLine>;
  readonly adapter: string;
  readonly createdAt?: number | undefined;
}

/**
 * Convert OCR lines into the canonical document boundary. Geometry remains
 * normalized so Manga can take over review/typesetting without re-OCRing.
 */
export function createDocumentOcrContent(input: DocumentOcrContentInput): DocumentContentPackage {
  return createDocumentContentPackage({
    id: input.id,
    format: "image",
    sourceName: input.sourceName,
    ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }),
    ...(input.sourceHash === undefined ? {} : { sourceHash: input.sourceHash }),
    ...(input.sourceLanguage === undefined ? {} : { metadata: { language: input.sourceLanguage } }),
    adapter: input.adapter,
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    blocks: input.lines.map((line, index) => ({
      id: line.id,
      order: index,
      kind: "paragraph" as const,
      label: line.label || `Region ${index + 1}`,
      text: line.text,
      pageNumber: line.pageNumber ?? 1,
      geometry: {
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
        ...(line.rotation === undefined ? {} : { rotation: line.rotation }),
      },
      ...(line.writingMode === undefined ? {} : { writingMode: line.writingMode }),
      ...(line.confidence === undefined ? {} : { confidence: line.confidence }),
    })),
  });
}
