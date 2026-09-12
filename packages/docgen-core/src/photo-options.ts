import type { ImageSize, SceneImage } from "@bcr/scene-renderer";

export type PhotoScene = "daylight" | "studio" | "warm";
export type PaperShape = "flat" | "natural" | "folded";
export type PaperPhotoSource = SceneImage;
export interface PaperPhotoOptions {
  readonly size?: ImageSize;
  readonly scene?: PhotoScene;
  readonly paper?: PaperShape;
  readonly seed?: number;
  readonly quality?: number;
  readonly exposure?: number;
}

export const PHOTO_SCENES = [
  { id: "daylight", label: "自然窗光" },
  { id: "studio", label: "柔光桌面" },
  { id: "warm", label: "暖光木桌" },
] as const;

export function photoConfig(source: PaperPhotoSource, options: PaperPhotoOptions = {}) {
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (![width, height].every((n) => Number.isFinite(n) && n > 0))
    throw new RangeError("Page dimensions must be positive and finite");
  const scene = options.scene ?? "daylight";
  const paper = options.paper ?? "natural";
  if (!PHOTO_SCENES.some((entry) => entry.id === scene))
    throw new RangeError("Unknown photo scene");
  if (!["flat", "natural", "folded"].includes(paper)) throw new RangeError("Unknown paper shape");
  const seed = options.seed ?? 42;
  if (!Number.isSafeInteger(seed)) throw new RangeError("Seed must be a safe integer");
  const scale = 0.297 / Math.max(width, height);
  return {
    scene,
    paper,
    seed: seed >>> 0,
    sheet: { width: width * scale, height: height * scale },
    render: {
      size:
        options.size ??
        (width > height ? { width: 2160, height: 1620 } : { width: 1620, height: 2160 }),
      quality: options.quality ?? 0.94,
      exposure: options.exposure ?? 0,
      vignette: 0.055,
      grain: 0.55,
      seed: seed >>> 0,
    },
  };
}
