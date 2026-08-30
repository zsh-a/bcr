import { findOperation, type NodeRunState } from "@bcr/graph";
import { OPERATIONS } from "../operations";
import { useStudio } from "../store";

const STATUS_STYLE: Record<NodeRunState["status"], { dot: string; text: string; label: string }> = {
  pending: { dot: "bg-[var(--color-faint)]", text: "text-[var(--color-faint)]", label: "待执行" },
  running: {
    dot: "bg-[var(--color-info)] animate-pulse",
    text: "text-[var(--color-info)]",
    label: "运行中",
  },
  done: { dot: "bg-[var(--color-accent)]", text: "text-[var(--color-accent)]", label: "完成" },
  cached: { dot: "bg-[var(--color-amber)]", text: "text-[var(--color-amber)]", label: "缓存命中" },
  failed: { dot: "bg-[var(--color-danger)]", text: "text-[var(--color-danger)]", label: "失败" },
};

/** DAG 节点状态紧凑面板：图 → 运行状态投影（完整编排见"流水线"页签）。 */
export function PipelinePanel() {
  const graph = useStudio((state) => state.graph);
  const nodeStatus = useStudio((state) => state.nodeStatus);

  return (
    <div className="flex flex-col gap-1" data-testid="pipeline-panel">
      {graph.nodes.map((node) => {
        const op = findOperation(OPERATIONS, node.operation);
        const status = nodeStatus[node.id] ?? { status: "pending" as const, progress: 0 };
        const style = STATUS_STYLE[status.status];
        return (
          <div
            key={node.id}
            className="relative flex flex-col gap-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5"
          >
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              <span className="font-mono text-[11px] font-medium">
                {op?.label ?? node.operation}
              </span>
              <span className={`ml-auto text-[10px] ${style.text}`}>
                {status.status === "running"
                  ? `${Math.round(status.progress * 100)}%`
                  : status.status === "failed"
                    ? (status.error ?? style.label)
                    : style.label}
              </span>
            </div>
            <div className="text-[10px] text-[var(--color-faint)]">{op?.detail ?? ""}</div>
            {status.status === "running" && (
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--color-border)]">
                <div
                  className="h-full bg-[var(--color-info)] transition-[width] duration-200"
                  style={{ width: `${status.progress * 100}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
