import { describe, expect, it, vi } from "vitest";
import { executeAgentTool } from "../src/execution";
import type { AgentTool } from "../src/runtime";
describe("transport independent execution", () => {
  const make = (): AgentTool => ({
    spec: { name: "write", risk: "high" },
    preview: async () => ({ before: "old", after: "new", targetLabel: "Note" }),
    call: vi.fn(async () => '{"saved":true}'),
  });
  it("reauthorizes after async preparation and never calls a revoked tool", async () => {
    const tool = make();
    let allowed = true;
    await expect(
      executeAgentTool(
        tool,
        "{}",
        { callId: "id" },
        {
          authorize: () => {
            if (!allowed) throw new Error("revoked");
          },
          approve: async () => {
            allowed = false;
            return true;
          },
        },
      ),
    ).rejects.toThrow("revoked");
    expect(tool.call).not.toHaveBeenCalled();
  });
  it("does not perform a declined write", async () => {
    const tool = make();
    await expect(
      executeAgentTool(
        tool,
        "{}",
        { callId: "id" },
        { authorize: () => {}, approve: async () => false },
      ),
    ).rejects.toThrow("未批准");
    expect(tool.call).not.toHaveBeenCalled();
  });
  it("honors cancellation while preparing and parses durable receipts", async () => {
    const tool = make(),
      abort = new AbortController();
    await expect(
      executeAgentTool(
        tool,
        "{}",
        { callId: "id", signal: abort.signal },
        {
          authorize: () => {},
          approve: async () => {
            abort.abort();
            return true;
          },
        },
      ),
    ).rejects.toThrow();
    expect(tool.call).not.toHaveBeenCalled();
    await expect(
      executeAgentTool(
        tool,
        "{}",
        { callId: "retry" },
        { authorize: () => {}, approve: async () => true },
      ),
    ).resolves.toEqual({ saved: true });
  });
});
