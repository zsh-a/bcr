import { describe, expect, it, vi } from "vitest";
import { requiresApproval, toolSpecOf } from "../src/tools";
import { AgentError } from "../src/runtime";
import type { AgentTool } from "../src/runtime";
import { DEFAULT_MAX_ROUNDS, runAgentLoop, type RunRound } from "../src/loop";

const endpoint = { baseUrl: "http://x/v1", apiKey: "k", model: "m" };

const parse = (value: string): unknown => JSON.parse(value) as unknown;

const spec = (name: string, risk: import("../src/tools").ToolRisk = "read_only") => ({
  name,
  description: name,
  input_schema: { type: "object" },
  risk,
});

const tool = (
  name: string,
  output: unknown,
  risk: import("../src/tools").ToolRisk = "read_only",
): AgentTool => ({
  spec: spec(name, risk),
  call: async () => JSON.stringify(output),
});

type Round = { text?: string; pending?: { state?: object; calls?: object[] } };

/**
 * A scripted runtime. The loop is exercised for real against it, through the
 * injectable `runRound` seam: no module mocking, so the mechanics under test are
 * the shipped ones.
 */
function runtime(...rounds: Round[]) {
  const calls: Array<{ resume: unknown; tools: readonly unknown[] }> = [];
  let index = 0;
  const runRound: RunRound = async (_endpoint, _messages, options) => {
    const round = rounds[index] ?? {};
    index += 1;
    calls.push({ resume: options.resume, tools: options.tools });
    options.onDelta?.(round.text ?? "");
    if (round.pending) {
      options.onEvent?.({
        kind: "round_finished",
        metadata: {
          status: "requires_tool_results",
          chat_state: round.pending.state ?? { round: 1 },
          tool_calls: round.pending.calls ?? [],
        },
      });
    }
    options.onEvent?.({ kind: "done" });
    return round.pending
      ? {
          state: (round.pending.state ?? { round: 1 }) as Record<string, unknown>,
          toolCalls: (round.pending.calls ?? []) as never,
        }
      : null;
  };
  return {
    runRound,
    calls,
    get count() {
      return index;
    },
  };
}

describe("tool risk policy", () => {
  it("gates on declared risk, not on a list of names", () => {
    expect(toolSpecOf(spec("any_new_thing", "read_only"))).toEqual({
      name: "any_new_thing",
      risk: "read_only",
    });
    expect(requiresApproval(spec("lookup", "read_only"))).toBe(false);
    for (const risk of ["low", "medium", "high"] as const)
      expect(requiresApproval(spec("w", risk))).toBe(true);
    // An unparseable spec fails closed: unknown capability means ask a human.
    expect(requiresApproval(null)).toBe(true);
    expect(requiresApproval({ name: "x" })).toBe(true);
  });
});

describe("agent loop", () => {
  it("runs a read-only tool and resumes with its result", async () => {
    const scripted = runtime(
      {
        text: "先查一下",
        pending: { state: { round: 1 }, calls: [{ id: "c1", name: "lookup", input: { q: "x" } }] },
      },
      { text: "查到了" },
    );
    const result = await runAgentLoop(endpoint, [{ role: "user", content: "hi" }], {
      tools: [tool("lookup", { hits: 2 })],
      runRound: scripted.runRound,
    });

    expect(result.text).toBe("先查一下查到了");
    expect(result.finishReason).toBe("completed");
    expect(result.toolResults[0]).toMatchObject({
      tool_call_id: "c1",
      tool_name: "lookup",
      output: { hits: 2 },
    });
    // The second round must be a resume carrying the first round's result.
    expect(scripted.count).toBe(2);
    expect(scripted.calls[1]?.resume).toMatchObject({
      state: { round: 1 },
      toolResults: [{ tool_call_id: "c1" }],
    });
  });

  it("refuses a write without an approval host instead of executing it", async () => {
    const write = vi.fn(async () => "done");
    const scripted = runtime(
      { pending: { calls: [{ id: "c1", name: "apply_edit", input: {} }] } },
      {
        text: "无法自动修改",
      },
    );
    const result = await runAgentLoop(endpoint, [{ role: "user", content: "改一下" }], {
      tools: [{ spec: spec("apply_edit", "high"), call: write }],
      runRound: scripted.runRound,
    });

    expect(write).not.toHaveBeenCalled();
    expect(result.toolResults[0]).toMatchObject({ is_error: true, tool_name: "apply_edit" });
  });

  it("lets an approving host run a write, and records its result", async () => {
    const scripted = runtime(
      { pending: { calls: [{ id: "c1", name: "apply_edit", input: { body: "new" } }] } },
      {},
    );
    const applied: unknown[] = [];
    const write: AgentTool = {
      spec: spec("apply_edit", "high"),
      call: async (input) => {
        applied.push(JSON.parse(input));
        return JSON.stringify({ ok: true });
      },
    };
    // An approval host runs the tool itself and reports the outcome, which is
    // what keeps the write behind a human decision rather than a policy flag.
    const result = await runAgentLoop(endpoint, [{ role: "user", content: "改一下" }], {
      tools: [write],
      runRound: scripted.runRound,
      decide: async (call, tool) => {
        if (tool === undefined || !requiresApproval(tool.spec)) return { reject: "未批准" };
        return {
          tool_call_id: call.id,
          tool_name: call.name,
          output: parse(await tool.call(JSON.stringify(call.input ?? {}))),
        };
      },
    });

    expect(applied).toEqual([{ body: "new" }]);
    expect(result.toolResults[0]).toMatchObject({ output: { ok: true } });
    expect(result.toolResults[0]?.is_error).toBeUndefined();
  });

  it("reports an unknown tool as an error rather than throwing", async () => {
    const scripted = runtime({ pending: { calls: [{ id: "c1", name: "nope", input: {} }] } }, {});
    const result = await runAgentLoop(endpoint, [{ role: "user", content: "hi" }], {
      tools: [],
      runRound: scripted.runRound,
    });
    expect(result.toolResults[0]).toMatchObject({ is_error: true, tool_name: "nope" });
  });

  it("stops at the round ceiling instead of looping forever", async () => {
    // Every round asks for another tool; the ceiling is what ends it.
    // More rounds queued than the ceiling allows: the loop must stop anyway.
    const scripted = runtime(
      ...Array.from({ length: DEFAULT_MAX_ROUNDS + 3 }, (_, i) => ({
        pending: { state: { round: i }, calls: [{ id: `c${i}`, name: "lookup", input: {} }] },
      })),
    );
    const result = await runAgentLoop(endpoint, [{ role: "user", content: "hi" }], {
      tools: [tool("lookup", {})],
      maxRounds: 3,
      runRound: scripted.runRound,
    });
    expect(scripted.count).toBe(3);
    expect(result.finishReason).toBe("round_limit");
    expect(result.rounds).toBe(3);
    expect(result.toolResults).toHaveLength(3);
  });

  it("rejects invalid budgets before starting the runtime", async () => {
    const runRound = vi.fn(async () => null);
    for (const maxRounds of [NaN, Infinity, 0, -1, 1.5]) {
      await expect(runAgentLoop(endpoint, [], { maxRounds, runRound })).rejects.toThrow(
        /maxRounds/,
      );
    }
    expect(runRound).not.toHaveBeenCalled();
  });

  it("streams text from every round through one callback", async () => {
    const scripted = runtime(
      { text: "一", pending: { calls: [{ id: "c1", name: "lookup", input: {} }] } },
      { text: "二" },
    );
    const chunks: string[] = [];
    const result = await runAgentLoop(endpoint, [{ role: "user", content: "hi" }], {
      tools: [tool("lookup", {})],
      runRound: scripted.runRound,
      onDelta: (chunk) => chunks.push(chunk),
    });
    expect(chunks).toEqual(["一", "二"]);
    expect(result.text).toBe("一二");
  });

  it("propagates a failed turn instead of returning partial text", async () => {
    const failing: RunRound = async () => {
      throw new AgentError("模型返回错误");
    };
    await expect(
      runAgentLoop(endpoint, [{ role: "user", content: "hi" }], { runRound: failing }),
    ).rejects.toThrow("模型返回错误");
  });
});
