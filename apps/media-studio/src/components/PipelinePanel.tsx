import { findOperation, type NodeRunState } from "@bcr/graph";
import { ProgressBar } from "@bcr/react";
import { OPERATIONS } from "../operations";
import { useStudio } from "../store";

const STATUS_STYLE: Record<NodeRunState["status"], { dot: string; text: string; label: string }> = {
  pending: { dot: "bg-[var(--color-faint)]", text: "text-[var(--color-faint)]", label: "待执行" },
  running: {
    dot: "bg-[var(--color-info)]",
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
            className="relative flex flex-col gap-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${style.dot}`} />
              <span className="font-mono text-xs font-medium">{op?.label ?? node.operation}</span>
              <span className={`ml-auto text-xs ${style.text}`}>
                {status.status === "running"
                  ? `${Math.round(status.progress * 100)}%`
                  : status.status === "failed"
                    ? (status.error ?? style.label)
                    : style.label}
              </span>
            </div>
            <div className="text-xs text-[var(--color-faint)]">{op?.detail ?? ""}</div>
            {status.status === "running" && (
              <div className="absolute inset-x-0 bottom-0 overflow-hidden rounded-b-[var(--radius-sm)]">
                <ProgressBar
                  value={status.progress}
                  label={`${op?.label ?? node.operation} 进度`}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
