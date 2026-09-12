import { describe, expect, it } from "vitest";
import { createSceneRenderer, type SceneDescription, type Vector3 } from "../src/index";
import { resolveRenderOptions, validateScene } from "../src/config";
import { fitCamera, dot } from "../src/camera";
import { manageRenderer } from "../src/lifecycle";

const scene: SceneDescription = {
  objects: [{ geometry: { kind: "box", width: 1, height: 2, depth: 0.5 } }],
  lights: [],
};

describe("generic scene contract", () => {
  it("imports without DOM or GPU initialization", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof createSceneRenderer).toBe("function");
  });

  it("accepts primitive and custom meshes without domain-specific fields", () => {
    expect(() => validateScene(scene)).not.toThrow();
    expect(() =>
      validateScene({
        objects: [
          { geometry: { kind: "sphere", radius: 0.4 }, material: { metalness: 0.5 } },
          { geometry: { kind: "plane", width: 10, height: 10 }, frame: false },
          {
            geometry: {
              kind: "mesh",
              positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
              indices: new Uint32Array([0, 1, 2]),
            },
          },
        ],
        lights: [{ kind: "point", position: [1, 2, 3], intensity: 2 }],
      }),
    ).not.toThrow();
  });

  it("rejects invalid meshes, images, framing and output before rendering", () => {
    expect(() => validateScene({ ...scene, objects: [] })).toThrow(RangeError);
    expect(() =>
      validateScene({ ...scene, objects: [{ ...scene.objects[0]!, frame: false }] }),
    ).toThrow(RangeError);
    expect(() =>
      validateScene({
        ...scene,
        objects: [
          {
            geometry: {
              kind: "mesh",
              positions: new Float32Array(9),
              indices: new Uint32Array([0, 1, 3]),
            },
          },
        ],
      }),
    ).toThrow(RangeError);
    expect(() =>
      validateScene({
        ...scene,
        objects: [
          {
            ...scene.objects[0]!,
            material: { map: { source: { width: 1, height: 1, data: new Uint8Array(3) } } },
          },
        ],
      }),
    ).toThrow(RangeError);
    expect(() => resolveRenderOptions({ size: { width: 4097, height: 800 } })).toThrow(RangeError);
    expect(() => resolveRenderOptions({ size: { width: 800.5, height: 800 } })).toThrow(RangeError);
    expect(() => resolveRenderOptions({ quality: NaN })).toThrow(RangeError);
    expect(() => resolveRenderOptions({ seed: 1.5 })).toThrow(RangeError);
  });

  it("perspective-fits translated 3D bounds for both output orientations", () => {
    for (const aspect of [0.15, 0.75, 1, 1.333, 6]) {
      const target: Vector3 = [2, -1, 0.3];
      const points: Vector3[] = [];
      for (const x of [-0.5, 0.5])
        for (const y of [-1, 1])
          for (const z of [-0.3, 0.3]) points.push([x + target[0], y + target[1], z + target[2]]);
      const fit = fitCamera(points, target, [0.2, -0.3, 1], [0, 1, 0], 35, aspect, 0.12);
      const tanY = Math.tan((35 * Math.PI) / 360);
      for (const point of points) {
        const p: Vector3 = [point[0] - target[0], point[1] - target[1], point[2] - target[2]];
        const depth = fit.distance - dot(p, fit.direction);
        expect(depth).toBeGreaterThan(0);
        expect(Math.abs(dot(p, fit.up) / (depth * tanY))).toBeLessThanOrEqual(0.880001);
        expect(Math.abs(dot(p, fit.right) / (depth * tanY * aspect))).toBeLessThanOrEqual(0.880001);
      }
    }
    expect(() => fitCamera([], [0, 0, 0], [0, 1, 0], [0, 1, 0], 35, 1, 0.1)).toThrow(RangeError);
  });
});

describe("renderer lifecycle", () => {
  it("serializes work, recovers after a failure and waits to dispose", async () => {
    const events: string[] = [];
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let calls = 0;
    const renderer = manageRenderer(
      "webgl",
      async (_, options) => {
        const call = ++calls;
        events.push(`start ${call}`);
        if (call === 1) {
          await gate;
          throw new Error("Texture upload failed");
        }
        events.push(`end ${call}`);
        return { blob: new Blob(), backend: "webgl", ...options.size };
      },
      async () => {
        events.push("dispose");
      },
    );
    const failed = renderer.render(scene);
    const failure = expect(failed).rejects.toThrow("Texture upload failed");
    const next = renderer.render(scene, { size: { width: 800, height: 600 } });
    const disposed = renderer.dispose();
    expect(renderer.dispose()).toBe(disposed);
    await expect(renderer.render(scene)).rejects.toThrow("disposed");
    expect(events).toEqual(["start 1"]);
    unblock();
    await failure;
    expect((await next).width).toBe(800);
    await disposed;
    expect(events).toEqual(["start 1", "start 2", "end 2", "dispose"]);
  });
});
