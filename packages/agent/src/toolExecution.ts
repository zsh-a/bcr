import type { AgentHost } from "./host";
import type { ToolDecision } from "./loop";
import type { AgentSurface, SurfaceTarget } from "./surface";
import type { AgentSessionOptions, AgentSessionSnapshot, PendingApproval } from "./sessionTypes";
import { requiresApproval } from "./tools";
import { applySuggestion, suggestionFrom, SURFACE_EDIT_TOOL } from "./surfaceEdit";

function parseOutput(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** One execution path for every tool: authorize, optionally approve, reauthorize, execute. */
export function createToolDecision({
  host,
  getOptions,
  surface,
  target,
  signal,
  onApproval,
  onActivity,
}: {
  host: AgentHost;
  getOptions: () => AgentSessionOptions;
  surface: AgentSurface | null;
  target: SurfaceTarget | null;
  signal: AbortSignal;
  onApproval: (approval: PendingApproval | null) => void;
  onActivity: (activity: AgentSessionSnapshot["activity"][number]) => void;
}): ToolDecision {
  return async (call, tool) => {
    signal.throwIfAborted();
    if (!tool) return { reject: `未注册的工具：${call.name}` };
    const editing = call.name === SURFACE_EDIT_TOOL;
    const available = () => {
      const latest = getOptions();
      const capabilities = host.availableAgentCapabilities(
        latest.workspaceId,
        latest.disabledCapabilities,
      );
      const surfaceEnabled =
        latest.includeContext &&
        surface === host.activeSurface() &&
        (!surface?.capabilityId || capabilities.some((item) => item.id === surface.capabilityId));
      return editing
        ? surfaceEnabled
        : capabilities.some((item) => item.tools.includes(tool)) ||
            (surfaceEnabled && !!surface?.tools?.includes(tool));
    };
    if (!available()) return { reject: "该能力已关闭或当前工作区已变化" };
    const report = (status: string) => onActivity({ id: call.id, name: call.name, status });
    const suggestion = editing ? suggestionFrom(call, target) : null;
    if (editing && !suggestion) return { reject: "改动数据无效" };
    if (requiresApproval(tool.spec)) {
      const { promise, resolve } = Promise.withResolvers<boolean>();
      const abort = () => resolve(false);
      signal.addEventListener("abort", abort, { once: true });
      let approved: boolean;
      try {
        report("等待确认");
        onApproval({
          call,
          settle: resolve,
          suggestion,
          original:
            target && suggestion
              ? target.text.slice(suggestion.range.start, suggestion.range.end)
              : "",
          targetLabel: surface?.label ?? call.name,
        });
        if (signal.aborted) resolve(false);
        approved = await promise;
      } finally {
        signal.removeEventListener("abort", abort);
        onApproval(null);
      }
      signal.throwIfAborted();
      if (!approved) {
        report("已拒绝");
        return { reject: "用户未批准这次操作" };
      }
    }
    signal.throwIfAborted();
    if (!available()) {
      report("已取消");
      return { reject: "确认期间能力或目标发生变化，未执行" };
    }
    report("执行中");
    try {
      const output =
        editing && suggestion
          ? await applySuggestion(host, suggestion, surface)
          : parseOutput(
              await tool.call(JSON.stringify(call.input ?? {}), { signal, callId: call.id }),
            );
      report("已完成");
      return { tool_call_id: call.id, tool_name: call.name, output };
    } catch (error) {
      report("失败");
      return {
        tool_call_id: call.id,
        tool_name: call.name,
        output: { error: String(error) },
        is_error: true,
      };
    }
  };
}
