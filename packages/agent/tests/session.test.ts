import { describe, expect, it, vi } from "vitest";
import { createAgentHost } from "../src/host";
import { createAgentSession } from "../src/session";
import type { AgentTool } from "../src/runtime";
import type { RunRound } from "../src/loop";

const endpoint = { baseUrl: "http://test/v1", apiKey: "", model: "test" };
const options = {
  workspaceId: "notes",
  workspaceLabel: "笔记",
  includeContext: true,
  disabledCapabilities: [] as string[],
};
const messages = [{ role: "user" as const, content: "执行任务" }];
const scripted: RunRound = async (_endpoint, _messages, round) => {
  if (!round.resume) return { state: {}, toolCalls: [{ id: "call-1", name: "test", input: {} }] };
  round.onDelta?.("完成");
  return null;
};
function setup(tool: AgentTool, getOptions = () => options) {
  const host = createAgentHost();
  host.registerAgentCapability({ id: "test", label: "Test", tools: [tool] });
  return createAgentSession(getOptions, host, scripted);
}

describe("agent session", () => {
  it("retains completed tool receipts when the following model round fails", async () => {
    const host = createAgentHost();
    host.registerAgentCapability({
      id: "test",
      label: "Test",
      tools: [{ spec: { name: "test", risk: "read_only" }, call: async () => '{"saved":true}' }],
    });
    const session = createAgentSession(
      () => options,
      host,
      async (endpoint, messages, round) => {
        if (round.resume) throw new Error("gateway unavailable");
        return scripted(endpoint, messages, round);
      },
    );
    await expect(session.run(endpoint, messages, new AbortController().signal)).rejects.toThrow(
      "gateway unavailable",
    );
    expect(session.getSnapshot()).toMatchObject({
      status: "failed",
      running: false,
      toolCalls: [{ id: "call-1" }],
      toolResults: [{ tool_call_id: "call-1", output: { saved: true } }],
    });
  });
  it("executes without React and passes cancellation and invocation identity to tools", async () => {
    const call = vi.fn(async () => '{"ok":true}');
    const session = setup({ spec: { name: "test", risk: "read_only" }, call });
    const controller = new AbortController();
    const result = await session.run(endpoint, messages, controller.signal);
    expect(call).toHaveBeenCalledWith("{}", { signal: controller.signal, callId: "call-1" });
    expect(result.toolResults[0]?.output).toEqual({ ok: true });
    expect(session.getSnapshot()).toMatchObject({ running: false, text: "完成", approval: null });
  });

  it("holds writes until approved and rechecks capability availability", async () => {
    let current = { ...options };
    const call = vi.fn(async () => "{}");
    const session = setup({ spec: { name: "test", risk: "high" }, call }, () => current);
    const stop = session.subscribe(() => {
      const approval = session.getSnapshot().approval;
      if (approval) {
        expect(call).not.toHaveBeenCalled();
        current = { ...current, disabledCapabilities: ["test"] };
        approval.settle(true);
      }
    });
    try {
      const result = await session.run(endpoint, messages, new AbortController().signal);
      expect(call).not.toHaveBeenCalled();
      expect(result.toolResults[0]?.is_error).toBe(true);
    } finally {
      stop();
    }
  });

  it("cancels pending approval and leaves no pending state", async () => {
    const controller = new AbortController();
    const call = vi.fn(async () => "{}");
    const session = setup({ spec: { name: "test", risk: "high" }, call });
    const stop = session.subscribe(() => {
      if (session.getSnapshot().approval) controller.abort();
    });
    try {
      await expect(session.run(endpoint, messages, controller.signal)).rejects.toThrow();
      expect(call).not.toHaveBeenCalled();
      expect(session.getSnapshot()).toMatchObject({ running: false, approval: null });
    } finally {
      stop();
    }
  });

  it("rejects stale edits even when the user approves", async () => {
    const host = createAgentHost();
    let text = "before";
    const write = vi.fn();
    host.registerSurface({
      kind: "note",
      label: "Note",
      read: () => ({
        text,
        range: { start: 0, end: text.length },
        scope: "all",
        instruction: "edit",
      }),
      write,
    });
    host.activateSurface("note");
    const round: RunRound = async (_endpoint, _messages, opts) =>
      opts.resume
        ? null
        : {
            state: {},
            toolCalls: [{ id: "edit", name: "apply_text_edit", input: { replacement: "after" } }],
          };
    const session = createAgentSession(() => options, host, round);
    const stop = session.subscribe(() => {
      const approval = session.getSnapshot().approval;
      if (approval) {
        text = "changed";
        approval.settle(true);
      }
    });
    try {
      const result = await session.run(endpoint, messages, new AbortController().signal);
      expect(write).not.toHaveBeenCalled();
      expect(result.toolResults[0]?.is_error).toBe(true);
    } finally {
      stop();
    }
  });

  it("isolates capability registries between hosts", () => {
    const first = createAgentHost(),
      second = createAgentHost();
    first.registerAgentCapability({ id: "private", label: "Private", tools: [] });
    expect(first.agentCapabilities()).toHaveLength(1);
    expect(second.agentCapabilities()).toEqual([]);
  });

  it.each([false, true])(
    "waits for durable edits and propagates storage failure=%s",
    async (fail) => {
      const host = createAgentHost();
      const saved = Promise.withResolvers<{ id: string; version: string }>();
      const started = Promise.withResolvers<void>();
      host.registerSurface({
        kind: "note",
        label: "Note",
        read: () => ({
          text: "before",
          range: { start: 0, end: 6 },
          scope: "all",
          instruction: "edit",
        }),
        write: () => {
          started.resolve();
          return saved.promise;
        },
      });
      host.activateSurface("note");
      let resumed = false;
      const round: RunRound = async (_endpoint, _messages, opts) => {
        if (opts.resume) {
          resumed = true;
          return null;
        }
        return {
          state: {},
          toolCalls: [{ id: "edit", name: "apply_text_edit", input: { replacement: "after" } }],
        };
      };
      const session = createAgentSession(() => options, host, round);
      const stop = session.subscribe(() => session.getSnapshot().approval?.settle(true));
      try {
        const running = session.run(endpoint, messages, new AbortController().signal);
        await started.promise;
        expect(resumed).toBe(false);
        expect(session.getSnapshot().running).toBe(true);
        if (fail) saved.reject(new Error("disk full"));
        else saved.resolve({ id: "note", version: "saved-version" });
        const result = await running;
        if (fail)
          expect(result.toolResults[0]).toMatchObject({
            is_error: true,
            output: { error: "Error: disk full" },
          });
        else
          expect(result.toolResults[0]?.output).toMatchObject({
            status: "saved",
            id: "note",
            version: "saved-version",
          });
      } finally {
        stop();
      }
    },
  );
});
