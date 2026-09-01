import type { ArtifactRef } from "@bcr/core";
import { compile } from "@bcr/graph";
import { describe, expect, it } from "vitest";
import { defaultGraph, OPERATIONS } from "../src/operations";
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
});
