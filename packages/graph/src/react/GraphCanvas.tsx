import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Graph, NodeRunState, OperationDef } from "../model";
import { addEdge, findOperation, moveNode, removeEdge, removeNode } from "../model";

/**
 * Pipeline DAG 画布（跨 app 复用，样式只依赖 --color-* 设计变量）。
 *
 * 交互：
 * - 拖动节点（标题栏/卡片体）；拖动空白处平移；
 * - 从输出端口拖线到输入端口连线，类型不匹配的端口不响应；
 * - 点击选中节点/边，Delete 删除；Esc 取消选择。
 */

export const NODE_W = 188;
const HEADER_H = 28;
const PORT_H = 18;
const PORT_TOP = HEADER_H + 4;
const STATUS_H = 22;
const NODE_PAD_B = 6;

export interface GraphCanvasProps {
  readonly graph: Graph;
  readonly registry: ReadonlyArray<OperationDef>;
  readonly onChange: (graph: Graph) => void;
  readonly onSelectNode?: ((id: string | null) => void) | undefined;
  readonly nodeStatus?: Readonly<Record<string, NodeRunState>> | undefined;
}

interface PendingWire {
  readonly from: string;
  readonly fromPort: string;
  readonly type: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function nodeHeight(op: OperationDef | undefined): number {
  const ports = Math.max(op?.inputs.length ?? 0, op?.outputs.length ?? 0, 1);
  return PORT_TOP + ports * PORT_H + STATUS_H + NODE_PAD_B;
}

function portY(index: number): number {
  return PORT_TOP + index * PORT_H + PORT_H / 2;
}

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

const STATUS_COLOR: Record<NodeRunState["status"], string> = {
  pending: "var(--color-faint)",
  running: "var(--color-info)",
  done: "var(--color-accent)",
  cached: "var(--color-amber)",
  failed: "var(--color-danger)",
};

export function GraphCanvas(props: GraphCanvasProps) {
  const { graph, registry, onChange } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [pending, setPending] = useState<PendingWire | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const toLocal = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const selectNode = (id: string | null) => {
    setSelectedNode(id);
    setSelectedEdge(null);
    props.onSelectNode?.(id);
  };

  // ── 连线 ─────────────────────────────────────────────────────────
  const graphRef = useRef(graph);
  graphRef.current = graph;

  // ── 节点拖动 ──────────────────────────────────────────────────────
  const onNodePointerDown = (event: ReactPointerEvent, id: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    selectNode(id);
    const node = graph.nodes.find((n) => n.id === id);
    if (node === undefined) return;
    const start = toLocal(event.clientX, event.clientY);
    const dx = start.x - node.x - pan.x;
    const dy = start.y - node.y - pan.y;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const p = toLocal(e.clientX, e.clientY);
      onChange(moveNode(graphRef.current, id, p.x - pan.x - dx, p.y - pan.y - dy));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── 平移 ─────────────────────────────────────────────────────────
  const onBackgroundPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    selectNode(null);
    const start = toLocal(event.clientX, event.clientY);
    const origin = pan;
    const move = (e: PointerEvent) => {
      const p = toLocal(e.clientX, e.clientY);
      setPan({ x: origin.x + p.x - start.x, y: origin.y + p.y - start.y });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── 连线 ─────────────────────────────────────────────────────────
  const onOutPortPointerDown = (event: ReactPointerEvent, nodeId: string, portIndex: number) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const node = graph.nodes.find((n) => n.id === nodeId);
    const op = node === undefined ? undefined : findOperation(registry, node.operation);
    if (node === undefined || op === undefined) return;
    const port = op.outputs[portIndex];
    if (port === undefined) return;
    const origin = {
      x: node.x + pan.x + NODE_W,
      y: node.y + pan.y + portY(portIndex),
    };
    setPending({
      from: nodeId,
      fromPort: port.name,
      type: port.type,
      x1: origin.x,
      y1: origin.y,
      x2: origin.x,
      y2: origin.y,
    });

    const move = (e: PointerEvent) => {
      const p = toLocal(e.clientX, e.clientY);
      setPending((w) => (w === null ? null : { ...w, x2: p.x, y2: p.y }));
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPending(null);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const portEl = el?.closest("[data-port-in]") as HTMLElement | null;
      const toId = portEl?.dataset["node"];
      const toPort = portEl?.dataset["port"];
      if (toId !== undefined && toPort !== undefined) {
        const next = addEdge(graphRef.current, registry, nodeId, toId, {
          fromPort: port.name,
          toPort,
        });
        if (next !== null) onChange(next);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selectedEdge !== null) onChange(removeEdge(graph, selectedEdge));
      if (selectedNode !== null) {
        onChange(removeNode(graph, selectedNode));
        selectNode(null);
      }
      setSelectedEdge(null);
    }
    if (event.key === "Escape") {
      selectNode(null);
      setSelectedEdge(null);
    }
  };

  // ── 渲染 ─────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onPointerDown={onBackgroundPointerDown}
      onKeyDown={onKeyDown}
      style={{
        position: "relative",
        height: "100%",
        overflow: "hidden",
        outline: "none",
        background:
          "radial-gradient(circle, var(--color-border) 1px, transparent 1px) 0 0 / 24px 24px, var(--color-bg)",
        cursor: pending !== null ? "crosshair" : "default",
      }}
      data-testid="graph-canvas"
    >
      {/* 边层 */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        {graph.edges.map((edge) => {
          const from = graph.nodes.find((n) => n.id === edge.from);
          const to = graph.nodes.find((n) => n.id === edge.to);
          if (from === undefined || to === undefined) return null;
          const fromOp = findOperation(registry, from.operation);
          const toOp = findOperation(registry, to.operation);
          const outIdx = Math.max(
            0,
            fromOp?.outputs.findIndex((port) =>
              edge.fromPort === undefined ? port.type === edge.type : port.name === edge.fromPort,
            ) ?? 0,
          );
          const inIdx = Math.max(
            0,
            toOp?.inputs.findIndex((port) =>
              edge.toPort === undefined ? port.type === edge.type : port.name === edge.toPort,
            ) ?? 0,
          );
          const x1 = from.x + pan.x + NODE_W;
          const y1 = from.y + pan.y + portY(outIdx);
          const x2 = to.x + pan.x;
          const y2 = to.y + pan.y + portY(inIdx);
          const selected = selectedEdge === edge.id;
          return (
            <path
              key={edge.id}
              d={edgePath(x1, y1, x2, y2)}
              fill="none"
              stroke={selected ? "var(--color-accent)" : "var(--color-border-strong)"}
              strokeWidth={selected ? 2 : 1.5}
              style={{ pointerEvents: "stroke", cursor: "pointer" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                selectNode(null);
                setSelectedEdge(edge.id);
              }}
            />
          );
        })}
        {pending !== null && (
          <path
            d={edgePath(pending.x1, pending.y1, pending.x2, pending.y2)}
            fill="none"
            stroke="var(--color-info)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}
      </svg>

      {/* 节点层 */}
      {graph.nodes.map((node) => {
        const op = findOperation(registry, node.operation);
        const status = props.nodeStatus?.[node.id];
        const selected = selectedNode === node.id;
        return (
          <div
            key={node.id}
            data-testid={`graph-node-${node.id}`}
            onPointerDown={(e) => onNodePointerDown(e, node.id)}
            style={{
              position: "absolute",
              left: node.x + pan.x,
              top: node.y + pan.y,
              width: NODE_W,
              height: nodeHeight(op),
              background: "var(--color-surface)",
              border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
              borderRadius: "var(--radius-md)",
              cursor: "grab",
              userSelect: "none",
              fontSize: 11,
              color: "var(--color-text)",
            }}
          >
            <div
              style={{
                height: HEADER_H,
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 8px",
                borderBottom: "1px solid var(--color-border)",
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: STATUS_COLOR[status?.status ?? "pending"],
                }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {op?.label ?? node.operation}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--color-faint)" }}>
                {op?.runtime}
              </span>
            </div>

            {/* 输入端口 */}
            {op?.inputs.map((port, i) => (
              <div
                key={`in-${port.name}`}
                style={{
                  position: "absolute",
                  left: 0,
                  top: PORT_TOP + i * PORT_H,
                  height: PORT_H,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 10,
                  fontSize: 9,
                  color: "var(--color-muted)",
                }}
              >
                <span
                  data-port-in=""
                  data-node={node.id}
                  data-port={port.name}
                  style={{
                    position: "absolute",
                    left: -4,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    background: "var(--color-raised)",
                    border: "1px solid var(--color-border-strong)",
                  }}
                />
                {port.label ?? port.type}
              </div>
            ))}

            {/* 输出端口 */}
            {op?.outputs.map((port, i) => (
              <div
                key={`out-${port.name}`}
                style={{
                  position: "absolute",
                  right: 0,
                  top: PORT_TOP + i * PORT_H,
                  height: PORT_H,
                  display: "flex",
                  alignItems: "center",
                  paddingRight: 10,
                  fontSize: 9,
                  color: "var(--color-muted)",
                }}
              >
                {port.label ?? port.type}
                <span
                  data-port-out=""
                  data-node={node.id}
                  data-port={port.name}
                  onPointerDown={(e) => onOutPortPointerDown(e, node.id, i)}
                  style={{
                    position: "absolute",
                    right: -4,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    background: "var(--color-accent-dim)",
                    border: "1px solid var(--color-accent)",
                    cursor: "crosshair",
                  }}
                />
              </div>
            ))}

            {/* 状态行 */}
            <div
              style={{
                position: "absolute",
                bottom: 4,
                left: 8,
                right: 8,
                height: STATUS_H - 6,
                fontSize: 9,
                color: STATUS_COLOR[status?.status ?? "pending"],
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {status === undefined || status.status === "pending" ? (
                <span style={{ color: "var(--color-faint)" }}>待执行</span>
              ) : status.status === "running" ? (
                <>
                  <span>{Math.round(status.progress * 100)}%</span>
                  <span
                    style={{
                      flex: 1,
                      height: 2,
                      background: "var(--color-border)",
                      borderRadius: 1,
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        height: "100%",
                        width: `${status.progress * 100}%`,
                        background: "var(--color-info)",
                        transition: "width 0.2s",
                      }}
                    />
                  </span>
                </>
              ) : (
                <span>
                  {status.status === "done"
                    ? "完成"
                    : status.status === "cached"
                      ? "缓存命中"
                      : (status.error ?? "失败")}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {graph.nodes.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-faint)",
            fontSize: 11,
            pointerEvents: "none",
          }}
        >
          从左侧添加节点，拖动端口连线
        </div>
      )}
    </div>
  );
}
