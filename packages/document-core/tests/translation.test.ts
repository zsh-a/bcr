import { describe, expect, it } from "vitest";
import {
  createDocumentTranslationPackage,
  decodeDocumentTranslationPackage,
  documentTranslationStats,
} from "../src";

describe("document translation package", () => {
  it("preserves block identity while normalizing translation state", () => {
    const translation = createDocumentTranslationPackage({
      id: "translation-1",
      sourceContentId: "content-1",
      sourceName: "notes.md",
      format: "markdown",
      sourceLanguage: "en",
      targetLanguage: "zh-Hans",
      adapter: "fixture.translate",
      createdAt: 100,
      blocks: [
        {
          id: "paragraph-1",
          label: "正文",
          text: " Hello\r\nworld ",
          translatedText: " 你好世界 ",
          status: "translated",
          confidence: 1.4,
        },
        {
          id: "paragraph-2",
          text: "Review me",
          translatedText: "",
          status: "translated",
        },
      ],
    });

    expect(translation).toMatchObject({
      version: 1,
      sourceContentId: "content-1",
      sourceLanguage: "en",
      targetLanguage: "zh-Hans",
      provenance: { adapter: "fixture.translate", createdAt: 100 },
    });
    expect(translation.blocks).toEqual([
      expect.objectContaining({
        id: "paragraph-1",
        order: 0,
        text: "Hello\nworld",
        translatedText: "你好世界",
        status: "translated",
        confidence: 1,
      }),
      expect.objectContaining({
        id: "paragraph-2",
        order: 1,
        translatedText: "",
        status: "needs-review",
      }),
    ]);
    expect(documentTranslationStats(translation)).toEqual({
      blockCount: 2,
      translatedCount: 1,
      reviewCount: 1,
      sourceCharacterCount: 20,
      translatedCharacterCount: 4,
    });
  });

  it("migrates pre-contract translated sections", () => {
    const translation = decodeDocumentTranslationPackage({
      version: 1,
      adapter: "fixture.translate",
      sourceName: "Legacy.txt",
      sections: [
        {
          id: "section-1",
          order: 9,
          label: "One",
          text: "hello",
          translatedText: "你好",
          status: "needs-review",
        },
      ],
    });
    expect(translation).toBeDefined();
    expect(translation).toMatchObject({
      format: "unknown",
      sourceContentId: "document-content-legacy-legacy-txt",
      targetLanguage: "zh-Hans",
      provenance: { adapter: "fixture.translate" },
    });
    expect(translation?.blocks[0]).toMatchObject({ order: 0, translatedText: "你好" });
  });

  it("rejects malformed translation blocks", () => {
    expect(
      decodeDocumentTranslationPackage({
        version: 1,
        id: "bad",
        sourceContentId: "content",
        sourceName: "bad.txt",
        format: "txt",
        targetLanguage: "zh-Hans",
        blocks: [{ text: "source", translatedText: 1 }],
      }),
    ).toBeUndefined();
  });
});
