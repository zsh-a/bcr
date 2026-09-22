import type { AgentRun } from "./conversationTypes";
import type { AgentMessage } from "./runtime";

/** UI and model history are projections of the same ordered execution record. */
export function conversationHistory(runs: readonly AgentRun[]): AgentMessage[] {
  return runs.flatMap((run): AgentMessage[] => [
    { role: "user", content: run.input },
    ...run.parts.flatMap((part): AgentMessage[] =>
      part.type === "text"
        ? part.text
          ? [{ role: "assistant", content: part.text }]
          : []
        : [
            { role: "assistant", content: "", toolCalls: [part.call] },
            {
              role: "tool",
              toolCallId: part.call.id,
              content:
                JSON.stringify(
                  part.result
                    ? part.result.output
                    : {
                        status: "unknown",
                        error: "上次执行中断，结果未知。先核实状态，不要自动重复写操作。",
                      },
                ) ?? "null",
            },
          ],
    ),
  ]);
}
