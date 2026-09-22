import { describe, expect, it } from "vitest";
import type { ThreadMessage } from "@assistant-ui/react";
import { toAgentHistory } from "../src/chatHistory";
import { serializeAgentMessage } from "../../agent/src/runtime";
import { buildAgentMessages } from "../../agent/src/context";

function assistant(result?: unknown): ThreadMessage {
  return {
    role: "assistant",
    id: "a",
    createdAt: new Date(),
    status: { type: "complete", reason: "stop" },
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
    content: [
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "edit",
        args: { replacement: "text" },
        argsText: "{}",
        result,
      },
    ],
  } as ThreadMessage;
}
describe("native tool history", () => {
  it("keeps denied results separate from assistant text and preserves them through context", () => {
    const history = toAgentHistory([assistant({ error: "用户未批准这次操作" })]);
    history.push({ role: "user", content: "再次编辑" });
    const prepared = buildAgentMessages(history, { id: "home", label: "Home" }, [], null, null);
    expect(prepared[1]).toEqual(history[0]);
    expect(prepared[2]).toEqual(history[1]);
    expect(serializeAgentMessage(history[0]!)).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "c1", name: "edit", input: { replacement: "text" } }],
    });
    expect(serializeAgentMessage(history[1]!)).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "c1" }],
    });
    expect(prepared.at(-1)?.content).toBe("再次编辑");
  });
  it("marks interrupted results unknown instead of claiming execution", () => {
    expect(JSON.parse(toAgentHistory([assistant()])[1]!.content)).toMatchObject({
      output: { status: "unknown" },
      is_error: true,
    });
  });
});
