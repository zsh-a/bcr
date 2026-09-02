import type { ArtifactRef } from "@bcr/core";
import { compile } from "@bcr/graph";
import { describe, expect, it } from "vitest";
import {
  defaultGraph,
  CLEAN_PREVIEW_OPERATION,
  LOCAL_OCR_OPERATION,
  LOCAL_TRANSLATION_OPERATION,
  OPERATIONS,
  REVIEW_OCR_OPERATION,
} from "../src/operations";
import {
  OCR_MODEL_MANIFESTS,
  TRANSLATION_MODEL_MANIFESTS,
  decodeMangaOcrArtifact,
  decodeMangaTranslationArtifact,
  resolveMangaDevice,
  resolveMangaOcrAdapter,
  resolveMangaTranslationAdapter,
} from "../src/model";
import { DEFAULT_SETTINGS } from "../src/store";
import { mergeOcrLinesIntoRegions } from "../src/pipeline";

describe("Manga Studio operation graph", () => {
  it("compiles the full page pipeline with named fan-in bindings", () => {
    const source: ArtifactRef = {
      id: "source/demo-page.svg",
      type: "file/image",
      storage: "opfs",
    };
    const nodes = compile(defaultGraph(DEFAULT_SETTINGS), OPERATIONS, {
      sourceInputs: [source],
    });

    expect(nodes).toHaveLength(9);
    expect(nodes[0]?.id).toBe("import");
    expect(nodes[0]?.inputs).toEqual([{ ...source, port: "source" }]);
    expect(nodes.find((node) => node.id === "ocr")?.bindings).toEqual([
      { from: "normalize", output: "page", input: "page" },
      { from: "detect", output: "regions", input: "regions" },
    ]);
    expect(nodes.find((node) => node.id === "typeset")?.bindings).toEqual([
      { from: "clean", output: "cleanPage", input: "cleanPage" },
      { from: "translate", output: "segments", input: "segments" },
    ]);
  });

  it("keeps the artifact types explicit for each quality boundary", () => {
    expect(
      OPERATIONS.map((operation) => operation.outputs.map((port) => port.type).join(",")),
    ).toEqual([
      "manga/page-manifest",
      "image/normalized",
      "manga/text-regions",
      "manga/ocr-lines",
      "manga/text-blocks",
      "manga/translation-segments",
      "manga/clean-page",
      "manga/typeset-page",
      "manga/export",
    ]);
  });

  it("exposes a review OCR adapter without weakening the visual graph contract", () => {
    expect(REVIEW_OCR_OPERATION).toMatchObject({
      operation: "manga.ocr.review",
      runtime: "wasm",
      detail: expect.stringContaining("审校"),
    });
    expect(REVIEW_OCR_OPERATION.outputs).toEqual([
      { name: "lines", type: "manga/ocr-lines", label: "lines" },
    ]);
  });

  it("keeps the local model opt-in and device-selectable", () => {
    expect(LOCAL_OCR_OPERATION).toMatchObject({
      operation: "manga.ocr.onnx",
      runtime: "wasm",
    });
    expect(LOCAL_OCR_OPERATION.resources).toEqual({ memoryMB: 1536, threads: 1 });
    expect(DEFAULT_SETTINGS.ocrDevice).toBe("auto");
    expect(LOCAL_OCR_OPERATION.config?.find((field) => field.key === "device")?.default).toBe(
      "auto",
    );
    expect(LOCAL_OCR_OPERATION.config?.find((field) => field.key === "model")?.default).toBe(
      "Xenova/trocr-small-printed",
    );
    expect(OCR_MODEL_MANIFESTS.find((manifest) => manifest.id === "vision.onnx")).toMatchObject({
      runtime: "wasm",
      status: "experimental",
      languages: ["en"],
    });
    expect(OCR_MODEL_MANIFESTS.find((manifest) => manifest.id === "manga.onnx")).toMatchObject({
      model: "onnx-community/manga-ocr-base-ONNX",
      runtime: "wasm",
      status: "experimental",
      languages: ["ja"],
    });
  });

  it("catalogs language-specific local translation models", () => {
    expect(LOCAL_TRANSLATION_OPERATION).toMatchObject({
      operation: "manga.translate.onnx",
      runtime: "wasm",
    });
    expect(LOCAL_TRANSLATION_OPERATION.inputs).toEqual([
      { name: "lines", type: "manga/ocr-lines", label: "lines" },
    ]);
    expect(LOCAL_TRANSLATION_OPERATION.outputs).toEqual([
      { name: "segments", type: "manga/translation-lines", label: "segments" },
    ]);
    expect(TRANSLATION_MODEL_MANIFESTS.find((manifest) => manifest.id === "local")).toMatchObject({
      status: "experimental",
      runtime: "wasm",
      models: {
        ja: "Xenova/nllb-200-distilled-600M",
        en: "Xenova/nllb-200-distilled-600M",
        ko: "Xenova/nllb-200-distilled-600M",
      },
    });
  });

  it("resolves adapter capabilities without silently using an incompatible model", () => {
    const unsupported = resolveMangaOcrAdapter("vision.onnx", "ja", {
      device: "auto",
      webgpuAvailable: false,
    });
    expect(unsupported.execution).toMatchObject({
      requestedAdapter: "vision.onnx",
      effectiveAdapter: "review.manual",
      effectiveDevice: "review",
      fallbackReason: "language-unsupported",
    });

    const localOcr = resolveMangaOcrAdapter("manga.onnx", "ja", {
      device: "webgpu",
      webgpuAvailable: false,
    });
    expect(localOcr.execution).toMatchObject({
      requestedAdapter: "manga.onnx",
      effectiveAdapter: "manga.onnx",
      effectiveDevice: "wasm",
      fallbackReason: "webgpu-unavailable",
    });

    const localTranslation = resolveMangaTranslationAdapter("local", "ko", {
      device: "webgpu",
      webgpuAvailable: false,
    });
    expect(localTranslation.execution).toMatchObject({
      requestedAdapter: "local",
      effectiveAdapter: "local",
      effectiveDevice: "wasm",
      fallbackReason: "webgpu-unavailable",
      model: "Xenova/nllb-200-distilled-600M",
    });

    expect(resolveMangaDevice("wasm", true)).toEqual({
      requestedDevice: "wasm",
      effectiveDevice: "wasm",
    });
  });

  it("validates versioned OCR and translation artifacts at the adapter boundary", () => {
    const ocr = decodeMangaOcrArtifact({
      version: 1,
      adapter: "review.manual",
      sourceName: "page.png",
      coordinateSpace: "normalized-percent",
      lines: [
        {
          id: "line-1",
          label: "REVIEW 01",
          x: 10,
          y: 20,
          width: 30,
          height: 12,
          rotation: 0,
          writingMode: "horizontal-tb",
          text: "原文",
          confidence: 0.5,
          status: "needs-review",
        },
      ],
    });
    expect(ocr.execution).toBeUndefined();
    expect(() => decodeMangaOcrArtifact({ ...ocr, version: 2 })).toThrow("contract validation");
    expect(() =>
      decodeMangaOcrArtifact({
        ...ocr,
        lines: [{ ...ocr.lines[0], confidence: 2 }],
      }),
    ).toThrow("confidence");

    const translation = decodeMangaTranslationArtifact({
      version: 1,
      adapter: "fixture.translate",
      sourceName: "page.png",
      sourceLanguage: "ja",
      targetLanguage: "zh",
      lines: [{ id: "line-1", sourceText: "原文", translatedText: "译文", status: "needs-review" }],
    });
    expect(translation.lines[0]?.translatedText).toBe("译文");
    expect(() => decodeMangaTranslationArtifact({ ...translation, targetLanguage: "en" })).toThrow(
      "contract validation",
    );
  });

  it("exposes a safe cleaning preview boundary", () => {
    expect(CLEAN_PREVIEW_OPERATION).toMatchObject({
      operation: "manga.clean.preview",
      runtime: "wasm",
    });
    expect(CLEAN_PREVIEW_OPERATION.outputs).toEqual([
      { name: "cleanPage", type: "manga/clean-page", label: "clean" },
    ]);
  });

  it("merges OCR output back into review regions without losing stable IDs", () => {
    const merged = mergeOcrLinesIntoRegions(
      [
        {
          id: "bubble-1",
          label: "OLD",
          x: 1,
          y: 2,
          width: 3,
          height: 4,
          rotation: 0,
          writingMode: "horizontal-tb",
          sourceText: "旧文本",
          translatedText: "保留译文",
          confidence: 0.1,
          status: "reviewed",
        },
      ],
      [
        {
          id: "bubble-1",
          label: "BUBBLE 01",
          x: 12,
          y: 18,
          width: 22,
          height: 14,
          rotation: 3,
          writingMode: "vertical-rl",
          text: "新识别文本",
          confidence: 0.5,
          status: "needs-review",
        },
      ],
    );
    expect(merged).toEqual([
      expect.objectContaining({
        id: "bubble-1",
        sourceText: "新识别文本",
        translatedText: "保留译文",
        writingMode: "vertical-rl",
        confidence: 0.5,
        status: "needs-review",
      }),
    ]);
  });
});
