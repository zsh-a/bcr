import type { AgentHostServices } from "./host";
import { runAgentLoop, type RunRound } from "./loop";
import type { AgentEndpoint, AgentMessage } from "./runtime";
import { buildAgentMessages } from "./context";
import { toolSpecOf } from "./tools";
import { surfaceEditTool } from "./surfaceEdit";
import { createToolDecision } from "./toolExecution";
import type { AgentSessionOptions, AgentSessionSnapshot } from "./sessionTypes";
import type { AgentToolPart } from "./conversationTypes";
export type { AgentSessionOptions, AgentSessionSnapshot, PendingApproval } from "./sessionTypes";
export { SURFACE_EDIT_TOOL } from "./surfaceEdit";

/** Framework-free execution policy. Views subscribe; the session owns approvals and tools. */
export function createAgentSession(
  getOptions: () => AgentSessionOptions,
  host: AgentHostServices,
  runRound?: RunRound,
) {
  const { availableAgentCapabilities, activeSurface } = host;
  let snapshot: AgentSessionSnapshot = {
    parts: [],
    status: "idle",
    error: null,
    running: false,
    text: "",
    toolCalls: [],
    toolResults: [],
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
  const updateTool = (id: string, fn: (part: AgentToolPart) => AgentToolPart) =>
    update({
      parts: snapshot.parts.map((part) =>
        part.type === "tool" && part.id === id ? fn(part) : part,
      ),
    });
  return {
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resolveApproval(callId: string, approved: boolean) {
      if (
        snapshot.approval?.call.id !== callId ||
        !snapshot.parts.some(
          (part) =>
            part.type === "tool" &&
            part.call.id === callId &&
            part.approval?.decision === "pending",
        )
      )
        return false;
      snapshot.approval.settle(approved);
      return true;
    },
    async run(
      endpoint: AgentEndpoint,
      messages: readonly AgentMessage[],
      abortSignal: AbortSignal,
    ) {
      if (snapshot.running) throw new Error("当前会话已有任务正在执行");
      update({
        parts: [],
        status: "running",
        error: null,
        running: true,
        text: "",
        toolCalls: [],
        toolResults: [],
        activity: [],
        approval: null,
      });
      try {
        abortSignal.throwIfAborted();
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
          ...(target === null || current.allowEdits === false ? [] : [surfaceEditTool(host)]),
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
          onApproval: (approval) => {
            if (!approval) {
              update({ approval: null, status: "running" });
              return;
            }
            const { settle, ...record } = approval;
            let decided = false;
            updateTool(approval.call.id, (part) => ({
              ...part,
              approval: { ...record, decision: "pending" },
            }));
            update({
              status: "awaiting_approval",
              approval: {
                ...approval,
                settle: (approved) => {
                  if (decided) return;
                  decided = true;
                  updateTool(approval.call.id, (part) => ({
                    ...part,
                    approval: { ...record, decision: approved ? "approved" : "denied" },
                  }));
                  settle(approved);
                },
              },
            });
          },
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
          onToolCall: (call) => {
            const presentation = tools.find((tool) => tool.spec.name === call.name)?.presentation;
            update({
              toolCalls: [...snapshot.toolCalls, call],
              parts: [
                ...snapshot.parts,
                {
                  type: "tool",
                  id: call.id,
                  call,
                  ...(presentation ? { presentation } : {}),
                },
              ],
            });
          },
          onToolResult: (result) => {
            updateTool(result.tool_call_id, (part) => ({ ...part, result }));
            update({ toolResults: [...snapshot.toolResults, result] });
          },
          ...(runRound ? { runRound } : {}),
          onDelta: (chunk) => {
            const last = snapshot.parts.at(-1);
            const parts =
              last?.type === "text"
                ? [...snapshot.parts.slice(0, -1), { ...last, text: last.text + chunk }]
                : [
                    ...snapshot.parts,
                    { type: "text" as const, id: crypto.randomUUID(), text: chunk },
                  ];
            update({ text: snapshot.text + chunk, parts });
          },
        });

        const result = await loop;
        update({ status: result.finishReason });
        return result;
      } catch (error) {
        update({ status: abortSignal.aborted ? "cancelled" : "failed", error: String(error) });
        throw error;
      } finally {
        update({
          running: false,
          approval: null,
          parts: snapshot.parts.map((part) =>
            part.type === "tool" && part.approval?.decision === "pending"
              ? { ...part, approval: { ...part.approval, decision: "expired" } }
              : part,
          ),
        });
      }
    },
  };
}
