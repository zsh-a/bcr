import { describe, expect, it } from "vitest";
import { CLEAN_MODEL_MANIFESTS, resolveMangaCleanMode } from "../src/model";

describe("manga clean capability", () => {
  it("keeps fill as the effective mode", () => {
    expect(resolveMangaCleanMode("fill")).toEqual({
      requestedMode: "fill",
      effectiveMode: "fill",
      adapter: "fill",
    });
  });

  it("records inpaint fallback instead of claiming generated pixels", () => {
    expect(resolveMangaCleanMode("inpaint")).toEqual({
      requestedMode: "inpaint",
      effectiveMode: "fill",
      adapter: "fill",
      fallbackReason: "inpaint-adapter-not-ready",
    });
    expect(CLEAN_MODEL_MANIFESTS.find((manifest) => manifest.id === "inpaint.onnx")).toMatchObject({
      status: "experimental",
      detail: expect.stringContaining("回退 Fill"),
    });
  });
});
