import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import type { CycleSpacePoint } from "@bcr/market-data/cycle";

export interface CycleSpaceCountry {
  id: string;
  name: string;
  color: string;
}
export interface CycleSpaceModel {
  period: string;
  from: string;
  extent: { x: number; y: number };
  series: {
    country: CycleSpaceCountry;
    points: CycleSpacePoint[];
    segments: [CycleSpacePoint, CycleSpacePoint][];
    current: CycleSpacePoint | null;
  }[];
}
export function cycleMonth(period: string): number | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/u.exec(period);
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
}
export function cyclePeriod(month: number): string {
  return `${Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}`;
}
function niceExtent(value: number, minimum: number): number {
  const padded = Math.max(minimum, value * 1.12);
  const step = 10 ** Math.floor(Math.log10(padded));
  return Math.ceil(padded / step) * step;
}
/** Bounds use all supplied data, so scrubbing does not silently change the x/y scale. */
export function prepareCycleSpace(
  points: readonly CycleSpacePoint[],
  countries: CycleSpaceCountry[],
  period: string,
): CycleSpaceModel {
  const ids = new Set(countries.map((country) => country.id));
  const seen = new Set<string>();
  const valid = points
    .filter((point) => {
      const key = `${point.country}:${point.period}`;
      if (
        !ids.has(point.country) ||
        cycleMonth(point.period) === null ||
        !Number.isFinite(point.level) ||
        !Number.isFinite(point.momentum) ||
        seen.has(key)
      )
        return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.period.localeCompare(b.period));
  const end = cycleMonth(period),
    start = (end ?? 0) - 35;
  const extent = {
    x: niceExtent(Math.max(0, ...valid.map((point) => Math.abs(point.level - 100))), 0.5),
    y: niceExtent(Math.max(0, ...valid.map((point) => Math.abs(point.momentum))), 0.2),
  };
  return {
    period,
    from: end === null ? "" : cyclePeriod(start),
    extent,
    series: countries.map((country) => {
      const history =
        end === null
          ? []
          : valid.filter(
              (point) =>
                point.country === country.id &&
                cycleMonth(point.period)! >= start &&
                cycleMonth(point.period)! <= end,
            );
      const segments: [CycleSpacePoint, CycleSpacePoint][] = [];
      history.forEach((point, index) => {
        const next = history[index + 1];
        if (next && cycleMonth(next.period)! - cycleMonth(point.period)! === 1)
          segments.push([point, next]);
      });
      return {
        country,
        points: history,
        segments,
        current: history.find((point) => point.period === period) ?? null,
      };
    }),
  };
}
export function cycleSpacePosition(
  point: CycleSpacePoint,
  model: CycleSpaceModel,
): [number, number, number] {
  const age = (cycleMonth(model.period) ?? 0) - (cycleMonth(point.period) ?? 0);
  return [
    ((point.level - 100) / model.extent.x) * 4,
    (point.momentum / model.extent.y) * 2.6,
    2.8 - (age / 35) * 6.4,
  ];
}
export function cycleSpacePhase(point: CycleSpacePoint): string {
  if (point.phase === "flat") return "景气动量持平";
  const above = point.level >= 100,
    rising = point.momentum > 0;
  return `${above ? "高于趋势" : "低于趋势"} · ${rising ? "动量改善" : "动量走弱"}`;
}

export type CycleRendererState = "initializing" | "ready" | "paused" | "unavailable" | "lost";
export interface CycleSpaceEngine {
  update: (model: CycleSpaceModel, selectedCountry: string | null) => void;
  setActive: (active: boolean) => void;
  reset: () => void;
  zoom: (factor: number) => void;
  dispose: () => void;
}
interface SpacePalette {
  surface: string;
  text: string;
  faint: string;
  border: string;
  mono: string;
  sans: string;
  resolve: (color: string) => string;
}
export function readSpacePalette(host: HTMLElement): SpacePalette {
  const style = getComputedStyle(host),
    value = (key: string) => style.getPropertyValue(key).trim();
  return {
    surface: value("--color-surface"),
    text: value("--color-text"),
    faint: value("--color-faint"),
    border: value("--color-border"),
    mono: value("--font-mono"),
    sans: value("--font-sans"),
    resolve: (color) => (color.startsWith("var(") ? value(color.slice(4, -1).trim()) : color),
  };
}
export function disposeSpaceObject(root: Object3D) {
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>(),
    textures = new Set<CanvasTexture>();
  root.traverse((object) => {
    const drawable = object as Mesh;
    if (drawable.geometry) geometries.add(drawable.geometry);
    if (drawable.material)
      for (const material of Array.isArray(drawable.material)
        ? drawable.material
        : [drawable.material]) {
        materials.add(material);
        const map = (material as SpriteMaterial).map;
        if (map instanceof CanvasTexture) textures.add(map);
      }
  });
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
}
function spaceLabel(text: string, color: string, font: string, height = 0.24): Sprite {
  const canvas = document.createElement("canvas"),
    context = canvas.getContext("2d");
  canvas.width = 1024;
  canvas.height = 56;
  if (context) {
    context.font = `36px ${font}`;
    const width = Math.min(1024, Math.ceil(context.measureText(text).width) + 24);
    canvas.width = Math.max(80, width);
    context.font = `36px ${font}`;
    context.fillStyle = color;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(
    new SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      sizeAttenuation: false,
    }),
  );
  sprite.userData["labelHeight"] = (height / 0.24) * 20;
  sprite.userData["labelAspect"] = canvas.width / canvas.height;
  sprite.renderOrder = 5;
  return sprite;
}
/** Labels retain a readable screen size while orbiting or resizing the canvas. */
export function resizeSpaceLabels(root: Object3D, camera: PerspectiveCamera, height: number) {
  const pixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / (height * camera.zoom);
  const compact = height * camera.aspect < 360;
  root.traverse((object) => {
    if (!(object instanceof Sprite)) return;
    const kind = object.userData["axisLabel"];
    // Native caption and HUD retain units and precise values on narrow screens.
    object.visible = !compact || (kind !== "title" && kind !== "outerX" && kind !== "middleTime");
    const labelHeight = Number(object.userData["labelHeight"]);
    const aspect = Number(object.userData["labelAspect"]);
    object.scale.set(pixel * labelHeight * aspect, pixel * labelHeight, 1);
  });
}
function addSpaceLines(group: Group, coordinates: number[][], color: string, opacity: number) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(coordinates.flat(), 3));
  group.add(
    new LineSegments(geometry, new LineBasicMaterial({ color, transparent: true, opacity })),
  );
}
export function buildSpaceScene(
  model: CycleSpaceModel,
  selected: string | null,
  palette: SpacePalette,
) {
  const group = new Group(),
    markers: Mesh[] = [];
  const front = 2.8,
    back = -3.6;
  const floor = new Mesh(
    new PlaneGeometry(8, 6.4),
    new MeshBasicMaterial({
      color: palette.border,
      transparent: true,
      opacity: 0.045,
      depthWrite: false,
      side: 2,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -2.6, -0.4);
  group.add(floor);
  const rectangle = (z: number) => [
    [-4, -2.6, z],
    [4, -2.6, z],
    [4, -2.6, z],
    [4, 2.6, z],
    [4, 2.6, z],
    [-4, 2.6, z],
    [-4, 2.6, z],
    [-4, -2.6, z],
  ];
  addSpaceLines(group, rectangle(front), palette.border, 0.6);
  addSpaceLines(group, rectangle(back), palette.border, 0.22);
  addSpaceLines(
    group,
    [
      [-4, 0, front],
      [4, 0, front],
      [0, -2.6, front],
      [0, 2.6, front],
      [0, 0, front],
      [0, 0, back],
    ],
    palette.faint,
    0.5,
  );
  for (const x of [-4, 4])
    for (const y of [-2.6, 2.6])
      addSpaceLines(
        group,
        [
          [x, y, back],
          [x, y, front],
        ],
        palette.border,
        0.25,
      );
  const end = cycleMonth(model.period);
  if (end !== null)
    for (const age of [0, 12, 24, 35]) {
      const z = front - (age / 35) * 6.4;
      addSpaceLines(
        group,
        [
          [-4, -2.6, z],
          [4, -2.6, z],
        ],
        palette.border,
        0.35,
      );
      const label = spaceLabel(cyclePeriod(end - age), palette.faint, palette.mono, 0.21);
      label.userData["axisLabel"] = age === 0 || age === 35 ? "endTime" : "middleTime";
      label.position.set(4.9, -2.25, z);
      group.add(label);
    }
  const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
  for (const fraction of [-1, 0, 1]) {
    const xLabel = spaceLabel(
      number.format(100 + fraction * model.extent.x),
      palette.faint,
      palette.mono,
    );
    xLabel.userData["axisLabel"] = fraction === 0 ? "originX" : "outerX";
    xLabel.position.set(fraction * 4, -2.96, front);
    group.add(xLabel);
    const yLabel = spaceLabel(
      number.format(fraction * model.extent.y),
      palette.faint,
      palette.mono,
    );
    yLabel.position.set(-4.45, fraction * 2.6, front);
    group.add(yLabel);
  }
  const labels: [string, number, number, number][] = [
    ["CLI · 100 为长期趋势", 0, -3.9, front],
    ["三个月变化 · 点", -3.2, 3.65, front],
  ];
  for (const [text, x, y, z] of labels) {
    const label = spaceLabel(text, palette.faint, palette.sans, 0.24);
    label.userData["axisLabel"] = "title";
    label.position.set(x, y, z);
    group.add(label);
  }
  for (const series of model.series) {
    const color = new Color(palette.resolve(series.country.color)),
      visible = !selected || selected === series.country.id;
    const positions: number[] = [],
      colors: number[] = [];
    for (const segment of series.segments)
      for (const point of segment) {
        positions.push(...cycleSpacePosition(point, model));
        const age = end === null ? 35 : end - cycleMonth(point.period)!;
        const shade = new Color(palette.surface).lerp(color, 0.18 + (1 - age / 35) * 0.82);
        colors.push(shade.r, shade.g, shade.b);
      }
    if (positions.length) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
      group.add(
        new LineSegments(
          geometry,
          new LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: visible ? 0.95 : 0.45,
          }),
        ),
      );
    }
    if (series.points.length) {
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(
          series.points.flatMap((point) => cycleSpacePosition(point, model)),
          3,
        ),
      );
      group.add(
        new Points(
          geometry,
          new PointsMaterial({
            color,
            size: 0.055,
            transparent: true,
            opacity: visible ? 0.45 : 0.2,
            sizeAttenuation: true,
          }),
        ),
      );
    }
    if (!series.current) continue;
    const sphere = new Mesh(
      new SphereGeometry(0.12, 16, 12),
      new MeshStandardMaterial({
        color,
        roughness: 0.38,
        metalness: 0.05,
        transparent: true,
        opacity: visible ? 1 : 0.65,
      }),
    );
    sphere.position.set(...cycleSpacePosition(series.current, model));
    sphere.userData["country"] = series.country.id;
    group.add(sphere);
    markers.push(sphere);
    if (selected === series.country.id) {
      const label = spaceLabel(
        series.country.name,
        palette.resolve(series.country.color),
        palette.sans,
        0.25,
      );
      label.position.copy(sphere.position).add(new Vector3(0, 0.35, 0));
      group.add(label);
    }
  }
  return { group, markers };
}
