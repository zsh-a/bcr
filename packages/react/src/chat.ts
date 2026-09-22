import { useMemo, useRef, useSyncExternalStore } from "react";
import {
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadAssistantMessagePart,
  type ToolCallMessagePart,
} from "@assistant-ui/react";
import {
  createAgentSession,
  type AgentSessionOptions,
  type AgentSessionSnapshot,
} from "@bcr/agent";
import { toAgentHistory } from "./chatHistory";
import { useAgent } from "./agent";
import { useAgentHost } from "./AgentProvider";
export { type PendingApproval } from "@bcr/agent";
/** Only translates assistant-ui messages and subscribes to the framework-free session. */
export function useAgentChat(options: AgentSessionOptions) {
  const { endpoint } = useAgent();
  const host = useAgentHost();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const session = useMemo(() => createAgentSession(() => optionsRef.current, host), [host]);
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }) {
        const history = toAgentHistory(messages);
        let wake = Promise.withResolvers<void>();
        const unsubscribe = session.subscribe(() => wake.resolve());
        let settled = false;
        const result = session.run(endpoint, history, abortSignal);
        void result.then(
          () => {
            settled = true;
            wake.resolve();
          },
          () => {
            settled = true;
            wake.resolve();
          },
        );
        try {
          while (!settled) {
            const next = wake.promise;
            yield { content: sessionContent(session.getSnapshot()) };
            await next;
            wake = Promise.withResolvers<void>();
          }
          // Preserve receipts even when the next model round failed or was cancelled.
          yield { content: sessionContent(session.getSnapshot()) };
          const completed = await result;
          const content = sessionContent({
            ...session.getSnapshot(),
            text: completed.text.trim() || "（本次没有产出文本）",
          });
          if (completed.finishReason === "round_limit")
            content.push({
              type: "text",
              text: `\n\n已达到本次 ${completed.rounds} 轮执行上限，任务可能尚未完成。已执行的工具结果保留在上方；如需继续，请发送新的指令。`,
            });
          yield { content };
        } finally {
          unsubscribe();
        }
      },
    }),
    [endpoint, session],
  );
  return {
    runtime: useLocalRuntime(adapter),
    approval: snapshot.approval,
    activity: snapshot.activity,
  };
}

function sessionContent(snapshot: AgentSessionSnapshot): ThreadAssistantMessagePart[] {
  return [
    ...snapshot.toolCalls.map((call): ThreadAssistantMessagePart => {
      const result = snapshot.toolResults.find((item) => item.tool_call_id === call.id);
      return {
        type: "tool-call",
        toolCallId: call.id,
        toolName: call.name,
        args: (call.input ?? {}) as ToolCallMessagePart["args"],
        argsText: JSON.stringify(call.input ?? {}),
        result: result?.output,
        isError: result?.is_error ?? false,
      };
    }),
    { type: "text", text: snapshot.text },
  ];
}
