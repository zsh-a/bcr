import { useSelection } from "../router";
import { useStudio } from "../store";
import {
  Badge,
  formatBytes,
  formatDuration,
  formatTime,
  PanelEmpty,
  ProgressBar,
  SectionLabel,
  StatusDot,
} from "./ui";

/** Inspector：选中任务 / 文件的细节视图。 */
export function InspectorPanel() {
  const selection = useSelection();
  const task = useStudio((s) => s.tasks.find((t) => t.id === selection.task));
  const file = useStudio((s) => s.files.find((f) => f.ref.id === selection.file));

  if (task === undefined && file === undefined) {
    return <PanelEmpty title="未选择对象" hint="点击任务或文件查看 Artifact、血缘与执行细节" />;
  }

  return (
    <div className="studio-enter h-full overflow-auto pb-4">
      {task !== undefined && (
        <>
          <SectionLabel>Task</SectionLabel>
          <div className="space-y-1.5 px-3">
            <div className="flex items-center gap-2">
              <StatusDot status={task.status} />
              <span className="font-mono text-[12px] text-text">{task.operation}</span>
              {task.cached && <Badge tone="amber">cache hit</Badge>}
            </div>
            <Row k="id" v={task.id} />
            <Row k="runtime" v={task.runtime} />
            <Row
              k="status"
              v={
                task.status +
                (task.durationMs !== undefined ? ` · ${formatDuration(task.durationMs)}` : "")
              }
            />
            <Row k="started" v={formatTime(task.startedAt)} />
            <Row k="input" v={task.inputId} mono />
            {(task.status === "queued" || task.status === "running") && (
              <div className="pt-1">
                <ProgressBar value={task.progress} />
              </div>
            )}
            {task.error !== undefined && (
              <p className="rounded-[var(--radius-sm)] border border-danger/30 bg-danger/10 px-2 py-1 font-mono text-[11px] text-danger">
                {task.error}
              </p>
            )}
          </div>

          {task.outputs !== undefined && task.outputs.length > 0 && (
            <>
              <SectionLabel>Outputs · ArtifactRef</SectionLabel>
              <div className="space-y-2 px-3">
                {task.outputs.map((ref) => (
                  <div
                    key={ref.id}
                    className="rounded-[var(--radius-sm)] border border-border bg-raised px-2 py-1.5"
                  >
                    <div className="truncate font-mono text-[11px] text-accent">{ref.id}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-faint">
                      <span>{ref.type}</span>
                      <span>{ref.storage}</span>
                      {ref.format !== undefined && <span>{ref.format}</span>}
                    </div>
                    {ref.hash !== undefined && (
                      <div className="mt-1 truncate font-mono text-[10px] text-muted">
                        hash {ref.hash}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {file !== undefined && (
        <>
          <SectionLabel>File Artifact</SectionLabel>
          <div className="space-y-1.5 px-3">
            <div className="truncate text-[12px] font-medium text-text">{file.name}</div>
            <Row k="artifact" v={file.ref.id} mono />
            <Row k="type" v={file.ref.type} />
            <Row k="storage" v={file.ref.storage} />
            <Row k="size" v={formatBytes(file.size)} />
          </div>
        </>
      )}
    </div>
  );
}

function Row(props: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="w-14 shrink-0 font-mono text-[10px] text-faint">{props.k}</span>
      <span
        className={`min-w-0 flex-1 truncate text-muted ${props.mono === true ? "font-mono" : ""}`}
      >
        {props.v}
      </span>
    </div>
  );
}
