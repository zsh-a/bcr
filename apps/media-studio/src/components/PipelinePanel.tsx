import { useStudio, type PipelineNodeState } from "../store";

const STATUS_STYLE: Record<
  PipelineNodeState["status"],
  { dot: string; text: string; label: string }
> = {
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

/** DAG 节点状态面板：任务进度 / 缓存命中 / 失败直接投影。 */
export function PipelinePanel() {
  const nodes = useStudio((state) => state.nodes);

  return (
    <div className="flex flex-col gap-1" data-testid="pipeline-panel">
      {nodes.map((node, index) => {
        const style = STATUS_STYLE[node.status];
        return (
          <div
            key={node.id}
            className="relative flex flex-col gap-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5"
          >
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              <span className="font-mono text-[11px] font-medium">{node.label}</span>
              <span className={`ml-auto text-[10px] ${style.text}`}>
                {node.status === "running"
                  ? `${Math.round(node.progress * 100)}%`
                  : node.status === "failed"
                    ? (node.error ?? style.label)
                    : style.label}
              </span>
            </div>
            <div className="text-[10px] text-[var(--color-faint)]">{node.detail}</div>
            {node.status === "running" && (
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--color-border)]">
                <div
                  className="h-full bg-[var(--color-info)] transition-[width] duration-200"
                  style={{ width: `${node.progress * 100}%` }}
                />
              </div>
            )}
            {index < nodes.length - 1 && <div />}
          </div>
        );
      })}
    </div>
  );
}
