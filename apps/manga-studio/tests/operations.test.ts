import type { ArtifactRef } from "@bcr/core";
import { compile } from "@bcr/graph";
import { describe, expect, it } from "vitest";
import {
  defaultGraph,
  LOCAL_OCR_OPERATION,
  LOCAL_TRANSLATION_OPERATION,
  OPERATIONS,
  REVIEW_OCR_OPERATION,
} from "../src/operations";
import { OCR_MODEL_MANIFESTS, TRANSLATION_MODEL_MANIFESTS } from "../src/model";
import { DEFAULT_SETTINGS } from "../src/store";

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
});
