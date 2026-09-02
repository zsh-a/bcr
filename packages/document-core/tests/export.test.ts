import { describe, expect, it } from "vitest";
import {
  createDocumentContentPackage,
  createDocumentExportBundle,
  createDocumentTranslationPackage,
  decodeDocumentExportBundle,
  documentExportFileName,
  serializeDocumentExport,
} from "../src";

function packages() {
  const content = createDocumentContentPackage({
    id: "export-content",
    format: "markdown",
    sourceName: "Notes: spring.md",
    metadata: { title: "Spring notes", author: "A. Writer", language: "en" },
    adapter: "markdown.extract",
    blocks: [
      { id: "heading", kind: "heading", label: "Chapter one", text: "First" },
      { id: "body", kind: "paragraph", label: "Body", text: "Hello world" },
    ],
  });
  const translation = createDocumentTranslationPackage({
    id: "export-translation",
    sourceContentId: content.id,
    sourceName: content.sourceName,
    format: content.format,
    sourceLanguage: "en",
    targetLanguage: "zh-Hans",
    adapter: "fixture.translate",
    blocks: [
      { id: "heading", label: "Chapter one", text: "First", translatedText: "第一章" },
      { id: "body", label: "Body", text: "Hello world", translatedText: "你好世界" },
    ],
  });
  return { content, translation };
}

describe("document exports", () => {
  it("keeps a lossless content/translation envelope in JSON", () => {
    const { content, translation } = packages();
    const bundle = createDocumentExportBundle(content, translation);
    const payload = serializeDocumentExport(content, translation, "json");

    expect(bundle).toEqual({ version: 1, content, translation });
    expect(payload.mime).toBe("application/json;charset=utf-8");
    expect(decodeDocumentExportBundle(JSON.parse(payload.text))).toEqual(bundle);
  });

  it("renders bilingual Markdown and translated plain text by stable block IDs", () => {
    const { content, translation } = packages();
    const markdown = serializeDocumentExport(content, translation, "markdown");
    const translated = serializeDocumentExport(content, translation, "text", "translated");

    expect(markdown.text).toContain("# Spring notes");
    expect(markdown.text).toContain("First\n\n> 第一章");
    expect(markdown.text).toContain("Hello world\n\n> 你好世界");
    expect(translated.text).toContain("第一章");
    expect(translated.text).toContain("你好世界");
    expect(translated.text).not.toContain("Hello world");
  });

  it("falls back to source text and sanitizes file names", () => {
    const { content } = packages();
    const payload = serializeDocumentExport(content, undefined, "text");
    expect(payload.text).toContain("Hello world");
    expect(documentExportFileName("  Notes:/spring.md  ", payload)).toBe("Notes-spring-source.txt");
  });

  it("rejects a translation that does not belong to the exported content", () => {
    const { content, translation } = packages();
    expect(
      decodeDocumentExportBundle({
        version: 1,
        content,
        translation: { ...translation, sourceContentId: "another-content" },
      }),
    ).toBeUndefined();
    expect(decodeDocumentExportBundle({ version: 2, content })).toBeUndefined();
  });
});
