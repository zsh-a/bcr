import type { AgentMessage } from "@bcr/agent";
import type { ThreadMessage } from "@assistant-ui/react";

/** Tool results are protocol messages, never assistant-authored prose. */
export function toAgentHistory(messages: readonly ThreadMessage[]): AgentMessage[] {
  return messages.flatMap((message): AgentMessage[] => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    return message.content.flatMap((part): AgentMessage[] => {
      if (part.type === "text")
        return part.text.trim() ? [{ role: message.role, content: part.text }] : [];
      if (part.type !== "tool-call") return [];
      return [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: part.toolCallId, name: part.toolName, input: part.args }],
        },
        {
          role: "tool",
          toolCallId: part.toolCallId,
          content: JSON.stringify({
            output: part.result ?? {
              status: "unknown",
              message: "上次执行中断，结果未知。请核实状态，不要假定成功或自动重复写操作。",
            },
            is_error: part.isError ?? part.result === undefined,
          }),
        },
      ];
    });
  });
}
