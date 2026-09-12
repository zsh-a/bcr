import type { GeometrySpec, LightSpec, SceneDescription, SceneObject } from "@bcr/scene-renderer";
import { mulberry32 } from "./hash";
import { deskTexture, paperBump } from "./photo-materials";
import { photoConfig, type PaperPhotoOptions, type PaperPhotoSource } from "./photo-options";
import { createPaperSurface, PAPER_THICKNESS, type PaperSurface } from "./photo-surface";

function sheetEdge(surface: PaperSurface): GeometrySpec {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const index of surface.boundary) {
    const x = surface.positions[index * 3]!;
    const y = surface.positions[index * 3 + 1]!;
    const z = surface.positions[index * 3 + 2]!;
    positions.push(x, y, z, x, y, z - PAPER_THICKNESS);
  }
  for (let i = 0; i < surface.boundary.length; i++) {
    const a = i * 2;
    const b = ((i + 1) % surface.boundary.length) * 2;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return {
    kind: "mesh",
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/** Document photography is a scene recipe, not a special case in the renderer. */
export function createDocumentScene(source: PaperPhotoSource, options: PaperPhotoOptions = {}) {
  const config = photoConfig(source, options);
  const { sheet, seed } = config;
  const surface = createPaperSurface(sheet, config.paper, seed);
  const rng = mulberry32(seed ^ 0x7ac4);
  const rotation = [0, 0, (rng() - 0.5) * 0.08] as const;
  const geometry: GeometrySpec = {
    kind: "mesh",
    positions: surface.positions,
    uvs: surface.uvs,
    indices: surface.indices,
  };
  const objects: SceneObject[] = [
    {
      geometry,
      rotation,
      material: {
        map: { source },
        color: "#faf9f5",
        roughness: 0.93,
        bumpMap: { source: paperBump(seed), repeat: [sheet.width / 0.045, sheet.height / 0.045] },
        bumpScale: 0.000002,
      },
    },
    {
      geometry,
      rotation,
      position: [0, 0, -PAPER_THICKNESS],
      material: { color: "#e9e6db", roughness: 0.94, side: "back" },
    },
    { geometry: sheetEdge(surface), rotation, material: { color: "#e1ddd1", roughness: 0.95 } },
    {
      geometry: { kind: "plane", width: 8, height: 8 },
      frame: false,
      castShadow: false,
      material: {
        map: { source: deskTexture(config.scene, seed), repeat: [8 / 0.65, 8 / 0.65] },
        roughness: 0.83,
      },
    },
  ];
  const warm = config.scene === "warm";
  const studio = config.scene === "studio";
  const lights: LightSpec[] = [
    {
      kind: "hemisphere",
      sky: warm ? "#eee4d5" : "#e6efff",
      ground: "#837868",
      intensity: studio ? 1.45 : 1.05,
      direction: [0, 0, 1],
    },
    {
      kind: "directional",
      color: warm ? "#ffdfb3" : "#fff7e9",
      intensity: studio ? 2.2 : 2.8,
      position: [-0.35, 0.45, studio ? 0.95 : 0.65],
      target: [0, 0, 0],
      shadow: {
        resolution: 2048,
        radius: studio ? 3 : 2,
        normalBias: 0.00008,
        bias: config.paper === "folded" ? -0.0005 : -0.0002,
      },
    },
  ];
  const scene: SceneDescription = {
    objects,
    lights,
    background: "#c3b9aa",
    camera: {
      kind: "auto",
      direction: [0.03 + rng() * 0.07, -0.1 - rng() * 0.09, 1],
      fov: 32,
      padding: 0.14,
    },
  };
  return { scene, render: config.render };
}
