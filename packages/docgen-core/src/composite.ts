/** Backward-compatible docgen adapter to the domain-independent scene renderer. */
import { renderScene } from "@bcr/scene-renderer";
import { createDocumentScene } from "./photo-scene";
import type { PaperPhotoOptions, PaperPhotoSource } from "./photo-options";

/** Default portrait size; landscape pages automatically export at 2160 × 1620. */
export const PHOTO_WIDTH = 1620;
export const PHOTO_HEIGHT = 2160;

export async function compositePaperPhoto(
  bill: PaperPhotoSource,
  options: PaperPhotoOptions = {},
): Promise<Blob> {
  const { scene, render } = createDocumentScene(bill, options);
  const photo = await renderScene(scene, render);
  return photo.blob;
}
