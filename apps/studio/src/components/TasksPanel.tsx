import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleStop } from "lucide-react";
import { useRef } from "react";
import { cancelTask } from "../runtime";
import { useSelection } from "../router";
import { useServices } from "../services";
import { useStudio, type TaskRecord } from "../store";
import { Badge, formatDuration, PanelEmpty, ProgressBar, StatusDot } from "./ui";

/** 任务历史面板：虚拟化列表（§12）。 */
export function TasksPanel() {
  const services = useServices();
  const tasks = useStudio((s) => s.tasks);
  const selection = useSelection();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  if (tasks.length === 0) {
    return <PanelEmpty title="暂无任务" hint="提交计算后在这里跟踪进度" />;
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => {
          const task = tasks[row.index];
          if (task === undefined) return null;
          return (
            <TaskRow
              key={task.id}
              task={task}
              selected={selection.task === task.id}
              top={row.start}
              height={row.size}
              onSelect={() => selection.select({ task: task.id })}
              onCancel={() => void cancelTask(services, task.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function TaskRow(props: {
  task: TaskRecord;
  selected: boolean;
  top: number;
  height: number;
  onSelect: () => void;
  onCancel: () => void;
}) {
  const { task } = props;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onSelect();
      }}
      style={{
        top: props.top,
        height: props.height,
        position: "absolute",
        left: 0,
        width: "100%",
      }}
      className={`flex cursor-pointer flex-col justify-center gap-1 border-b border-border/60 px-3 transition-colors ${
        props.selected ? "bg-raised" : "hover:bg-raised/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={task.status} />
        <span className="font-mono text-[11px] text-text">{task.operation}</span>
        <span className="font-mono text-[10px] text-faint">{task.id}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-faint">
          {task.inputId}
        </span>
        {task.cached && <Badge tone="amber">cache hit</Badge>}
        <Badge tone={task.status === "failed" ? "danger" : "muted"}>{task.runtime}</Badge>
        {task.durationMs !== undefined && (
          <span className="font-mono text-[10px] text-muted">
            {formatDuration(task.durationMs)}
          </span>
        )}
        {task.status === "running" && (
          <button
            type="button"
            title="取消任务（级联下游）"
            onClick={(e) => {
              e.stopPropagation();
              props.onCancel();
            }}
            className="text-faint transition-colors hover:text-danger"
          >
            <CircleStop className="size-3.5" />
          </button>
        )}
      </div>
      {task.status === "running" && <ProgressBar value={task.progress} />}
    </div>
  );
}
