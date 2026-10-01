import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

export const DIAGRAM_INDEX = "workspace/diagrams.index.v1";
export const diagramKey = (id: string) => `workspace/diagrams/${id}.v1`;
export const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id);
export const MAX_ELEMENTS = 10000;
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

export interface DiagramScene {
  elements: readonly ExcalidrawElement[];
  appState: Pick<AppState, "viewBackgroundColor" | "gridSize">;
  files: BinaryFiles;
}
export interface DiagramSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  revision: string;
}
export interface DiagramDocument extends DiagramSummary {
  version: 1;
  scene: DiagramScene;
  creationKey?: string;
}
export const emptyScene = (): DiagramScene => ({
  elements: [],
  appState: { viewBackgroundColor: "#ffffff", gridSize: 20 },
  files: {},
});
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("图表数据无效");
  return value as Record<string, unknown>;
}
export function decodeSummary(value: unknown): DiagramSummary {
  const item = record(value);
  if (
    !validId(item.id) ||
    typeof item.title !== "string" ||
    !item.title.trim() ||
    item.title.length > 200 ||
    typeof item.revision !== "string" ||
    !item.revision ||
    typeof item.createdAt !== "number" ||
    !Number.isFinite(item.createdAt) ||
    typeof item.updatedAt !== "number" ||
    !Number.isFinite(item.updatedAt)
  )
    throw new Error("图表索引损坏，原数据已保留");
  return {
    id: item.id,
    title: item.title,
    revision: item.revision,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
export function decodeIndex(raw: string | undefined): DiagramSummary[] {
  if (raw === undefined) return [];
  const data = record(JSON.parse(raw));
  if (data.version !== 1 || !Array.isArray(data.items))
    throw new Error("图表索引版本不支持，原数据已保留");
  const items = data.items.map(decodeSummary);
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("图表 ID 重复");
  return items;
}
export function decodeScene(value: unknown): DiagramScene {
  const scene = record(value);
  if (!Array.isArray(scene.elements) || scene.elements.length > MAX_ELEMENTS)
    throw new Error(`画布最多支持 ${MAX_ELEMENTS} 个元素`);
  const ids = new Set<string>();
  const types = new Set([
    "rectangle",
    "ellipse",
    "diamond",
    "text",
    "arrow",
    "line",
    "freedraw",
    "image",
    "frame",
    "magicframe",
    "embeddable",
    "iframe",
  ]);
  for (const value of scene.elements) {
    const element = record(value);
    if (
      typeof element.id !== "string" ||
      !element.id ||
      ids.has(element.id) ||
      typeof element.type !== "string" ||
      !types.has(element.type) ||
      ![element.x, element.y, element.width, element.height, element.angle, element.version].every(
        (n) => typeof n === "number" && Number.isFinite(n),
      )
    )
      throw new Error("画布包含无效或重复的元素");
    if (element.type === "text" && typeof element.text !== "string")
      throw new Error("画布文字无效");
    if (
      ["arrow", "line", "freedraw"].includes(element.type) &&
      (!Array.isArray(element.points) ||
        !element.points.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every(
              (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate),
            ),
        ))
    )
      throw new Error("画布线条包含无效的坐标");
    ids.add(element.id);
  }
  const appState = record(scene.appState ?? {}),
    files = record(scene.files ?? {});
  if (
    appState.viewBackgroundColor !== undefined &&
    (typeof appState.viewBackgroundColor !== "string" || appState.viewBackgroundColor.length > 100)
  )
    throw new Error("画布背景无效");
  if (
    appState.gridSize !== undefined &&
    appState.gridSize !== null &&
    (typeof appState.gridSize !== "number" ||
      !Number.isFinite(appState.gridSize) ||
      appState.gridSize < 1)
  )
    throw new Error("网格大小无效");
  for (const [id, value] of Object.entries(files)) {
    const file = record(value);
    if (
      file.id !== id ||
      typeof file.dataURL !== "string" ||
      !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(file.dataURL) ||
      typeof file.mimeType !== "string"
    )
      throw new Error("图片附件无效，仅支持内嵌图片");
  }
  return {
    elements: scene.elements as ExcalidrawElement[],
    appState: {
      viewBackgroundColor:
        typeof appState.viewBackgroundColor === "string" ? appState.viewBackgroundColor : "#ffffff",
      gridSize: typeof appState.gridSize === "number" ? appState.gridSize : 20,
    },
    files: files as BinaryFiles,
  };
}
export function decodeDocument(raw: string): DiagramDocument {
  if (raw.length > MAX_FILE_BYTES) throw new Error("图表超过 30 MB，请拆分画布或压缩图片");
  const value = record(JSON.parse(raw));
  if (value.version !== 1) throw new Error("图表版本不支持，原数据已保留");
  const scene = decodeScene(value.scene);
  return {
    ...decodeSummary(value),
    version: 1,
    scene,
    ...(typeof value.creationKey === "string" ? { creationKey: value.creationKey } : {}),
  };
}
export function summary(document: DiagramDocument): DiagramSummary {
  const { id, title, revision, createdAt, updatedAt } = document;
  return { id, title, revision, createdAt, updatedAt };
}
export function nativeFile(document: DiagramDocument): string {
  return JSON.stringify(
    { type: "excalidraw", version: 2, source: "BCR", ...document.scene },
    null,
    2,
  );
}

/** The engine's current scene is authoritative; this is a derived, bounded AI projection. */
export function describeScene(scene: DiagramScene) {
  const live = scene.elements.filter((element) => !element.isDeleted);
  const text = new Map(
    live
      .filter(
        (element): element is ExcalidrawTextElement =>
          element.type === "text" && !!element.containerId,
      )
      .map((element) => [element.containerId, element]),
  );
  return live
    .filter((element) => element.type !== "text" || !element.containerId)
    .map((element) => ({
      id: element.id,
      type: element.type,
      label:
        element.type === "text" ? element.originalText : (text.get(element.id)?.originalText ?? ""),
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      locked: !!element.locked,
      ...(element.frameId ? { frameId: element.frameId } : {}),
      ...(element.type === "arrow" || element.type === "line"
        ? {
            source: element.startBinding?.elementId ?? null,
            target: element.endBinding?.elementId ?? null,
          }
        : {}),
      ...(element.link ? { link: element.link } : {}),
    }));
}
