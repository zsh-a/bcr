import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  HemisphereLight,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardNodeMaterial,
  NeutralToneMapping,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RenderPipeline,
  RenderTarget,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3 as ThreeVector3,
  WebGPURenderer,
} from "three/webgpu";
import {
  float,
  hash,
  luminance,
  pass,
  renderOutput,
  screenCoordinate,
  screenUV,
  vec4,
} from "three/tsl";
import { fitCamera } from "./camera";
import { manageRenderer } from "./lifecycle";
import { unpackRgba } from "./readback";
import type {
  GeometrySpec,
  MaterialSpec,
  RenderOptions,
  RenderedScene,
  RendererBackend,
  SceneDescription,
  SceneRenderer,
  SceneRendererOptions,
  TextureSpec,
  Vector3,
} from "./types";

type Disposable = { dispose(): void };
type Own = <T extends Disposable>(resource: T) => T;

function makeTexture(spec: TextureSpec, color: boolean, own: Own): CanvasTexture | DataTexture {
  const source = spec.source;
  let map: CanvasTexture | DataTexture;
  if ("data" in source) {
    map = own(new DataTexture(source.data, source.width, source.height, RGBAFormat));
    map.generateMipmaps = true;
    map.minFilter = LinearMipmapLinearFilter;
  } else {
    const width = "naturalWidth" in source ? source.naturalWidth : source.width;
    const height = "naturalHeight" in source ? source.naturalHeight : source.height;
    const scale = Math.min(1, 4096 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("Cannot create a texture canvas");
    // Normalize ImageBitmap/HTMLImageElement orientation without modifying the input.
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    map = own(new CanvasTexture(canvas));
  }
  if (color) map.colorSpace = SRGBColorSpace;
  if (spec.repeat) {
    map.wrapS = map.wrapT = RepeatWrapping;
    map.repeat.set(...spec.repeat);
  }
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

function makeGeometry(spec: GeometrySpec): BufferGeometry {
  switch (spec.kind) {
    case "plane":
      return new PlaneGeometry(spec.width, spec.height);
    case "box":
      return new BoxGeometry(spec.width, spec.height, spec.depth);
    case "sphere":
      return new SphereGeometry(spec.radius, 64, 40);
    case "mesh": {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(spec.positions, 3));
      if (spec.uvs) geometry.setAttribute("uv", new BufferAttribute(spec.uvs, 2));
      geometry.setIndex(new BufferAttribute(spec.indices, 1));
      geometry.computeVertexNormals();
      return geometry;
    }
  }
}

function makeMaterial(spec: MaterialSpec, own: Own): MeshStandardNodeMaterial {
  const material = own(
    new MeshStandardNodeMaterial({
      color: spec.color ?? "#ffffff",
      roughness: spec.roughness ?? 0.8,
      metalness: spec.metalness ?? 0,
      side: spec.side === "back" ? BackSide : spec.side === "double" ? DoubleSide : FrontSide,
    }),
  );
  if (spec.map) material.map = makeTexture(spec.map, true, own);
  if (spec.bumpMap) material.bumpMap = makeTexture(spec.bumpMap, false, own);
  if (spec.normalMap) material.normalMap = makeTexture(spec.normalMap, false, own);
  if (spec.roughnessMap) material.roughnessMap = makeTexture(spec.roughnessMap, false, own);
  material.bumpScale = spec.bumpScale ?? 0.001;
  return material;
}

function boxCorners(box: Box3): Vector3[] {
  const points: Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) points.push([x, y, z]);
    }
  }
  return points;
}

function setupCamera(
  description: SceneDescription,
  bounds: Box3,
  aspect: number,
): PerspectiveCamera {
  const spec = description.camera ?? { kind: "auto" };
  const camera = new PerspectiveCamera(spec.fov ?? 35, aspect);
  camera.up.set(...(spec.up ?? [0, 1, 0]));
  const center = bounds.getCenter(new ThreeVector3());
  const target: Vector3 =
    spec.kind === "perspective" ? spec.target : [center.x, center.y, center.z];
  if (spec.kind === "perspective") {
    camera.position.set(...spec.position);
    if (camera.position.distanceTo(new ThreeVector3(...target)) < 1e-8)
      throw new RangeError("Camera position and target must differ");
    // Validate the up basis as well as the automatic camera's basis.
    fitCamera(
      [],
      target,
      [spec.position[0] - target[0], spec.position[1] - target[1], spec.position[2] - target[2]],
      spec.up ?? [0, 1, 0],
      camera.fov,
      aspect,
      0,
    );
  } else {
    const fit = fitCamera(
      boxCorners(bounds),
      target,
      spec.direction ?? [0, -0.2, 1],
      spec.up ?? [0, 1, 0],
      camera.fov,
      aspect,
      spec.padding ?? 0.12,
    );
    camera.position.set(...fit.position);
  }
  camera.lookAt(...target);
  const radius = Math.max(bounds.getSize(new ThreeVector3()).length(), 0.001);
  const distance = camera.position.distanceTo(center);
  camera.near = Math.max(0.00001, Math.min(radius / 100, distance / 100));
  camera.far = Math.max(10, distance + radius * 20);
  camera.updateProjectionMatrix();
  return camera;
}

function setupLights(scene: Scene, description: SceneDescription, bounds: Box3, own: Own): void {
  const center = bounds.getCenter(new ThreeVector3());
  const radius = Math.max(bounds.getSize(new ThreeVector3()).length() * 0.65, 0.01);
  for (const spec of description.lights) {
    if (spec.kind === "ambient")
      scene.add(new AmbientLight(spec.color ?? "#ffffff", spec.intensity));
    else if (spec.kind === "hemisphere") {
      const light = new HemisphereLight(spec.sky, spec.ground, spec.intensity);
      light.position.set(...(spec.direction ?? [0, 0, 1]));
      scene.add(light);
    } else if (spec.kind === "point") {
      const light = new PointLight(
        spec.color ?? "#ffffff",
        spec.intensity,
        spec.distance ?? 0,
        spec.decay ?? 2,
      );
      light.position.set(...spec.position);
      scene.add(light);
    } else {
      const light = new DirectionalLight(spec.color ?? "#ffffff", spec.intensity);
      light.position.set(...spec.position);
      light.target.position.set(...(spec.target ?? [center.x, center.y, center.z]));
      if (light.position.distanceTo(light.target.position) < 1e-8)
        throw new RangeError("Directional light position and target must differ");
      if (spec.shadow) {
        light.castShadow = true;
        const shadow = own(light.shadow);
        shadow.mapSize.setScalar(spec.shadow.resolution ?? 2048);
        shadow.camera.left = shadow.camera.bottom = -radius;
        shadow.camera.right = shadow.camera.top = radius;
        shadow.camera.near = 0.0001;
        shadow.camera.far = light.position.distanceTo(center) + radius * 4;
        shadow.radius = spec.shadow.radius ?? 2;
        shadow.bias = spec.shadow.bias ?? -0.00002;
        shadow.normalBias = spec.shadow.normalBias ?? radius * 0.0002;
      }
      scene.add(light, light.target);
    }
  }
}

async function renderFrame(
  renderer: WebGPURenderer,
  backend: RendererBackend,
  description: SceneDescription,
  options: Required<RenderOptions>,
): Promise<RenderedScene> {
  const owned: Disposable[] = [];
  const own: Own = (resource) => {
    owned.push(resource);
    return resource;
  };
  try {
    const { size } = options;
    renderer.setSize(size.width, size.height, false);
    const toneMapping =
      options.toneMapping === "aces"
        ? ACESFilmicToneMapping
        : options.toneMapping === "none"
          ? NoToneMapping
          : NeutralToneMapping;
    renderer.toneMapping = toneMapping;
    renderer.toneMappingExposure = 2 ** options.exposure;
    const scene = new Scene();
    scene.background = new Color(description.background ?? "#dedede");
    const bounds = new Box3();
    for (const spec of description.objects) {
      const mesh = new Mesh(
        own(makeGeometry(spec.geometry)),
        makeMaterial(spec.material ?? {}, own),
      );
      if (spec.position) mesh.position.set(...spec.position);
      if (spec.rotation) mesh.rotation.set(...spec.rotation);
      if (spec.scale) mesh.scale.set(...spec.scale);
      mesh.castShadow = spec.castShadow ?? true;
      mesh.receiveShadow = spec.receiveShadow ?? true;
      scene.add(mesh);
      if (spec.frame !== false) bounds.expandByObject(mesh, true);
    }
    // Explicit cameras can render backgrounds only; their lighting bounds still need a scale.
    if (bounds.isEmpty()) bounds.set(new ThreeVector3(-1, -1, -1), new ThreeVector3(1, 1, 1));
    const camera = setupCamera(description, bounds, size.width / size.height);
    setupLights(scene, description, bounds, own);

    const scenePass = own(pass(scene, camera));
    const output = renderOutput(scenePass, toneMapping, SRGBColorSpace);
    const radius = screenUV.sub(0.5).length().div(Math.SQRT1_2);
    const vignette = float(1).sub(radius.pow(2).mul(options.vignette));
    const grain = hash(
      screenCoordinate.x.add(screenCoordinate.y.mul(size.width)).add(options.seed % 65536),
    ).sub(0.5);
    const noiseLevel = float(0.0008)
      .add(float(1).sub(luminance(output.rgb)).mul(0.003))
      .mul(options.grain);
    const pipeline = own(new RenderPipeline(renderer));
    pipeline.outputColorTransform = false;
    pipeline.outputNode = vec4(output.rgb.mul(vignette).add(grain.mul(noiseLevel)).clamp(0, 1), 1);
    // Export from an owned target, not the presentation canvas. Awaiting readback
    // synchronizes GPU work and also works when no animation loop is running.
    const target = own(
      new RenderTarget(size.width, size.height, { type: UnsignedByteType, depthBuffer: false }),
    );
    renderer.setRenderTarget(target);
    pipeline.render();
    const pixels = await renderer.readRenderTargetPixelsAsync(
      target,
      0,
      0,
      size.width,
      size.height,
    );
    renderer.setRenderTarget(null);
    if (!(pixels instanceof Uint8Array)) throw new Error("Unexpected GPU readback format");
    const rgba = unpackRgba(pixels, size, backend);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("Cannot create the image export canvas");
    ctx.putImageData(new ImageData(rgba, size.width, size.height), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value === null ? reject(new Error("Image encoding failed")) : resolve(value)),
        options.format,
        options.quality,
      );
    });
    if (blob.type !== options.format)
      throw new Error(`This browser cannot encode ${options.format}`);
    return { blob, width: size.width, height: size.height, backend };
  } finally {
    renderer.setRenderTarget(null);
    for (const resource of owned.reverse()) resource.dispose();
  }
}

export async function createRenderer(options: SceneRendererOptions): Promise<SceneRenderer> {
  if (typeof document === "undefined")
    throw new Error("Scene rendering requires a browser with WebGPU or WebGL 2");
  if (options.backend !== undefined && !["auto", "webgl"].includes(options.backend))
    throw new RangeError("Unknown renderer backend");
  const renderer = new WebGPURenderer({
    antialias: true,
    alpha: false,
    forceWebGL: options.backend === "webgl",
  });
  let deviceError: Error | undefined;
  renderer.onDeviceLost = (info) => {
    deviceError = new Error(`${info.api} device lost: ${info.message}`);
  };
  try {
    await renderer.init();
  } catch (cause) {
    await renderer.dispose();
    throw new Error("Cannot initialize scene rendering: WebGPU and WebGL 2 are unavailable", {
      cause,
    });
  }
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const backend: RendererBackend = "isWebGPUBackend" in renderer.backend ? "webgpu" : "webgl";
  return manageRenderer(
    backend,
    async (scene, options) => {
      if (deviceError) throw deviceError;
      const result = await renderFrame(renderer, backend, scene, options);
      if (deviceError) throw deviceError;
      return result;
    },
    () => renderer.dispose(),
  );
}
