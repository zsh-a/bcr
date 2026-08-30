import { addNode, autoWire, removeNode, updateNodeConfig, type OperationDef } from "@bcr/graph";
import { ConfigForm, GraphCanvas, OperationPalette } from "@bcr/graph/react";
import { OPERATIONS } from "../operations";
import { studio, useStudio } from "../store";

/**
 * Pipeline DAG 编辑器：palette 添加节点（autoWire 自动接线）+ 画布编排 + 节点配置。
 * 图即事实源：改动直接写入 store.graph，由 generateSubtitles 编译执行。
 */
export function PipelineEditor() {
  const graph = useStudio((s) => s.graph);
  const nodeStatus = useStudio((s) => s.nodeStatus);
  const selected = useStudio((s) => s.selectedNode);

  const addOperation = (operation: string) => {
    const op = OPERATIONS.find((o) => o.operation === operation);
    if (op === undefined) return;
    const base = operation.split(".").pop() ?? "node";
    let id = base;
    for (let seq = 2; graph.nodes.some((n) => n.id === id); seq += 1) id = `${base}-${seq}`;
    const offset = graph.nodes.length % 5;
    let next = addNode(graph, op, id, 64 + offset * 40, 64 + offset * 32);
    next = autoWire(next, OPERATIONS, id);
    studio.setGraph(next);
    studio.setSelectedNode(id);
  };

  const selectedNode = graph.nodes.find((n) => n.id === selected);
  const selectedOp: OperationDef | undefined =
    selectedNode === undefined
      ? undefined
      : OPERATIONS.find((o) => o.operation === selectedNode.operation);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-[168px] shrink-0 overflow-y-auto border-r border-[var(--color-border)] p-2">
        <div className="mb-1.5 text-[10px] tracking-wider text-[var(--color-faint)]">节点</div>
        <OperationPalette registry={OPERATIONS} onAdd={addOperation} />
        <p className="mt-2 text-[9px] leading-relaxed text-[var(--color-faint)]">
          拖动输出端口连线 · 点击选中后 Delete 删除 · 节点 config 参与缓存键
        </p>
      </aside>

      <div className="min-w-0 flex-1">
        <GraphCanvas
          graph={graph}
          registry={OPERATIONS}
          nodeStatus={nodeStatus}
          onChange={(next) => studio.setGraph(next)}
          onSelectNode={(id) => studio.setSelectedNode(id)}
        />
      </div>

      {selectedNode !== undefined && selectedOp !== undefined && (
        <aside className="w-[200px] shrink-0 overflow-y-auto border-l border-[var(--color-border)] p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-semibold">{selectedOp.label}</span>
            <span className="font-mono text-[9px] text-[var(--color-faint)]">
              {selectedNode.id}
            </span>
            <button
              type="button"
              className="ml-auto text-[10px] text-[var(--color-faint)] hover:text-[var(--color-danger)]"
              onClick={() => {
                studio.setGraph(removeNode(graph, selectedNode.id));
                studio.setSelectedNode(null);
              }}
            >
              删除
            </button>
          </div>
          <ConfigForm
            op={selectedOp}
            value={selectedNode.config}
            onChange={(patch) => studio.setGraph(updateNodeConfig(graph, selectedNode.id, patch))}
          />
        </aside>
      )}
    </div>
  );
}
