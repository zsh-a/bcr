import type { RenderOptions, SceneDescription, TextureSpec, Vector3 } from "./types";

export function finite(value: number, name: string, min = -Infinity, max = Infinity): void {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new RangeError(`${name} must be finite and between ${min} and ${max}`);
}

function vector(value: Vector3, name: string): void {
  if (value.length !== 3) throw new RangeError(`${name} must contain three numbers`);
  value.forEach((n) => finite(n, name));
}

function texture(spec: TextureSpec): void {
  const source = spec.source;
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  finite(width, "Texture width", 1);
  finite(height, "Texture height", 1);
  if (
    "data" in source &&
    (source.data.length !== width * height * 4 ||
      !Number.isInteger(width) ||
      !Number.isInteger(height))
  ) {
    throw new RangeError("Pixel textures require width × height × 4 RGBA bytes");
  }
  spec.repeat?.forEach((n) => finite(n, "Texture repeat", 0.000001));
}

export function validateScene(scene: SceneDescription): void {
  if (scene.objects.length === 0) throw new RangeError("A scene must contain at least one object");
  if (
    (scene.camera?.kind ?? "auto") === "auto" &&
    scene.objects.every((object) => object.frame === false)
  ) {
    throw new RangeError("Automatic framing needs at least one subject");
  }
  for (const object of scene.objects) {
    const geometry = object.geometry;
    if (geometry.kind === "mesh") {
      if (
        geometry.positions.length < 9 ||
        geometry.positions.length % 3 !== 0 ||
        geometry.indices.length < 3 ||
        geometry.indices.length % 3 !== 0
      ) {
        throw new RangeError("Mesh positions and triangle indices must be nonempty triples");
      }
      geometry.positions.forEach((n) => finite(n, "Mesh position"));
      const count = geometry.positions.length / 3;
      if (geometry.indices.some((n) => n >= count))
        throw new RangeError("Mesh index exceeds vertex count");
      if (geometry.uvs !== undefined) {
        if (geometry.uvs.length !== count * 2)
          throw new RangeError("Mesh UV count must match vertex count");
        geometry.uvs.forEach((n) => finite(n, "Mesh UV"));
      }
    } else if (geometry.kind === "sphere") finite(geometry.radius, "Sphere radius", 0.000001);
    else if (geometry.kind === "plane" || geometry.kind === "box") {
      finite(geometry.width, "Geometry width", 0.000001);
      finite(geometry.height, "Geometry height", 0.000001);
      if (geometry.kind === "box") finite(geometry.depth, "Box depth", 0.000001);
    } else throw new RangeError("Unknown geometry kind");
    if (object.position) vector(object.position, "Object position");
    if (object.rotation) vector(object.rotation, "Object rotation");
    if (object.scale) {
      vector(object.scale, "Object scale");
      object.scale.forEach((n) => finite(n, "Object scale", 0.000001));
    }
    const material = object.material;
    if (material) {
      finite(material.roughness ?? 1, "Roughness", 0, 1);
      finite(material.metalness ?? 0, "Metalness", 0, 1);
      finite(material.bumpScale ?? 0, "Bump scale");
      if (material.side !== undefined && !["front", "back", "double"].includes(material.side))
        throw new RangeError("Unknown material side");
      for (const map of [material.map, material.normalMap, material.bumpMap, material.roughnessMap])
        if (map) texture(map);
      if (
        geometry.kind === "mesh" &&
        geometry.uvs === undefined &&
        (material.map || material.normalMap || material.bumpMap || material.roughnessMap)
      ) {
        throw new RangeError("Textured custom meshes require UV coordinates");
      }
    }
  }
  const camera = scene.camera;
  if (camera) {
    finite(camera.fov ?? 35, "Camera field of view", 5, 120);
    if (camera.up) vector(camera.up, "Camera up");
    if (camera.kind === "auto") {
      finite(camera.padding ?? 0.12, "Camera padding", 0, 0.8);
      if (camera.direction) vector(camera.direction, "Camera direction");
    } else if (camera.kind === "perspective") {
      vector(camera.position, "Camera position");
      vector(camera.target, "Camera target");
    } else throw new RangeError("Unknown camera kind");
  }
  for (const light of scene.lights) {
    finite(light.intensity, "Light intensity", 0);
    if (light.kind === "directional" || light.kind === "point")
      vector(light.position, "Light position");
    if (light.kind === "hemisphere" && light.direction)
      vector(light.direction, "Hemisphere direction");
    if (light.kind === "directional") {
      if (light.target) vector(light.target, "Light target");
      if (light.shadow) {
        if (![512, 1024, 2048, 4096].includes(light.shadow.resolution ?? 2048))
          throw new RangeError("Invalid shadow resolution");
        finite(light.shadow.radius ?? 2, "Shadow radius", 0, 16);
        finite(light.shadow.bias ?? 0, "Shadow bias");
        finite(light.shadow.normalBias ?? 0, "Shadow normal bias", 0);
      }
    } else if (light.kind === "point") {
      finite(light.distance ?? 0, "Light distance", 0);
      finite(light.decay ?? 2, "Light decay", 0);
    } else if (light.kind !== "hemisphere" && light.kind !== "ambient")
      throw new RangeError("Unknown light kind");
  }
}

export function resolveRenderOptions(options: RenderOptions = {}): Required<RenderOptions> {
  const size = options.size ?? { width: 1600, height: 1200 };
  for (const value of [size.width, size.height]) {
    finite(value, "Output dimension", 64, 4096);
    if (!Number.isInteger(value)) throw new RangeError("Output dimensions must be integers");
  }
  const format = options.format ?? "image/jpeg";
  if (!["image/jpeg", "image/png", "image/webp"].includes(format))
    throw new RangeError("Unsupported output format");
  const quality = options.quality ?? 0.94;
  const exposure = options.exposure ?? 0;
  const grain = options.grain ?? 0;
  const vignette = options.vignette ?? 0;
  const seed = options.seed ?? 42;
  const toneMapping = options.toneMapping ?? "neutral";
  finite(quality, "Quality", 0, 1);
  finite(exposure, "Exposure", -8, 8);
  finite(grain, "Grain", 0, 1);
  finite(vignette, "Vignette", 0, 1);
  if (!Number.isSafeInteger(seed)) throw new RangeError("Seed must be a safe integer");
  if (!["neutral", "aces", "none"].includes(toneMapping))
    throw new RangeError("Unknown tone mapping");
  return {
    size: { ...size },
    format,
    quality,
    exposure,
    grain,
    vignette,
    seed: seed >>> 0,
    toneMapping,
  };
}
