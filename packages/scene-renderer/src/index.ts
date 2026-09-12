export type {
  SceneImage,
  Vector2,
  Vector3,
  ImageSize,
  PixelImage,
  TextureSpec,
  GeometrySpec,
  MaterialSpec,
  SceneObject,
  LightSpec,
  ShadowSpec,
  CameraSpec,
  SceneDescription,
  RendererBackend,
  RenderOptions,
  RenderedScene,
  SceneRendererOptions,
  SceneRenderer,
} from "./types";
export { validateScene } from "./config";

import type {
  SceneDescription,
  RenderOptions,
  RenderedScene,
  SceneRendererOptions,
  SceneRenderer,
} from "./types";

/** DOM/GPU-free entry point. Three.js is loaded only when a renderer is requested. */
export async function createSceneRenderer(
  options: SceneRendererOptions = {},
): Promise<SceneRenderer> {
  const { createRenderer } = await import("./renderer");
  return createRenderer(options);
}

/** One-shot export. Reuse createSceneRenderer() when rendering several scenes. */
export async function renderScene(
  scene: SceneDescription,
  options: RenderOptions = {},
): Promise<RenderedScene> {
  const renderer = await createSceneRenderer();
  try {
    return await renderer.render(scene, options);
  } finally {
    await renderer.dispose();
  }
}
