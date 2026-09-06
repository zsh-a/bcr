import {
  citationFromParams,
  resolveTextCitation,
  textVersion,
  type CitationSource,
  type CitationResolution,
} from "@bcr/core";
import type { DocumentContentPackage, DocumentTranslationPackage } from "@bcr/document-core";

export function documentCitationSources(
  jobId: string,
  blocks: ReadonlyArray<{ readonly id: string; readonly text: string }>,
  field: string,
): CitationSource[] {
  const scope = JSON.stringify(["document", jobId, field]);
  const version = textVersion(JSON.stringify(blocks.map((block) => [block.id, block.text])));
  return blocks.map((block) => ({ scope, version, unit: block.id, offset: 0 }));
}
type DocumentCitationResolution =
  | Exclude<CitationResolution, { status: "exact" | "relocated" }>
  | (Extract<CitationResolution, { status: "exact" | "relocated" }> & {
      blockId: string;
      field: string;
    });
export function resolveDocumentCitation(
  jobId: string,
  content: DocumentContentPackage,
  translation: DocumentTranslationPackage | undefined,
  params: URLSearchParams,
): DocumentCitationResolution {
  const anchor = citationFromParams(params);
  if (!anchor) return { status: "changed" as const };
  const field = params.get("field") === "translation" ? "translation" : "original";
  const blocks =
    field === "translation"
      ? (translation?.blocks.map((block) => ({ id: block.id, text: block.translatedText })) ?? [])
      : content.blocks;
  const sources = documentCitationSources(jobId, blocks, field);
  const resolution = resolveTextCitation(
    anchor,
    blocks.map((block, index) => ({ text: block.text, source: sources[index]! })),
  );
  return "candidate" in resolution
    ? { ...resolution, blockId: blocks[resolution.candidate]!.id, field }
    : resolution;
}
