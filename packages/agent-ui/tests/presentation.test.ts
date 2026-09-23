import { describe, expect, it } from "vitest";
import type { AgentPart, AgentToolPart } from "@bcr/agent";
import { timelineGroups } from "../src/timelineGroups";
import { changeExcerpt } from "../src/changeExcerpt";

const tool = (id: string, extra: Partial<AgentToolPart> = {}): AgentToolPart => ({
  type: "tool",
  id,
  call: { id, name: "read", input: {} },
  risk: "read_only",
  ...extra,
});
describe("conversation presentation", () => {
  it("groups only adjacent known read-only calls without changing order", () => {
    const text: AgentPart = { type: "text", id: "text", text: "result" };
    const parts = [
      tool("a"),
      tool("b"),
      text,
      tool("write", { risk: "high" }),
      { type: "tool", id: "old", call: { id: "old", name: "unknown", input: {} } } as AgentToolPart,
      tool("c"),
    ];
    const groups = timelineGroups(parts);
    expect(groups.map((group) => group.type)).toEqual([
      "activity",
      "text",
      "tool",
      "tool",
      "activity",
    ]);
    expect(groups.flatMap((group) => (group.type === "activity" ? group.tools : [group]))).toEqual(
      parts,
    );
  });
  it("never folds errors or approvals into successful activity", () => {
    const error = tool("error", {
      result: {
        tool_call_id: "error",
        tool_name: "read",
        output: { error: "failed" },
        is_error: true,
      },
    });
    expect(timelineGroups([tool("a"), error, tool("b")]).map((group) => group.type)).toEqual([
      "activity",
      "tool",
      "activity",
    ]);
  });
  it("retains all changes and trims only equal outer lines", () => {
    expect(changeExcerpt("title\nold\nend", "title\nnew\nend")).toEqual({
      before: "old",
      after: "new",
      unchanged: false,
      omitted: 2,
    });
    expect(changeExcerpt("", "new").after).toBe("new");
    expect(changeExcerpt("old", "").before).toBe("old");
    expect(changeExcerpt("same", "same").unchanged).toBe(true);
    expect(changeExcerpt("a\nx\nb\nx\nc", "a\ny\nb\ny\nc").after).toBe("y\nb\ny");
  });
});
