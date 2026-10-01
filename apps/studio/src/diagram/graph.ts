import { record, validId } from "./model";

export interface GraphNode {
  id: string;
  label: string;
  type: "rectangle" | "ellipse" | "diamond";
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  strokeColor?: string;
  backgroundColor?: string;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}
export interface DiagramGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  direction: "RIGHT" | "DOWN";
}
export function color(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}
export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1000000;
}
export function parseGraph(value: unknown): DiagramGraph {
  const graph = record(value);
  if (Object.keys(graph).some((key) => !["nodes", "edges", "direction"].includes(key)))
    throw new Error("包含不支持的图形字段");
  if (
    !Array.isArray(graph.nodes) ||
    graph.nodes.length > 500 ||
    !Array.isArray(graph.edges ?? []) ||
    ((graph.edges ?? []) as unknown[]).length > 2000
  )
    throw new Error("单次生成最多支持 500 个节点和 2000 条连接");
  const ids = new Set<string>();
  const nodes = graph.nodes.map((value): GraphNode => {
    const node = record(value);
    if (
      Object.keys(node).some(
        (key) =>
          ![
            "id",
            "label",
            "type",
            "width",
            "height",
            "x",
            "y",
            "strokeColor",
            "backgroundColor",
          ].includes(key),
      ) ||
      !validId(node.id) ||
      ids.has(node.id) ||
      typeof node.label !== "string" ||
      node.label.length > 4000 ||
      (node.type !== undefined &&
        (typeof node.type !== "string" || !["rectangle", "ellipse", "diamond"].includes(node.type)))
    )
      throw new Error("节点 ID、文字或形状无效");
    ids.add(node.id);
    for (const key of ["x", "y", "width", "height"])
      if (
        node[key] !== undefined &&
        (!finite(node[key]) || (["width", "height"].includes(key) && (node[key] as number) < 20))
      )
        throw new Error("节点尺寸或位置无效");
    for (const key of ["strokeColor", "backgroundColor"])
      if (node[key] !== undefined && !color(node[key]))
        throw new Error("颜色必须是六位十六进制色值");
    return { ...node, type: node.type ?? "rectangle" } as unknown as GraphNode;
  });
  const edges = ((graph.edges ?? []) as unknown[]).map((value): GraphEdge => {
    const edge = record(value);
    if (
      Object.keys(edge).some((key) => !["id", "source", "target", "label"].includes(key)) ||
      !validId(edge.id) ||
      ids.has(edge.id) ||
      !validId(edge.source) ||
      !validId(edge.target) ||
      !nodes.some((node) => node.id === edge.source) ||
      !nodes.some((node) => node.id === edge.target) ||
      (edge.label !== undefined && (typeof edge.label !== "string" || edge.label.length > 4000))
    )
      throw new Error("连接 ID 或端点无效");
    ids.add(edge.id);
    return edge as unknown as GraphEdge;
  });
  if (graph.direction !== undefined && graph.direction !== "RIGHT" && graph.direction !== "DOWN")
    throw new Error("布局方向无效");
  if ([...nodes, ...edges].some((item) => ids.has(`label-${item.id}`)))
    throw new Error("元素 ID 与自动生成的文字标签冲突，请使用不同的 ID");
  return { nodes, edges, direction: graph.direction ?? "RIGHT" } as DiagramGraph;
}
export function nodeSize(node: GraphNode) {
  const lines = node.label.split("\n");
  const length = Math.max(
    1,
    ...lines.map((line) => {
      let width = 0;
      for (const { segment } of new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(line))
        width += (segment.codePointAt(0) ?? 0) > 255 ? 1 : 0.55;
      return width;
    }),
  );
  const width = node.width ?? Math.max(160, Math.min(440, length * 19 + 48));
  const height =
    node.height ?? Math.max(76, Math.ceil((length * 19) / (width - 36)) * lines.length * 25 + 30);
  return {
    width: node.type === "diamond" ? Math.max(width, 200) : width,
    height: node.type === "diamond" ? Math.max(height, 120) : height,
  };
}
export async function layoutGraph(graph: DiagramGraph) {
  const [{ default: ELK }, { default: workerUrl }] = await Promise.all([
    import("elkjs/lib/elk-api.js"),
    import("elkjs/lib/elk-worker.min.js?url"),
  ]);
  const worker = new Worker(workerUrl);
  const elk = new ELK({ workerFactory: () => worker });
  try {
    const result = await elk.layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": graph.direction,
        "elk.spacing.nodeNode": "48",
        "elk.layered.spacing.nodeNodeBetweenLayers": "100",
        "elk.edgeRouting": "ORTHOGONAL",
      },
      children: graph.nodes.map((node) => ({ id: node.id, ...nodeSize(node) })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
    });
    return new Map(
      (result.children ?? []).map((node) => [
        node.id,
        { x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 160, height: node.height ?? 76 },
      ]),
    );
  } finally {
    worker.terminate();
  }
}
