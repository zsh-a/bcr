import { describe, expect, it, vi } from "vitest";
import { createAgentHost } from "../src/host";
import { conversationHistory } from "../src/conversationHistory";
import { restoreConversationArchive } from "../src/conversationArchive";
import type { RunRound } from "../src/loop";
import type { ConversationArchive } from "../src/conversationTypes";

const endpoint = { baseUrl: "http://test/v1", apiKey: "secret-not-persisted", model: "test" };
function setup(
  runRound: RunRound,
  storage?: { load: () => Promise<unknown>; save: (value: ConversationArchive) => Promise<void> },
) {
  const host = createAgentHost({ runRound, ...(storage ? { storage } : {}) });
  host.settings.configure(endpoint);
  return host;
}
const completed: RunRound = async (_endpoint, _messages, round) => {
  round.onDelta?.("done");
  return null;
};

describe("host-owned conversations", () => {
  it("retains ordered text and native tool history, without credentials or UI state", async () => {
    const save = vi.fn(async (_archive: ConversationArchive) => {});
    const host = setup(
      async (_endpoint, _messages, round) => {
        if (round.resume) {
          round.onDelta?.("after");
          return null;
        }
        round.onDelta?.("before");
        return { state: {}, toolCalls: [{ id: "call", name: "read", input: {} }] };
      },
      { load: async () => null, save },
    );
    host.registerAgentCapability({
      id: "reads",
      label: "Reads",
      tools: [
        {
          spec: { name: "read", risk: "read_only" },
          call: async () => "null",
          presentation: { kind: "test", version: 1, label: "Read" },
        },
      ],
    });
    const manager = host.conversations;
    await manager.ready;
    await manager.send(manager.getSnapshot().activeId, "hello");
    const runs = manager.getSnapshot().conversations[0]!.runs;
    expect(runs[0]?.parts.map((part) => part.type)).toEqual(["text", "tool", "text"]);
    expect(runs[0]?.parts[1]).toMatchObject({ risk: "read_only" });
    expect(conversationHistory(runs)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "before" },
      { role: "assistant", content: "", toolCalls: [{ id: "call", name: "read", input: {} }] },
      { role: "tool", toolCallId: "call", content: "null" },
      { role: "assistant", content: "after" },
    ]);
    const archive = save.mock.calls.at(-1)![0];
    expect(JSON.stringify(archive)).not.toContain(endpoint.apiKey);
    expect(restoreConversationArchive(archive)).toEqual(archive);
    expect(archive).not.toHaveProperty("options");
  });

  it("keeps a background run in its original conversation and preserves the other draft", async () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const host = setup(async (_endpoint, _messages, round) => {
      started.resolve();
      await finish.promise;
      round.onDelta?.("original reply");
      return null;
    });
    const manager = host.conversations;
    const first = manager.getSnapshot().activeId;
    const run = manager.send(first, "original");
    await started.promise;
    const second = manager.create();
    manager.setDraft(second, "unsent");
    await expect(manager.send(second, "parallel")).rejects.toThrow("请先完成");
    finish.resolve();
    await run;
    expect(manager.getSnapshot().activeId).toBe(second);
    expect(manager.getSnapshot().conversations[0]?.runs[0]?.parts).toMatchObject([
      { text: "original reply" },
    ]);
    expect(manager.getSnapshot().conversations[1]).toMatchObject({ draft: "unsent", runs: [] });
    manager.select(first);
    expect(manager.getSnapshot().conversations).toHaveLength(2);
    expect(createAgentHost().conversations.getSnapshot().conversations[0]?.runs).toEqual([]);
    manager.dispose();
  });

  it("cancels even when a subscriber stops a task before its first model round", async () => {
    const round = vi.fn(completed);
    const manager = setup(round).conversations;
    manager.subscribe(() => {
      const running = manager.getSnapshot().running;
      if (running) manager.cancel(running.runId);
    });
    await manager.send(manager.getSnapshot().activeId, "stop now");
    expect(round).not.toHaveBeenCalled();
    expect(manager.getSnapshot().conversations[0]?.runs[0]?.status).toBe("cancelled");
    expect(manager.getSnapshot().running).toBeNull();
  });

  it("expires recovered approvals and never replays a tool", async () => {
    const waiting = Promise.withResolvers<ConversationArchive>();
    const round = vi.fn<RunRound>(async (_endpoint, _messages, opts) =>
      opts.resume ? null : { state: {}, toolCalls: [{ id: "write", name: "write", input: {} }] },
    );
    const host = setup(round);
    const call = vi.fn(async () => "{}");
    host.registerAgentCapability({
      id: "write",
      label: "Write",
      tools: [{ spec: { name: "write", risk: "high" }, call }],
    });
    const manager = host.conversations;
    manager.subscribe(() => {
      const state = manager.getSnapshot();
      if (state.conversations[0]?.runs[0]?.status === "awaiting_approval")
        waiting.resolve(
          structuredClone({
            version: 1,
            activeId: state.activeId,
            conversations: state.conversations,
          }),
        );
    });
    const task = manager.send(manager.getSnapshot().activeId, "write");
    const archive = await waiting.promise;
    const recoveredRound = vi.fn(completed);
    const recovered = setup(recoveredRound, {
      load: async () => archive,
      save: async () => {},
    }).conversations;
    await recovered.ready;
    const run = recovered.getSnapshot().conversations[0]!.runs[0]!;
    expect(run.status).toBe("interrupted");
    expect(run.parts[0]).toMatchObject({ approval: { decision: "expired" } });
    expect(recovered.resolveApproval(run.id, "write", true)).toBe(false);
    expect(recoveredRound).not.toHaveBeenCalled();
    expect(conversationHistory([run]).at(-1)?.content).toContain("结果未知");
    manager.cancel(manager.getSnapshot().running!.runId);
    await task;
    expect(call).not.toHaveBeenCalled();
  });

  it("accepts approval only once for the matching run and rechecks disabled capabilities", async () => {
    const host = setup(async (_endpoint, _messages, round) =>
      round.resume ? null : { state: {}, toolCalls: [{ id: "write", name: "write", input: {} }] },
    );
    const call = vi.fn(async () => "{}");
    host.registerAgentCapability({
      id: "write",
      label: "Write",
      tools: [{ spec: { name: "write", risk: "high" }, call }],
    });
    const manager = host.conversations;
    let approved = false;
    manager.subscribe(() => {
      const state = manager.getSnapshot();
      if (!approved && state.conversations[0]?.runs[0]?.status === "awaiting_approval") {
        approved = true;
        expect(manager.resolveApproval("stale", "write", true)).toBe(false);
        manager.setOptions({ disabledCapabilities: ["write"] });
        expect(manager.resolveApproval(state.running!.runId, "write", true)).toBe(true);
        expect(manager.resolveApproval(state.running!.runId, "write", true)).toBe(false);
      }
    });
    await manager.send(manager.getSnapshot().activeId, "write");
    expect(call).not.toHaveBeenCalled();
    expect(manager.getSnapshot().conversations[0]?.runs[0]?.parts[0]).toMatchObject({
      result: { is_error: true },
      approval: { decision: "approved" },
    });
  });

  it("retains write receipts after a failed resume and refuses unsafe retries", async () => {
    const host = setup(async (_endpoint, _messages, round) => {
      if (round.resume) throw new Error("network failed after write");
      return { state: {}, toolCalls: [{ id: "write", name: "write", input: {} }] };
    });
    const call = vi.fn(async () => '{"saved":true}');
    host.registerAgentCapability({
      id: "write",
      label: "Write",
      tools: [{ spec: { name: "write", risk: "high" }, call }],
    });
    const manager = host.conversations;
    manager.subscribe(() => {
      const state = manager.getSnapshot();
      if (state.running) manager.resolveApproval(state.running.runId, "write", true);
    });
    const id = manager.getSnapshot().activeId;
    await manager.send(id, "write");
    const run = manager.getSnapshot().conversations[0]!.runs[0]!;
    expect(run.status).toBe("failed");
    expect(run.parts[0]).toMatchObject({ result: { output: { saved: true } } });
    expect(() => manager.retry(id, run.id)).toThrow("不能直接重试");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("allows retry before any tool call", async () => {
    let attempt = 0;
    const manager = setup(async (...args) => {
      if (++attempt === 1) throw new Error("unavailable");
      return completed(...args);
    }).conversations;
    const id = manager.getSnapshot().activeId;
    await manager.send(id, "retry");
    await manager.retry(id, manager.getSnapshot().conversations[0]!.runs[0]!.id);
    expect(manager.getSnapshot().conversations[0]?.runs.map((run) => run.status)).toEqual([
      "failed",
      "completed",
    ]);
  });

  it("does not overwrite invalid storage and exposes save failure without losing messages", async () => {
    const save = vi.fn(async () => {});
    const damaged = setup(completed, { load: async () => ({ version: 99 }), save }).conversations;
    await damaged.ready;
    await damaged.send(damaged.getSnapshot().activeId, "safe in memory");
    expect(save).not.toHaveBeenCalled();
    expect(damaged.getSnapshot().storageError).toContain("原始存档未覆盖");
    const failed = setup(completed, {
      load: async () => null,
      save: async () => {
        throw new Error("quota");
      },
    }).conversations;
    await failed.ready;
    await failed.send(failed.getSnapshot().activeId, "keep this");
    expect(failed.getSnapshot().storageError).toContain("会话保存失败");
    expect(failed.getSnapshot().conversations[0]?.runs[0]?.status).toBe("completed");
  });
});
