import { resolveRenderOptions, validateScene } from "./config";
import type {
  RenderedScene,
  RenderOptions,
  RendererBackend,
  SceneDescription,
  SceneRenderer,
} from "./types";

/** A failed export cannot poison the queue or race disposal against another export. */
export function manageRenderer(
  backend: RendererBackend,
  render: (scene: SceneDescription, options: Required<RenderOptions>) => Promise<RenderedScene>,
  release: () => Promise<void>,
): SceneRenderer {
  let queue: Promise<unknown> = Promise.resolve();
  let closing = false;
  let disposal: Promise<void> | undefined;
  return {
    backend,
    render(scene, options = {}) {
      if (closing) return Promise.reject(new Error("Scene renderer has been disposed"));
      let settings: Required<RenderOptions>;
      try {
        validateScene(scene);
        settings = resolveRenderOptions(options);
      } catch (error) {
        return Promise.reject(error);
      }
      const result = queue.then(() => render(scene, settings));
      queue = result.catch(() => undefined);
      return result;
    },
    dispose() {
      closing = true;
      disposal ??= queue.then(release);
      return disposal;
    },
  };
}
