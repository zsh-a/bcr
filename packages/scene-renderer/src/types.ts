/** Inputs remain caller-owned and must stay valid until render() resolves. */
export type SceneImage = HTMLImageElement | ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
export type Vector2 = readonly [number, number];
export type Vector3 = readonly [number, number, number];

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** RGBA8 data, with the first row at UV v=0 (the bottom of a mesh). */
export interface PixelImage extends ImageSize {
  readonly data: Uint8Array;
}

export interface TextureSpec {
  readonly source: SceneImage | PixelImage;
  readonly repeat?: Vector2;
}

/** Positions and dimensions use meters. A plane lies in XY, facing +Z. */
export type GeometrySpec =
  | { readonly kind: "plane"; readonly width: number; readonly height: number }
  | {
      readonly kind: "box";
      readonly width: number;
      readonly height: number;
      readonly depth: number;
    }
  | { readonly kind: "sphere"; readonly radius: number }
  | {
      readonly kind: "mesh";
      readonly positions: Float32Array;
      readonly indices: Uint32Array;
      readonly uvs?: Float32Array;
    };

export interface MaterialSpec {
  readonly color?: string;
  /** Color textures are decoded as sRGB. All other maps contain linear data. */
  readonly map?: TextureSpec;
  readonly normalMap?: TextureSpec;
  readonly bumpMap?: TextureSpec;
  readonly bumpScale?: number;
  readonly roughnessMap?: TextureSpec;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly side?: "front" | "back" | "double";
}

export interface SceneObject {
  readonly geometry: GeometrySpec;
  readonly material?: MaterialSpec;
  readonly position?: Vector3;
  /** Euler XYZ rotation in radians. */
  readonly rotation?: Vector3;
  readonly scale?: Vector3;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  /** False excludes floors/background objects from automatic camera framing. */
  readonly frame?: boolean;
}

export interface ShadowSpec {
  readonly resolution?: 512 | 1024 | 2048 | 4096;
  readonly radius?: number;
  readonly bias?: number;
  readonly normalBias?: number;
}

export type LightSpec =
  | { readonly kind: "ambient"; readonly color?: string; readonly intensity: number }
  | {
      readonly kind: "hemisphere";
      readonly sky: string;
      readonly ground: string;
      readonly intensity: number;
      readonly direction?: Vector3;
    }
  | {
      readonly kind: "directional";
      readonly color?: string;
      readonly intensity: number;
      readonly position: Vector3;
      readonly target?: Vector3;
      readonly shadow?: ShadowSpec;
    }
  | {
      readonly kind: "point";
      readonly color?: string;
      readonly intensity: number;
      readonly position: Vector3;
      readonly distance?: number;
      readonly decay?: number;
    };

export type CameraSpec =
  | {
      readonly kind: "auto";
      readonly direction?: Vector3;
      readonly up?: Vector3;
      readonly fov?: number;
      readonly padding?: number;
    }
  | {
      readonly kind: "perspective";
      readonly position: Vector3;
      readonly target: Vector3;
      readonly up?: Vector3;
      readonly fov?: number;
    };

/** Framework- and domain-independent scene description. No Three.js types escape. */
export interface SceneDescription {
  readonly objects: readonly SceneObject[];
  readonly lights: readonly LightSpec[];
  readonly camera?: CameraSpec;
  readonly background?: string;
}

export type RendererBackend = "webgpu" | "webgl";
export interface RenderOptions {
  readonly size?: ImageSize;
  readonly format?: "image/jpeg" | "image/png" | "image/webp";
  readonly quality?: number;
  /** Exposure compensation in stops. */
  readonly exposure?: number;
  readonly toneMapping?: "neutral" | "aces" | "none";
  /** Both effects apply to the entire frame. Defaults to zero. */
  readonly vignette?: number;
  readonly grain?: number;
  readonly seed?: number;
}

export interface RenderedScene extends ImageSize {
  readonly blob: Blob;
  readonly backend: RendererBackend;
}

export interface SceneRendererOptions {
  /** Auto prefers WebGPU, falling back to WebGL 2 if initialization fails. */
  readonly backend?: "auto" | "webgl";
}

export interface SceneRenderer {
  readonly backend: RendererBackend;
  /** Requests are serialized. Scene descriptions must remain immutable until resolved. */
  render(scene: SceneDescription, options?: RenderOptions): Promise<RenderedScene>;
  /** Finishes accepted requests, then releases owned resources. Idempotent. */
  dispose(): Promise<void>;
}
