import type { ArtifactRef, PipelineNode, RuntimeKind } from "@bcr/core";

/**
 * Pipeline DAG 图模型（纯逻辑，无 React）。
 *
 * 设计支点：worker 按类型挑输入（pickInput），不靠位置——所以端口即类型，
 * 连线合法性 = 上游 outputs 与下游 inputs 的 type 交集。
 * compile() 把图编译为 scheduler 已有的 PipelineNode[]（§3 正向编排）。
 */

// ── Operation 目录（由 app 注入，核心不感知具体领域） ────────────────

export interface PortSpec {
  /** artifact type，如 "audio/pcm-f32" / "subtitle/cues"。 */
  readonly type: string;
  readonly label?: string;
}

/** 配置字段的声明式描述：ConfigForm 据此自动生成表单。 */
export interface ConfigField {
  readonly key: string;
  readonly label: string;
  readonly kind: "string" | "number" | "boolean" | "select";
  readonly options?: ReadonlyArray<{ value: string; label: string }>;
  readonly default: unknown;
}

export interface OperationDef {
  readonly operation: string;
  readonly label: string;
  readonly detail: string;
  readonly runtime: RuntimeKind;
  readonly inputs: ReadonlyArray<PortSpec>;
  readonly outputs: ReadonlyArray<PortSpec>;
  readonly config?: ReadonlyArray<ConfigField>;
}

// ── 图 ───────────────────────────────────────────────────────────────

export interface NodeInstance {
  readonly id: string;
  readonly operation: string;
  readonly x: number;
  readonly y: number;
  readonly config: Record<string, unknown>;
}

export interface Edge {
  readonly id: string;
  /** 上游节点 id。 */
  readonly from: string;
  /** 下游节点 id。 */
  readonly to: string;
  /** 这条边承载的 artifact type。 */
  readonly type: string;
}

export interface Graph {
  readonly nodes: ReadonlyArray<NodeInstance>;
  readonly edges: ReadonlyArray<Edge>;
}

/** 节点运行状态投影（任务事件流 → 图）。 */
export interface NodeRunState {
  readonly status: "pending" | "running" | "done" | "cached" | "failed";
  readonly progress: number;
  readonly error?: string | undefined;
}

export const emptyGraph: Graph = { nodes: [], edges: [] };

export function findOperation(
  registry: ReadonlyArray<OperationDef>,
  operation: string,
): OperationDef | undefined {
  return registry.find((op) => op.operation === operation);
}

// ── 图操作（全部纯函数，返回新图） ──────────────────────────────────

export function addNode(graph: Graph, op: OperationDef, id: string, x: number, y: number): Graph {
  const config: Record<string, unknown> = {};
  for (const field of op.config ?? []) config[field.key] = field.default;
  return {
    ...graph,
    nodes: [...graph.nodes, { id, operation: op.operation, x, y, config }],
  };
}

export function moveNode(graph: Graph, id: string, x: number, y: number): Graph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
  };
}

export function updateNodeConfig(graph: Graph, id: string, patch: Record<string, unknown>): Graph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)),
  };
}

export function removeNode(graph: Graph, id: string): Graph {
  return {
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

export function removeEdge(graph: Graph, id: string): Graph {
  return { ...graph, edges: graph.edges.filter((e) => e.id !== id) };
}

/** 上游 → 下游可连的 artifact type 交集（端口即类型）。 */
export function connectableTypes(
  registry: ReadonlyArray<OperationDef>,
  fromOperation: string,
  toOperation: string,
): ReadonlyArray<string> {
  const from = findOperation(registry, fromOperation);
  const to = findOperation(registry, toOperation);
  if (from === undefined || to === undefined) return [];
  const inputTypes = new Set(to.inputs.map((p) => p.type));
  return from.outputs.map((p) => p.type).filter((t) => inputTypes.has(t));
}

/** 新增 from→to 是否成环：沿现有边从 to 出发能回到 from 即成环。 */
export function createsCycle(graph: Graph, from: string, to: string): boolean {
  const downstream = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = downstream.get(e.from) ?? [];
    list.push(e.to);
    downstream.set(e.from, list);
  }
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of downstream.get(id) ?? []) stack.push(next);
  }
  return false;
}

/**
 * 连边：类型不可推导 / 已存在同类型边 / 成环时返回 null。
 * 同一对节点间允许不同类型的多条边（如 decode→translate 的 pcm 与 segment→translate 的 cues）。
 */
export function addEdge(
  graph: Graph,
  registry: ReadonlyArray<OperationDef>,
  from: string,
  to: string,
  type?: string,
): Graph | null {
  if (from === to) return null;
  const fromNode = graph.nodes.find((n) => n.id === from);
  const toNode = graph.nodes.find((n) => n.id === to);
  if (fromNode === undefined || toNode === undefined) return null;

  const types = connectableTypes(registry, fromNode.operation, toNode.operation);
  const edgeType = type ?? types[0];
  if (edgeType === undefined || !types.includes(edgeType)) return null;
  if (createsCycle(graph, from, to)) return null;

  const id = `${from}->${to}:${edgeType}`;
  if (graph.edges.some((e) => e.id === id)) return null;
  return { ...graph, edges: [...graph.edges, { id, from, to, type: edgeType }] };
}

/**
 * 自动连线：新节点与图中现有节点之间，类型唯一可推导时自动建立边。
 * 用于"点击添加节点"的零操作接线。
 */
export function autoWire(
  graph: Graph,
  registry: ReadonlyArray<OperationDef>,
  nodeId: string,
): Graph {
  let next = graph;
  for (const other of graph.nodes) {
    if (other.id === nodeId) continue;
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (node === undefined) break;
    const incoming = connectableTypes(registry, other.operation, node.operation);
    if (incoming.length === 1) {
      next = addEdge(next, registry, other.id, nodeId, incoming[0]) ?? next;
    }
    const outgoing = connectableTypes(registry, node.operation, other.operation);
    if (outgoing.length === 1) {
      next = addEdge(next, registry, nodeId, other.id, outgoing[0]) ?? next;
    }
  }
  return next;
}

// ── 编译：Graph → PipelineNode[] ─────────────────────────────────────

export interface CompileOptions {
  /** 无入边的根节点消费的外部输入（如素材源文件）。 */
  readonly sourceInputs?: ReadonlyArray<ArtifactRef>;
  /** 全局强制重跑：所有节点跳过缓存读写（§7 旁路；一次性动作，非配置）。 */
  readonly skipCache?: boolean;
}

/** 端口类型匹配：支持 "file/*" 这类前缀通配（根节点消费任意 file/xx 源）。 */
function typeMatches(port: string, actual: string): boolean {
  if (port.endsWith("*")) return actual.startsWith(port.slice(0, -1));
  return actual === port;
}

/**
 * 拓扑排序后逐节点生成 PipelineNode：
 * after = 入边的上游节点集合；根节点注入 sourceInputs；config 参与缓存键（§7）。
 * 环 / 未知 operation / 输入未接全（如 editor 里删了边）抛 Error——
 * 在编译期暴露，而不是让 worker 运行到一半才报 missing input。
 */

export function compile(
  graph: Graph,
  registry: ReadonlyArray<OperationDef>,
  options: CompileOptions = {},
): PipelineNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const indegree = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  const downstream = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    const list = downstream.get(e.from) ?? [];
    list.push(e.to);
    downstream.set(e.from, list);
  }

  const queue = graph.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const next of downstream.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (order.length !== graph.nodes.length) {
    throw new Error("pipeline graph has a dependency cycle");
  }

  return order.map((id) => {
    const node = byId.get(id) as NodeInstance;
    const op = findOperation(registry, node.operation);
    if (op === undefined) throw new Error(`unknown operation "${node.operation}"`);

    const after = [...new Set(graph.edges.filter((e) => e.to === id).map((e) => e.from))];

    // 输入覆盖校验：非根节点由入边类型覆盖；根节点由 sourceInputs 覆盖（未提供则跳过）。
    const available =
      after.length > 0
        ? graph.edges.filter((e) => e.to === id).map((e) => e.type)
        : options.sourceInputs?.map((ref) => ref.type);
    if (available !== undefined) {
      const missing = op.inputs.filter((p) => !available.some((t) => typeMatches(p.type, t)));
      if (missing.length > 0) {
        throw new Error(
          `node "${node.id}" (${node.operation}) missing inputs: ${missing
            .map((p) => p.type)
            .join(", ")}`,
        );
      }
    }

    // config 补全目录默认值：旧持久化图缺新字段（如 language）时，
    // 编译产物仍带语义正确的默认，且参与缓存键
    const configWithDefaults: Record<string, unknown> = {};
    for (const field of op.config ?? []) configWithDefaults[field.key] = field.default;
    for (const [key, value] of Object.entries(node.config)) configWithDefaults[key] = value;
    const hasConfig = Object.keys(configWithDefaults).length > 0;
    // 强制重跑：全局 skipCache（一次性）或节点 config.skipCache（长期）→ 跳过缓存读写
    const skipCache = options.skipCache === true || configWithDefaults["skipCache"] === true;
    return {
      id: node.id,
      runtime: op.runtime,
      operation: op.operation,
      ...(after.length > 0 ? { after } : {}),
      ...(after.length === 0 && options.sourceInputs !== undefined
        ? { inputs: [...options.sourceInputs] }
        : {}),
      outputs: op.outputs.map((p) => ({ type: p.type })),
      ...(hasConfig ? { config: configWithDefaults } : {}),
      ...(skipCache ? { cache: { enabled: false } } : {}),
    };
  });
}
