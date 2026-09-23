import { Check, ChevronRight, LoaderCircle } from "lucide-react";
import type { AgentToolPart } from "@bcr/agent";
import { ToolExecutionCard } from "./ToolExecutionCard";
import type { ResultRegistry } from "./renderers";

export function ActivityGroup({
  tools,
  running,
  registry,
}: {
  tools: AgentToolPart[];
  running: boolean;
  registry?: ResultRegistry | undefined;
}) {
  const pending = tools.find((part) => !part.result);
  const complete = tools.filter((part) => part.result).length;
  const Icon = pending && running ? LoaderCircle : pending ? ChevronRight : Check;
  return (
    <details className="bcr-chat-activity-group">
      <summary>
        <Icon
          size={15}
          aria-hidden="true"
          className={pending && running ? "bcr-chat-spinner" : undefined}
        />
        <span>
          {pending
            ? running
              ? `正在${pending.presentation?.label ?? "执行只读操作"}`
              : "执行已中断 · 结果待核实"
            : `已完成 ${complete} 项只读操作`}
        </span>
        <ChevronRight size={14} aria-hidden="true" className="bcr-chat-disclosure" />
      </summary>
      <div className="bcr-chat-activity-body">
        {tools.map((part) => (
          <ToolExecutionCard
            key={part.id}
            part={part}
            running={running}
            registry={registry}
            resolve={() => {}}
          />
        ))}
      </div>
    </details>
  );
}
