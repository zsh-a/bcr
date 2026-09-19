import { describe, expect, it } from "vitest";
import { createDocumentContentPackage, createDocumentTranslationPackage } from "@bcr/document-core";
import { createTextCitation, findTextMatches, withTextCitation } from "@bcr/core";
import { documentCitationSources, resolveDocumentCitation } from "../src/documentCitation";

const content = createDocumentContentPackage({
  id: "content",
  format: "txt",
  sourceName: "notes.txt",
  adapter: "test",
  blocks: [{ id: "one", text: "原始研究证据。" }],
});
const translation = createDocumentTranslationPackage({
  id: "translated",
  sourceContentId: content.id,
  sourceName: "notes.txt",
  format: "txt",
  targetLanguage: "en",
  adapter: "test",
  blocks: [{ id: "one", text: "原始研究证据。", translatedText: "Original research evidence." }],
});
function params(field: string) {
  const blocks =
    field === "translation"
      ? translation.blocks.map((block) => ({ id: block.id, text: block.translatedText }))
      : content.blocks;
  const text = blocks[0]!.text;
  const source = documentCitationSources("job", blocks, field)[0]!;
  const citation = createTextCitation(
    text,
    source,
    findTextMatches(text, field === "translation" ? "research" : "研究")[0]!,
  );
  return new URL(
    withTextCitation(`/documents?job=job&block=one&field=${field}`, citation),
    "https://example.org",
  ).searchParams;
}
describe("Document citation validation", () => {
  it("resolves original and translated text separately", () => {
    for (const field of ["original", "translation"]) {
      const resolved = resolveDocumentCitation("job", content, translation, params(field));
      expect(resolved.status).toBe("exact");
      if ("field" in resolved) {
        expect(resolved.field).toBe(field);
        expect(resolved.blockId).toBe("one");
      }
    }
  });
  it("rebinds a uniquely matching block after extraction changes its ID", () => {
    const changed = { ...content, blocks: [{ ...content.blocks[0]!, id: "renamed" }] };
    const resolved = resolveDocumentCitation("job", changed, translation, params("original"));
    expect(resolved).toMatchObject({ status: "relocated", blockId: "renamed" });
  });
  it("refuses a missing translation, edited text or ambiguous blocks", () => {
    expect(resolveDocumentCitation("job", content, undefined, params("translation")).status).toBe(
      "missing",
    );
    expect(
      resolveDocumentCitation(
        "job",
        { ...content, blocks: [{ ...content.blocks[0]!, text: "证据已被改写" }] },
        translation,
        params("original"),
      ).status,
    ).toBe("changed");
    const repeated = {
      ...content,
      blocks: [
        { ...content.blocks[0]!, id: "a" },
        { ...content.blocks[0]!, id: "b" },
      ],
    };
    expect(resolveDocumentCitation("job", repeated, translation, params("original")).status).toBe(
      "ambiguous",
    );
  });
});
