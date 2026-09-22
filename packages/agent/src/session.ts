import type { AgentHost } from "./host";
import { runAgentLoop, type RunRound } from "./loop";
import type { AgentEndpoint, AgentMessage } from "./runtime";
import { buildAgentMessages } from "./context";
import { toolSpecOf } from "./tools";
import { surfaceEditTool } from "./surfaceEdit";
import { createToolDecision } from "./toolExecution";
import type { AgentSessionOptions, AgentSessionSnapshot } from "./sessionTypes";
export type { AgentSessionOptions, AgentSessionSnapshot, PendingApproval } from "./sessionTypes";
export { SURFACE_EDIT_TOOL } from "./surfaceEdit";

/** Framework-free execution policy. Views subscribe; the session owns approvals and tools. */
export function createAgentSession(
  getOptions: () => AgentSessionOptions,
  host: AgentHost,
  runRound?: RunRound,
) {
  const { availableAgentCapabilities, activeSurface } = host;
  let snapshot: AgentSessionSnapshot = {
    status: "idle",
    error: null,
    running: false,
    text: "",
    approval: null,
    activity: [],
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<AgentSessionSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const updateActivity = (
    fn: (items: AgentSessionSnapshot["activity"]) => AgentSessionSnapshot["activity"],
  ) => update({ activity: fn(snapshot.activity) });
  return {
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async run(
      endpoint: AgentEndpoint,
      messages: readonly AgentMessage[],
      abortSignal: AbortSignal,
    ) {
      if (snapshot.running) throw new Error("当前会话已有任务正在执行");
      abortSignal.throwIfAborted();
      update({
        status: "running",
        error: null,
        running: true,
        text: "",
        activity: [],
        approval: null,
      });
      try {
        const current = getOptions();
        const enabled = availableAgentCapabilities(
          current.workspaceId,
          current.disabledCapabilities,
        );
        const active = current.includeContext ? activeSurface() : null;
        const surface =
          active?.capabilityId && !enabled.some((item) => item.id === active.capabilityId)
            ? null
            : active;
        const target = surface?.read() ?? null;
        const instruction = [...messages]
          .reverse()
          .find((message) => message.role === "user")
          ?.content.trim();
        if (!instruction) {
          throw new Error("请输入问题或任务。");
        }

        const tools = [
          ...enabled.flatMap((capability) => capability.tools),
          ...(surface?.tools ?? []),
          ...(target === null ? [] : [surfaceEditTool(host)]),
        ];
        const names = tools.map((tool) => toolSpecOf(tool.spec).name);
        if (names.some((name) => !name) || new Set(names).size !== names.length)
          throw new Error("Agent 工具名称缺失或重复，请检查领域能力注册");

        const decide = createToolDecision({
          host,
          getOptions,
          surface,
          target,
          signal: abortSignal,
          onApproval: (approval) =>
            update({ approval, status: approval ? "awaiting_approval" : "running" }),
          onActivity: (activity) =>
            updateActivity((items) => [
              ...items.filter((item) => item.id !== activity.id),
              activity,
            ]),
        });

        const prepared = buildAgentMessages(
          messages,
          { id: current.workspaceId, label: current.workspaceLabel },
          enabled,
          surface,
          target,
        );
        const loop = runAgentLoop(endpoint, prepared, {
          tools,
          signal: abortSignal,
          decide,
          ...(runRound ? { runRound } : {}),
          onDelta: (chunk) => {
            update({ text: snapshot.text + chunk });
          },
        });

        const result = await loop;
        update({ status: result.finishReason });
        return result;
      } catch (error) {
        update({ status: abortSignal.aborted ? "cancelled" : "failed", error: String(error) });
        throw error;
      } finally {
        update({ running: false, approval: null });
      }
    },
  };
}
