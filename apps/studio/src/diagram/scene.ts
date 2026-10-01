import "./assets";
import {
  convertToExcalidrawElements,
  newElementWith,
  restoreElements,
  exportToSvg,
  exportToBlob,
  loadFromBlob,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import {
  color,
  finite,
  layoutGraph,
  nodeSize,
  parseGraph,
  type DiagramGraph,
  type GraphEdge,
  type GraphNode,
} from "./graph";
import {
  decodeScene,
  describeScene,
  emptyScene,
  record,
  MAX_ELEMENTS,
  MAX_FILE_BYTES,
  type DiagramScene,
} from "./model";

const FONT = 2;
const STROKE = "#26423f";
const FILL = "#e9f3f0";
const labelFor = (id: string, text: string, fontSize = 18, strokeColor = STROKE) => ({
  id,
  text,
  fontSize,
  fontFamily: FONT,
  strokeColor,
});
const nodeSkeleton = (node: GraphNode): ExcalidrawElementSkeleton => ({
  ...nodeSize(node),
  x: node.x ?? 0,
  y: node.y ?? 0,
  id: node.id,
  type: node.type,
  strokeColor: node.strokeColor ?? STROKE,
  backgroundColor: node.backgroundColor ?? FILL,
  fillStyle: "solid",
  strokeWidth: 1.5,
  roughness: 0,
  roundness: node.type === "rectangle" ? { type: 3 } : null,
  label: labelFor(`label-${node.id}`, node.label, 18, node.strokeColor ?? STROKE),
});

/** New arrows bind to native elements, including reciprocal binding references. */
function addEdges(
  elements: readonly ExcalidrawElement[],
  edges: readonly GraphEdge[],
): ExcalidrawElement[] {
  let current = [...elements];
  for (const edge of edges) {
    const source = current.find((element) => element.id === edge.source && !element.isDeleted);
    const target = current.find((element) => element.id === edge.target && !element.isDeleted);
    if (
      !source ||
      !target ||
      !["rectangle", "ellipse", "diamond", "text"].includes(source.type) ||
      !["rectangle", "ellipse", "diamond", "text"].includes(target.type)
    )
      throw new Error("连接端点必须是存在的形状或文字");
    if (source.id === target.id) throw new Error("自连接请在画布上手动绘制");
    if (current.some((element) => element.id === edge.id || element.id === `label-${edge.id}`))
      throw new Error(`元素 ID 已存在：${edge.id}`);
    const sx = source.x + source.width / 2,
      sy = source.y + source.height / 2;
    const tx = target.x + target.width / 2,
      ty = target.y + target.height / 2;
    const horizontal = Math.abs(tx - sx) >= Math.abs(ty - sy);
    const start = horizontal
      ? [sx + Math.sign(tx - sx || 1) * (source.width / 2 + 8), sy]
      : [sx, sy + Math.sign(ty - sy || 1) * (source.height / 2 + 8)];
    const end = horizontal
      ? [tx - Math.sign(tx - sx || 1) * (target.width / 2 + 8), ty]
      : [tx, ty - Math.sign(ty - sy || 1) * (target.height / 2 + 8)];
    const x = start[0]!,
      y = start[1]!,
      dx = end[0]! - x,
      dy = end[1]! - y;
    const converted = convertToExcalidrawElements(
      [
        source as ExcalidrawElementSkeleton,
        target as ExcalidrawElementSkeleton,
        {
          id: edge.id,
          type: "arrow",
          x,
          y,
          points: [
            [0, 0],
            [dx, dy],
          ] as never,
          strokeColor: STROKE,
          strokeWidth: 1.5,
          roughness: 0,
          start: { id: source.id },
          end: { id: target.id },
          ...(edge.label ? { label: labelFor(`label-${edge.id}`, edge.label, 15) } : {}),
        },
      ],
      { regenerateIds: false },
    );
    const additions = converted.filter(
      (element) => element.id !== source.id && element.id !== target.id,
    );
    current = current.map((element) =>
      element.id === source.id || element.id === target.id
        ? newElementWith(element, {
            boundElements: [
              ...(element.boundElements ?? []),
              { id: edge.id, type: "arrow" as const },
            ],
          })
        : element,
    );
    current.push(...additions);
  }
  return current;
}
export async function createGraph(
  value: unknown,
  origin = { x: 80, y: 80 },
): Promise<DiagramScene> {
  const graph = parseGraph(value),
    positions = await layoutGraph(graph);
  const nodes = graph.nodes.map((node) => ({
    ...node,
    ...positions.get(node.id),
    x: (node.x ?? positions.get(node.id)?.x ?? 0) + origin.x,
    y: (node.y ?? positions.get(node.id)?.y ?? 0) + origin.y,
  }));
  const elements = convertToExcalidrawElements(nodes.map(nodeSkeleton), { regenerateIds: false });
  return decodeScene({ ...emptyScene(), elements: addEdges(elements, graph.edges) });
}
export async function importMermaid(
  source: string,
  origin = { x: 80, y: 80 },
): Promise<DiagramScene> {
  if (!source.trim() || source.length > 50000)
    throw new Error("Mermaid 内容为空或超过 50,000 字符");
  const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
  const result = await parseMermaidToExcalidraw(source);
  if (result.elements.some((element) => element.type === "image"))
    throw new Error("此 Mermaid 图形只能生成图片，请使用流程图或节点与连接生成可编辑图形");
  const skeletons = result.elements.map((element) => ({
    ...element,
    ...(element.type === "text" ? { fontFamily: FONT } : {}),
    ...("label" in element && element.label
      ? { label: { ...element.label, fontFamily: FONT } }
      : {}),
  }));
  const elements = convertToExcalidrawElements(skeletons, { regenerateIds: true }).map((element) =>
    newElementWith(element, { x: element.x + origin.x, y: element.y + origin.y, roughness: 0 }),
  );
  return decodeScene({ ...emptyScene(), elements, files: result.files ?? {} });
}
export interface DiagramPatch {
  addNodes?: GraphNode[];
  addEdges?: GraphEdge[];
  update?: Record<string, unknown>[];
  remove?: string[];
}
export function parsePatch(value: unknown): DiagramPatch {
  const patch = record(value);
  if (Object.keys(patch).some((key) => !["addNodes", "addEdges", "update", "remove"].includes(key)))
    throw new Error("包含不支持的修改字段");
  if (!Object.values(patch).some((value) => Array.isArray(value) && value.length))
    throw new Error("请提供要修改的元素");
  for (const value of Object.values(patch))
    if (!Array.isArray(value) || value.length > 500) throw new Error("单次最多修改 500 个元素");
  const nodes = parseGraph({ nodes: patch.addNodes ?? [], edges: [] }).nodes;
  const edges = ((patch.addEdges ?? []) as unknown[]).map((value) => {
    const edge = record(value);
    if (
      Object.keys(edge).some((key) => !["id", "source", "target", "label"].includes(key)) ||
      ![edge.id, edge.source, edge.target].every(
        (id) => typeof id === "string" && id.length > 0 && id.length <= 200,
      ) ||
      (edge.label !== undefined && (typeof edge.label !== "string" || edge.label.length > 4000))
    )
      throw new Error("新增连接无效");
    return edge as unknown as GraphEdge;
  });
  const update = ((patch.update ?? []) as unknown[]).map((value) => {
    const change = record(value);
    if (
      typeof change.id !== "string" ||
      Object.keys(change).some(
        (key) =>
          ![
            "id",
            "label",
            "x",
            "y",
            "width",
            "height",
            "strokeColor",
            "backgroundColor",
            "source",
            "target",
          ].includes(key),
      )
    )
      throw new Error("修改字段无效");
    for (const key of ["label", "source", "target"])
      if (
        change[key] !== undefined &&
        (typeof change[key] !== "string" || (change[key] as string).length > 4000)
      )
        throw new Error("文字或连接端点无效");
    for (const key of ["x", "y", "width", "height"])
      if (
        change[key] !== undefined &&
        (!finite(change[key]) ||
          (["width", "height"].includes(key) && (change[key] as number) < 20))
      )
        throw new Error("位置或尺寸无效");
    for (const key of ["strokeColor", "backgroundColor"])
      if (change[key] !== undefined && !color(change[key]))
        throw new Error("颜色必须是六位十六进制色值");
    return change;
  });
  const remove = (patch.remove ?? []) as unknown[];
  if (!remove.every((id) => typeof id === "string" && id)) throw new Error("删除元素 ID 无效");
  const operationIds = [
    ...nodes.map((n) => n.id),
    ...edges.map((e) => e.id),
    ...update.map((u) => u.id),
    ...remove,
  ];
  if (new Set(operationIds).size !== operationIds.length)
    throw new Error("同一批修改不能重复操作相同的元素");
  return { addNodes: nodes, addEdges: edges, update, remove: remove as string[] };
}
function changeLabel(
  elements: ExcalidrawElement[],
  id: string,
  label: string,
): ExcalidrawElement[] {
  const element = elements.find((element) => element.id === id)!;
  const previous = elements.find((item) => item.type === "text" && item.containerId === id) as
    | ExcalidrawTextElement
    | undefined;
  if (previous?.locked) throw new Error("文字标签已锁定，请先解锁");
  if (element.type === "text") {
    const { width: _width, height: _height, ...textElement } = element;
    const [text] = convertToExcalidrawElements(
      [{ ...textElement, text: label, originalText: label }],
      { regenerateIds: false },
    );
    return elements.map((item) => (item.id === id ? newElementWith(item, text!) : item));
  }
  if (!["rectangle", "ellipse", "diamond", "arrow"].includes(element.type))
    throw new Error("此元素不支持文字标签");
  if (!label)
    return elements
      .filter((item) => item.id !== previous?.id)
      .map((item) =>
        item.id === id
          ? newElementWith(item, {
              boundElements: (item.boundElements ?? []).filter(
                (bound) => bound.id !== previous?.id,
              ),
            })
          : item,
      );
  const converted = convertToExcalidrawElements(
    [
      {
        ...element,
        boundElements: (element.boundElements ?? []).filter((bound) => bound.type !== "text"),
        label: {
          ...previous,
          id: previous?.id ?? `label-${id}`,
          text: label,
          originalText: label,
          fontSize: previous?.fontSize ?? 18,
          fontFamily: previous?.fontFamily ?? FONT,
          strokeColor: previous?.strokeColor ?? STROKE,
        },
      } as unknown as ExcalidrawElementSkeleton,
    ],
    { regenerateIds: false },
  );
  const text = converted.find((item) => item.type === "text")!;
  const container = converted.find((item) => item.id === id)!;
  const result = elements
    .filter((item) => item.id !== previous?.id)
    .map((item) =>
      item.id === id
        ? newElementWith(item, {
            width: container.width,
            height: container.height,
            boundElements: container.boundElements,
          })
        : item,
    );
  result.push(previous ? newElementWith(previous, text) : text);
  return result;
}
function removeElements(elements: ExcalidrawElement[], ids: readonly string[]) {
  const removed = new Set(ids);
  for (const id of ids)
    if (!elements.some((element) => element.id === id && !element.isDeleted))
      throw new Error(`元素不存在：${id}`);
  // Delete attached labels and connectors, then their labels; no orphan bindings survive.
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const element of elements) {
      if (
        (element.type === "text" && element.containerId && removed.has(element.containerId)) ||
        ((element.type === "arrow" || element.type === "line") &&
          ((element.startBinding && removed.has(element.startBinding.elementId)) ||
            (element.endBinding && removed.has(element.endBinding.elementId))))
      ) {
        if (!removed.has(element.id)) {
          removed.add(element.id);
          expanded = true;
        }
      }
    }
  }
  if (elements.some((element) => removed.has(element.id) && element.locked))
    throw new Error("删除范围包含锁定的元素，请先解锁");
  return elements
    .filter((element) => !removed.has(element.id))
    .map((element) => {
      const bounds = element.boundElements?.filter((bound) => !removed.has(bound.id));
      return bounds && bounds.length !== element.boundElements?.length
        ? newElementWith(element, { boundElements: bounds })
        : element;
    });
}
function reroute(elements: ExcalidrawElement[], moved: Set<string>, rerouted = new Set<string>()) {
  const edges = elements.filter(
    (element) =>
      element.type === "arrow" &&
      element.startBinding &&
      element.endBinding &&
      (rerouted.has(element.id) ||
        moved.has(element.startBinding.elementId) ||
        moved.has(element.endBinding.elementId)),
  );
  for (const edge of edges) {
    if (edge.type !== "arrow") continue;
    if (edge.locked) throw new Error("连接已锁定，请先解锁再调整相连节点");
    const previousLabel = elements.find(
      (element) => element.type === "text" && element.containerId === edge.id,
    );
    if (previousLabel?.locked) throw new Error("连接标签已锁定，请先解锁");
    const original = new Map(elements.map((element) => [element.id, element]));
    const spec = {
      id: edge.id,
      source: edge.startBinding!.elementId,
      target: edge.endBinding!.elementId,
      ...(previousLabel?.type === "text" ? { label: previousLabel.originalText } : {}),
    };
    elements = addEdges(
      elements
        .filter((element) => element.id !== edge.id && element.id !== previousLabel?.id)
        .map((element) =>
          element.boundElements?.some((bound) => bound.id === edge.id)
            ? newElementWith(element, {
                boundElements: element.boundElements.filter((bound) => bound.id !== edge.id),
              })
            : element,
        ),
      [spec],
    );
    elements = elements.map((element) => {
      if (element.id === edge.id && element.type === "arrow")
        return newElementWith(edge, {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          points: element.points,
          startBinding: element.startBinding,
          endBinding: element.endBinding,
          boundElements:
            element.boundElements?.map((bound) =>
              previousLabel && bound.type === "text" ? { ...bound, id: previousLabel.id } : bound,
            ) ?? null,
        });
      if (
        element.id === `label-${edge.id}` &&
        previousLabel?.type === "text" &&
        element.type === "text"
      ) {
        return newElementWith(previousLabel, {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
        });
      }
      return original.get(element.id) &&
        !moved.has(element.id) &&
        !original.get(element.id)?.boundElements?.some((bound) => bound.id === edge.id) &&
        !element.boundElements?.some((bound) => bound.id === edge.id)
        ? original.get(element.id)!
        : element;
    });
  }
  return elements;
}
export async function patchScene(scene: DiagramScene, value: unknown): Promise<DiagramScene> {
  const patch = parsePatch(value);
  let elements = [...scene.elements];
  if (patch.remove?.length) elements = removeElements(elements, patch.remove);
  if (patch.addNodes?.length) {
    const existing = new Set(elements.map((element) => element.id));
    if (patch.addNodes.some((node) => existing.has(node.id) || existing.has(`label-${node.id}`)))
      throw new Error("新增节点 ID 已存在");
    const right = Math.max(
      0,
      ...elements
        .filter((element) => !element.isDeleted)
        .map((element) => element.x + element.width),
    );
    const created = await createGraph(
      { nodes: patch.addNodes, edges: [] },
      { x: right + 80, y: 80 },
    );
    elements.push(...created.elements);
  }
  const moved = new Set<string>();
  const rerouted = new Set<string>();
  for (const change of patch.update ?? []) {
    const element = elements.find((element) => element.id === change.id && !element.isDeleted);
    if (!element) throw new Error(`元素不存在：${change.id as string}`);
    if (element.locked) throw new Error(`元素已锁定：${element.id}`);
    if (change.source !== undefined || change.target !== undefined) {
      if (element.type !== "arrow" || !element.startBinding || !element.endBinding)
        throw new Error("仅支持修改已绑定箭头的端点");
      elements = elements.map((item) =>
        item.id === element.id
          ? newElementWith(element, {
              startBinding: {
                ...element.startBinding!,
                elementId:
                  typeof change.source === "string"
                    ? change.source
                    : element.startBinding!.elementId,
              },
              endBinding: {
                ...element.endBinding!,
                elementId:
                  typeof change.target === "string" ? change.target : element.endBinding!.elementId,
              },
            })
          : item,
      );
      rerouted.add(element.id);
    }
    const geometry = Object.fromEntries(
      ["x", "y", "width", "height", "strokeColor", "backgroundColor"]
        .filter((key) => change[key] !== undefined)
        .map((key) => [key, change[key]]),
    );
    if (Object.keys(geometry).length) {
      if (
        ["arrow", "line", "freedraw"].includes(element.type) &&
        ["width", "height"].some((key) => change[key] !== undefined)
      )
        throw new Error("连接和自由线条请通过端点或布局修改尺寸");
      const dx = typeof change.x === "number" ? change.x - element.x : 0,
        dy = typeof change.y === "number" ? change.y - element.y : 0;
      elements = elements.map((item) =>
        item.id === element.id
          ? newElementWith(item, geometry)
          : item.type === "text" && item.containerId === element.id
            ? newElementWith(item, { x: item.x + dx, y: item.y + dy })
            : item,
      );
      moved.add(element.id);
    }
    const resized = change.width !== undefined || change.height !== undefined;
    const boundLabel = elements.find(
      (item) => item.type === "text" && item.containerId === element.id,
    );
    if (typeof change.label === "string" || (resized && boundLabel?.type === "text")) {
      elements = changeLabel(
        elements,
        element.id,
        typeof change.label === "string"
          ? change.label
          : boundLabel!.type === "text"
            ? boundLabel!.originalText
            : "",
      );
      moved.add(element.id);
    }
  }
  elements = reroute(elements, moved, rerouted);
  elements = addEdges(elements, patch.addEdges ?? []);
  if (elements.length > MAX_ELEMENTS) throw new Error("画布元素过多，请拆分图表");
  return decodeScene({ ...scene, elements });
}
export async function layoutScene(
  scene: DiagramScene,
  ids: readonly string[] = [],
  direction: "RIGHT" | "DOWN" = "RIGHT",
): Promise<DiagramScene> {
  const selection = new Set(ids);
  const nodes = scene.elements.filter(
    (element) =>
      !element.isDeleted &&
      !element.locked &&
      !element.frameId &&
      ["rectangle", "ellipse", "diamond"].includes(element.type) &&
      (!selection.size || selection.has(element.id)),
  );
  if (!nodes.length) throw new Error("请选择需要整理的矩形、圆形或菱形节点");
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (
    scene.elements.some(
      (element) =>
        element.type === "text" &&
        element.containerId &&
        nodeIds.has(element.containerId) &&
        element.locked,
    )
  )
    throw new Error("文字标签已锁定，请先解锁");
  const projection = describeScene(scene);
  const graph: DiagramGraph = {
    direction,
    nodes: nodes.map((node) => ({
      id: node.id,
      label: "",
      type: node.type as GraphNode["type"],
      width: node.width,
      height: node.height,
    })),
    edges: projection
      .filter(
        (item) =>
          item.type === "arrow" &&
          item.source &&
          item.target &&
          nodeIds.has(item.source) &&
          nodeIds.has(item.target),
      )
      .map((item) => ({ id: item.id, source: item.source!, target: item.target! })),
  };
  const positions = await layoutGraph(graph);
  const origin = {
    x: Math.min(...nodes.map((node) => node.x)),
    y: Math.min(...nodes.map((node) => node.y)),
  };
  const elements = scene.elements.map((element) => {
    const node =
      element.type === "text" && element.containerId
        ? nodes.find((node) => node.id === element.containerId)
        : nodes.find((node) => node.id === element.id);
    const position = node && positions.get(node.id);
    return node && position
      ? newElementWith(element, {
          x: element.x + position.x + origin.x - node.x,
          y: element.y + position.y + origin.y - node.y,
        })
      : element;
  });
  return decodeScene({ ...scene, elements: reroute(elements, nodeIds) });
}
export async function importFile(file: File): Promise<DiagramScene> {
  if (file.size > MAX_FILE_BYTES) throw new Error("文件超过 30 MB，请拆分画布或压缩图片");
  const value = record(JSON.parse(await file.text()));
  if (value.type !== "excalidraw") throw new Error("请选择 .excalidraw 文件");
  // Validate before restoring; never silently discard an invalid file.
  decodeScene(value);
  const result = await loadFromBlob(file, null, null);
  return decodeScene(result);
}
export async function renderSvg(
  scene: DiagramScene,
  selection: readonly string[] = [],
  skipFonts = false,
): Promise<string> {
  const ids = new Set(selection);
  const elements = scene.elements.filter(
    (element) =>
      !element.isDeleted &&
      (!ids.size ||
        ids.has(element.id) ||
        (element.type === "text" && element.containerId && ids.has(element.containerId))),
  );
  if (!elements.length) throw new Error("画布为空，暂无可导出的内容");
  const svg = await exportToSvg({
    elements: elements as never,
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false },
    files: scene.files,
    exportPadding: 32,
    ...(skipFonts ? { skipInliningFonts: true as const } : {}),
  });
  return new XMLSerializer().serializeToString(svg);
}
export async function renderPng(scene: DiagramScene): Promise<Blob> {
  const elements = scene.elements.filter((element) => !element.isDeleted);
  if (!elements.length) throw new Error("画布为空，暂无可导出的内容");
  return exportToBlob({
    elements: elements as never,
    appState: { ...scene.appState, exportBackground: true },
    files: scene.files,
    maxWidthOrHeight: 4096,
    exportPadding: 32,
  });
}
export const normalizeScene = (scene: DiagramScene) => ({
  ...scene,
  elements: restoreElements(scene.elements, null, {
    repairBindings: true,
    refreshDimensions: true,
  }),
});
