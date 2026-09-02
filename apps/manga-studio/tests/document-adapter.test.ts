import type { ArtifactRef } from "@bcr/core";
import { createDocumentContentPackage, createDocumentTranslationPackage } from "@bcr/document-core";
import { describe, expect, it } from "vitest";
import {
  documentContentToMangaRegions,
  mangaOcrToDocumentContentPackage,
  mangaPageToDocumentPackages,
  mangaTranslationToDocumentTranslationPackage,
} from "../src/document-adapter";
import type { MangaOcrArtifact, MangaTranslationArtifact, TextRegion } from "../src/model";

const sourceRef: ArtifactRef = {
  id: "source/page-01",
  type: "file/image",
  storage: "opfs",
  format: "image/png",
  hash: "page-hash",
};

const ocr: MangaOcrArtifact = {
  version: 1,
  adapter: "manga.onnx",
  sourceName: "page-01.png",
  coordinateSpace: "normalized-percent",
  lines: [
    {
      id: "bubble-1",
      label: "BUBBLE 01",
      x: 12,
      y: 18,
      width: 22,
      height: 14,
      rotation: 3,
      writingMode: "vertical-rl",
      text: "ここから始めよう",
      confidence: 0.82,
      status: "detected",
    },
    {
      id: "bubble-2",
      label: "BUBBLE 02",
      x: 50,
      y: 60,
      width: 26,
      height: 10,
      rotation: 0,
      writingMode: "horizontal-tb",
      text: "また明日",
      confidence: 0.61,
      status: "needs-review",
    },
  ],
};

describe("Manga → Document package adapter", () => {
  it("preserves block identity, geometry, writing mode and confidence", () => {
    const content = mangaOcrToDocumentContentPackage(ocr, {
      sourceRef,
      sourceLanguage: "ja",
      contentId: "content-page-01",
    });

    expect(content).toMatchObject({
      id: "content-page-01",
      format: "image",
      sourceRef,
      metadata: { language: "ja", direction: "ttb" },
      provenance: { adapter: "manga.ocr.manga.onnx", sourceHash: "page-hash" },
    });
    expect(content.blocks).toEqual([
      expect.objectContaining({
        id: "bubble-1",
        order: 0,
        writingMode: "vertical-rl",
        confidence: 0.82,
        geometry: { x: 12, y: 18, width: 22, height: 14, rotation: 3 },
      }),
      expect.objectContaining({ id: "bubble-2", order: 1, confidence: 0.61 }),
    ]);
  });

  it("maps translation lines back to the same IDs and makes missing lines explicit", () => {
    const content = mangaOcrToDocumentContentPackage(ocr, { sourceRef });
    const translation: MangaTranslationArtifact = {
      version: 1,
      adapter: "fixture.translate",
      sourceName: "page-01.png",
      sourceLanguage: "ja",
      targetLanguage: "zh",
      lines: [
        {
          id: "bubble-1",
          sourceText: "ここから始めよう",
          translatedText: "就从这里开始吧",
          status: "needs-review",
        },
      ],
    };
    const projected = mangaTranslationToDocumentTranslationPackage(content, translation);

    expect(projected.blocks.map((block) => [block.id, block.translatedText, block.status])).toEqual(
      [
        ["bubble-1", "就从这里开始吧", "needs-review"],
        ["bubble-2", "", "skipped"],
      ],
    );
    expect(projected.blocks[0]).toMatchObject({
      geometry: content.blocks[0]?.geometry,
      writingMode: "vertical-rl",
      confidence: 0.82,
    });
  });

  it("projects the live reviewed page for shared search without inventing OCR", () => {
    const regions: ReadonlyArray<TextRegion> = ocr.lines.map((line, index) => ({
      id: line.id,
      label: line.label,
      x: line.x,
      y: line.y,
      width: line.width,
      height: line.height,
      rotation: line.rotation,
      writingMode: line.writingMode,
      sourceText: line.text,
      translatedText: index === 0 ? "就从这里开始吧" : "",
      confidence: line.confidence,
      status: index === 0 ? "reviewed" : "needs-review",
    }));
    const projected = mangaPageToDocumentPackages(
      {
        id: "page-01",
        source: {
          id: "source-page-01",
          kind: "image",
          name: "page-01.png",
          size: 10,
          objectUrl: "blob:page",
          ref: sourceRef,
          width: 1000,
          height: 1400,
          pageCount: 1,
        },
        regions,
      },
      "ja",
    );

    expect(projected.content.blocks.map((block) => block.id)).toEqual(["bubble-1", "bubble-2"]);
    expect(projected.translation.blocks.map((block) => block.status)).toEqual([
      "translated",
      "needs-review",
    ]);
    expect(projected.translation.sourceContentId).toBe(projected.content.id);
  });

  it("replays a visual Content Package into editable regions", () => {
    const content = mangaOcrToDocumentContentPackage(ocr, { sourceRef, sourceLanguage: "ja" });
    const translation = createDocumentTranslationPackage({
      id: "translation-replay",
      sourceContentId: content.id,
      sourceName: content.sourceName,
      format: content.format,
      sourceLanguage: "ja",
      targetLanguage: "zh-Hans",
      adapter: "manga.review.translation",
      blocks: content.blocks.map((block, index) => ({
        ...block,
        translatedText: index === 0 ? "就从这里开始吧" : "",
        status: index === 0 ? ("translated" as const) : ("skipped" as const),
      })),
    });

    expect(documentContentToMangaRegions(content, translation)).toEqual([
      expect.objectContaining({
        id: "bubble-1",
        sourceText: "ここから始めよう",
        translatedText: "就从这里开始吧",
        writingMode: "vertical-rl",
        status: "reviewed",
      }),
      expect.objectContaining({
        id: "bubble-2",
        translatedText: "",
        status: "needs-review",
      }),
    ]);
  });

  it("rejects visual blocks that cannot be placed on a page", () => {
    const malformed = createDocumentContentPackage({
      id: "missing-geometry",
      format: "image",
      sourceName: "missing-geometry.png",
      adapter: "manga.review.regions",
      blocks: [{ id: "missing", text: "文字" }],
      sourceRef,
    });
    expect(() => documentContentToMangaRegions(malformed)).toThrow("缺少 geometry");
  });
});
