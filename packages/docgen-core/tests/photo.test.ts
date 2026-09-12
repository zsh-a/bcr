import { describe, expect, it } from "vitest";
import { photoConfig } from "../src/photo-options";
import { createDocumentScene } from "../src/photo-scene";
import { createPaperSurface, PAPER_THICKNESS } from "../src/photo-surface";
import { validateScene } from "@bcr/scene-renderer";

describe("document photo recipe", () => {
  it("matches the page aspect ratio and chooses an appropriate output orientation", () => {
    for (const [width, height] of [
      [2481, 3509],
      [3509, 2481],
      [400, 3000],
      [3000, 400],
      [1000, 1000],
    ] as const) {
      const config = photoConfig({ width, height } as HTMLCanvasElement);
      expect(config.render.size).toEqual(
        width > height ? { width: 2160, height: 1620 } : { width: 1620, height: 2160 },
      );
      expect(config.sheet.width / config.sheet.height).toBeCloseTo(width / height, 10);
      expect(Math.max(config.sheet.width, config.sheet.height)).toBeCloseTo(0.297, 10);
    }
  });

  it("rejects empty source images and unknown presets", () => {
    expect(() => photoConfig({ width: 0, height: 200 } as HTMLCanvasElement)).toThrow(RangeError);
    expect(() =>
      photoConfig({ width: 100, height: 200 } as HTMLCanvasElement, {
        scene: "missing" as "studio",
      }),
    ).toThrow(RangeError);
  });

  it("builds domain-independent scenes and preserves the input image", () => {
    const image = { width: 800, height: 1100 } as HTMLCanvasElement;
    for (const preset of ["daylight", "studio", "warm"] as const) {
      const { scene } = createDocumentScene(image, { scene: preset });
      expect(() => validateScene(scene)).not.toThrow();
      expect(scene.objects[0]?.material?.map?.source).toBe(image);
      expect(scene.objects.filter((object) => object.frame === false)).toHaveLength(1);
      expect(scene.lights.some((light) => light.kind === "directional" && light.shadow)).toBe(true);
    }
  });
});

describe("paper surface", () => {
  it("keeps deterministic sheets and their undersides above the desk", () => {
    const size = { width: 0.21, height: 0.297 };
    for (const shape of ["flat", "natural", "folded"] as const) {
      const surface = createPaperSurface(size, shape, 42);
      expect(surface.positions).toEqual(createPaperSurface(size, shape, 42).positions);
      const heights = surface.positions.filter((_, i) => i % 3 === 2);
      expect(heights.every(Number.isFinite)).toBe(true);
      const min = Math.min(...heights);
      const max = Math.max(...heights);
      expect(min - PAPER_THICKNESS).toBeGreaterThan(0);
      expect(max).toBeLessThan(0.015);
      if (shape === "flat") expect(max).toBe(min);
      else expect(max - min).toBeGreaterThan(0.0005);
    }
  });

  it("keeps UV corners and triangle winding consistent", () => {
    const surface = createPaperSurface({ width: 0.21, height: 0.297 }, "folded", 17);
    const vertexCount = surface.positions.length / 3;
    expect(Array.from(surface.uvs.slice(0, 2))).toEqual([0, 0]);
    expect(Array.from(surface.uvs.slice(-2))).toEqual([1, 1]);
    expect(new Set(surface.boundary).size).toBe(surface.boundary.length);
    for (let i = 0; i < surface.indices.length; i += 3) {
      const a = surface.indices[i]!;
      const b = surface.indices[i + 1]!;
      const c = surface.indices[i + 2]!;
      expect(Math.max(a, b, c)).toBeLessThan(vertexCount);
      const px = surface.positions;
      const crossZ =
        (px[b * 3]! - px[a * 3]!) * (px[c * 3 + 1]! - px[a * 3 + 1]!) -
        (px[b * 3 + 1]! - px[a * 3 + 1]!) * (px[c * 3]! - px[a * 3]!);
      expect(crossZ).toBeGreaterThan(0);
    }
  });
});
