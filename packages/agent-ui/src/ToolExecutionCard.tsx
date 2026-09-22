import { Check, ChevronRight, Circle, ShieldCheck } from "lucide-react";
import type { AgentToolPart } from "@bcr/agent";
import { ApprovalCard } from "./ApprovalCard";
import { ToolResultView, type ResultRegistry } from "./renderers";

export function ToolExecutionCard({
  part,
  running,
  resolve,
  registry,
}: {
  part: AgentToolPart;
  running: boolean;
  resolve: (approved: boolean) => void;
  registry?: ResultRegistry | undefined;
}) {
  const pending = part.approval?.decision === "pending" && running;
  const output = part.result?.output;
  const error =
    output && typeof output === "object" && "error" in output ? String(output.error) : null;
  const status = pending
    ? "等待确认"
    : part.result
      ? part.result.is_error
        ? part.approval?.decision === "denied"
          ? "已拒绝"
          : error?.includes("变化")
            ? "已取消"
            : "执行失败"
        : "已完成"
      : running
        ? "执行中"
        : "已中断 · 结果待核实";
  const Icon = pending ? ShieldCheck : part.result && !part.result.is_error ? Check : Circle;
  return (
    <section
      className={`bcr-chat-card bcr-chat-tool${pending ? " is-pending" : ""}`}
      aria-label={`工具 ${part.call.name}`}
    >
      <header className="bcr-chat-card-head">
        <Icon size={15} aria-hidden="true" />
        <strong>{part.presentation?.label ?? part.call.name}</strong>
        <span className="bcr-chat-activity">
          {part.call.name} · {status}
        </span>
      </header>
      {part.approval &&
        (pending ? (
          <ApprovalCard approval={part.approval} resolve={resolve} />
        ) : (
          <details className="bcr-chat-record">
            <summary>查看变更与审批</summary>
            <ApprovalCard approval={part.approval} resolve={resolve} />
          </details>
        ))}
      {error && <p className="bcr-chat-tool-error">{error}</p>}
      <ToolResultView part={part} registry={registry} />
      <details className="bcr-chat-record">
        <summary>
          <ChevronRight size={12} aria-hidden="true" />
          技术详情
        </summary>
        <pre className="bcr-chat-diff">
          {JSON.stringify(
            { input: part.call.input, output: part.result ? part.result.output : "尚无执行回执" },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}
