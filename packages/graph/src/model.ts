import type { ArtifactRef, PipelineNode, ResourceRequirements, RuntimeKind } from "@bcr/core";

/**
 * Pipeline DAG 图模型（纯逻辑，无 React）。
 *
 * 设计支点：端口名定义语义身份，type 只负责连线兼容性。
 * 因而同一节点可以安全地拥有多个相同类型的输入/输出。
 * compile() 把图编译为 scheduler 已有的 PipelineNode[]（§3 正向编排）。
 */

// ── Operation 目录（由 app 注入，核心不感知具体领域） ────────────────

export interface PortSpec {
  /** operation 内稳定且唯一的逻辑端口名。 */
  readonly name: string;
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
  readonly resources?: ResourceRequirements;
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
  /** 上游输出端口。旧持久化数据可能缺失，由 compile 按 type 唯一迁移。 */
  readonly fromPort?: string | undefined;
  /** 下游输入端口。旧持久化数据可能缺失，由 compile 按 type 唯一迁移。 */
  readonly toPort?: string | undefined;
  /** 这条边承载的 artifact type。 */
  readonly type: string;
}

export interface PortConnection {
  readonly fromPort: string;
  readonly toPort: string;
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

function typeMatches(port: string, actual: string): boolean {
  if (port.endsWith("*")) return actual.startsWith(port.slice(0, -1));
  return actual === port;
}

/** 上游 → 下游所有兼容的命名端口对。 */
export function connectablePorts(
  registry: ReadonlyArray<OperationDef>,
  fromOperation: string,
  toOperation: string,
): ReadonlyArray<PortConnection> {
  const from = findOperation(registry, fromOperation);
  const to = findOperation(registry, toOperation);
  if (from === undefined || to === undefined) return [];
  return from.outputs.flatMap((output) =>
    to.inputs.flatMap((input) =>
      typeMatches(input.type, output.type)
        ? [{ fromPort: output.name, toPort: input.name, type: output.type }]
        : [],
    ),
  );
}

/** 兼容旧调用方：返回可连端口对承载的唯一 artifact types。 */
export function connectableTypes(
  registry: ReadonlyArray<OperationDef>,
  fromOperation: string,
  toOperation: string,
): ReadonlyArray<string> {
  return [...new Set(connectablePorts(registry, fromOperation, toOperation).map((p) => p.type))];
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
 * 连边：端口不可唯一推导 / 目标端口已占用 / 成环时返回 null。
 * string 参数保留给旧调用方；同类型存在多个候选端口时必须显式传端口对。
 */
export function addEdge(
  graph: Graph,
  registry: ReadonlyArray<OperationDef>,
  from: string,
  to: string,
  selection?: string | Pick<PortConnection, "fromPort" | "toPort">,
): Graph | null {
  if (from === to) return null;
  const fromNode = graph.nodes.find((n) => n.id === from);
  const toNode = graph.nodes.find((n) => n.id === to);
  if (fromNode === undefined || toNode === undefined) return null;

  const ports = connectablePorts(registry, fromNode.operation, toNode.operation);
  const candidates =
    typeof selection === "string"
      ? ports.filter((candidate) => candidate.type === selection)
      : selection === undefined
        ? ports
        : ports.filter(
            (candidate) =>
              candidate.fromPort === selection.fromPort && candidate.toPort === selection.toPort,
          );
  if (candidates.length !== 1) return null;
  const connection = candidates[0] as PortConnection;
  if (createsCycle(graph, from, to)) return null;

  const id = `${from}.${connection.fromPort}->${to}.${connection.toPort}`;
  if (
    graph.edges.some(
      (edge) =>
        edge.id === id ||
        (edge.to === to &&
          (edge.toPort === connection.toPort ||
            (edge.toPort === undefined && edge.type === connection.type))),
    )
  ) {
    return null;
  }
  return {
    ...graph,
    edges: [
      ...graph.edges,
      {
        id,
        from,
        to,
        fromPort: connection.fromPort,
        toPort: connection.toPort,
        type: connection.type,
      },
    ],
  };
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
    const incoming = connectablePorts(registry, other.operation, node.operation);
    if (incoming.length === 1) {
      next = addEdge(next, registry, other.id, nodeId, incoming[0]) ?? next;
    }
    const outgoing = connectablePorts(registry, node.operation, other.operation);
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

interface ResolvedEdge extends Edge {
  readonly fromPort: string;
  readonly toPort: string;
}

/** 旧边仅有 type：候选唯一时自动补端口，多候选时拒绝猜测。 */
function resolveEdge(
  edge: Edge,
  byId: ReadonlyMap<string, NodeInstance>,
  registry: ReadonlyArray<OperationDef>,
): ResolvedEdge | undefined {
  const fromNode = byId.get(edge.from);
  const toNode = byId.get(edge.to);
  if (fromNode === undefined || toNode === undefined) return undefined;
  const ports = connectablePorts(registry, fromNode.operation, toNode.operation);
  if (edge.fromPort !== undefined || edge.toPort !== undefined) {
    if (edge.fromPort === undefined || edge.toPort === undefined) {
      throw new Error(`edge "${edge.id}" has incomplete port metadata`);
    }
    const exact = ports.find(
      (port) => port.fromPort === edge.fromPort && port.toPort === edge.toPort,
    );
    if (exact === undefined) throw new Error(`edge "${edge.id}" references incompatible ports`);
    return { ...edge, ...exact };
  }
  const candidates = ports.filter((port) => port.type === edge.type);
  if (candidates.length > 1) {
    throw new Error(`legacy edge "${edge.id}" is ambiguous; reconnect it to a named port`);
  }
  const inferred = candidates[0];
  return inferred === undefined ? undefined : { ...edge, ...inferred };
}

function bindSourceInputs(
  node: NodeInstance,
  op: OperationDef,
  inputs: ReadonlyArray<ArtifactRef>,
): ReadonlyArray<ArtifactRef> {
  const used = new Set<number>();
  return op.inputs.map((port) => {
    const index = inputs.findIndex(
      (ref, candidate) =>
        !used.has(candidate) &&
        (ref.port === undefined ? typeMatches(port.type, ref.type) : ref.port === port.name),
    );
    const ref = inputs[index];
    if (index < 0 || ref === undefined || !typeMatches(port.type, ref.type)) {
      throw new Error(`node "${node.id}" (${node.operation}) missing inputs: ${port.name}`);
    }
    used.add(index);
    return { ...ref, port: port.name };
  });
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
  const resolvedEdges = graph.edges.flatMap((edge) => {
    const resolved = resolveEdge(edge, byId, registry);
    return resolved === undefined ? [] : [resolved];
  });
  const indegree = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  const downstream = new Map<string, string[]>();
  for (const e of resolvedEdges) {
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

    const incoming = resolvedEdges.filter((edge) => edge.to === id);
    const duplicateInput = op.inputs.find(
      (port) => incoming.filter((edge) => edge.toPort === port.name).length > 1,
    );
    if (duplicateInput !== undefined) {
      throw new Error(
        `node "${node.id}" (${node.operation}) has multiple edges for input: ${duplicateInput.name}`,
      );
    }
    const after = [...new Set(incoming.map((edge) => edge.from))];
    const missing = op.inputs.filter((port) => !incoming.some((edge) => edge.toPort === port.name));
    const sourceInputs =
      after.length === 0 && options.sourceInputs !== undefined
        ? bindSourceInputs(node, op, options.sourceInputs)
        : undefined;
    if (after.length > 0 && missing.length > 0) {
      throw new Error(
        `node "${node.id}" (${node.operation}) missing inputs: ${missing
          .map((port) => port.name)
          .join(", ")}`,
      );
    }
    const bindings = op.inputs.flatMap((port) => {
      const edge = incoming.find((candidate) => candidate.toPort === port.name);
      return edge === undefined
        ? []
        : [{ from: edge.from, output: edge.fromPort, input: edge.toPort }];
    });

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
      ...(bindings.length > 0 ? { bindings } : {}),
      ...(sourceInputs !== undefined ? { inputs: sourceInputs } : {}),
      outputs: op.outputs.map((port) => ({ name: port.name, type: port.type })),
      ...(op.resources !== undefined ? { resources: op.resources } : {}),
      ...(hasConfig ? { config: configWithDefaults } : {}),
      ...(skipCache ? { cache: { enabled: false } } : {}),
    };
  });
}
