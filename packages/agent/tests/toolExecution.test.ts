import { describe, expect, it, vi } from "vitest";
import { createAgentHost } from "../src/host";
import { createToolDecision } from "../src/toolExecution";
import type { AgentTool } from "../src/runtime";
import type { AgentSurface } from "../src/surface";

describe("shared tool execution policy", () => {
  it.each(["read_only", "high"] as const)(
    "normalizes failures on the same execution path (%s)",
    async (risk) => {
      const host = createAgentHost();
      const tool: AgentTool = {
        spec: { name: "test", risk },
        call: async () => {
          throw new Error("failed write");
        },
      };
      host.registerAgentCapability({ id: "domain", label: "Domain", tools: [tool] });
      const decide = createToolDecision({
        host,
        getOptions: () => ({
          workspaceId: "domain",
          workspaceLabel: "Domain",
          includeContext: true,
          disabledCapabilities: [],
        }),
        surface: null,
        target: null,
        signal: new AbortController().signal,
        onApproval: (approval) => approval?.settle(true),
        onActivity: () => {},
      });
      expect(await decide({ id: "call", name: "test", input: {} }, tool)).toMatchObject({
        is_error: true,
        output: { error: "Error: failed write" },
      });
    },
  );

  it("revokes surface-contributed tools when their owning capability is disabled", async () => {
    const host = createAgentHost(),
      call = vi.fn(async () => "ok");
    const tool: AgentTool = { spec: { name: "read", risk: "read_only" }, call };
    const surface: AgentSurface = {
      kind: "note",
      capabilityId: "domain",
      label: "Note",
      tools: [tool],
      read: () => null,
      write: async () => ({ id: "note", version: "1" }),
    };
    host.registerAgentCapability({ id: "domain", label: "Domain", tools: [] });
    host.registerSurface(surface);
    host.activateSurface("note");
    const decide = createToolDecision({
      host,
      getOptions: () => ({
        workspaceId: "domain",
        workspaceLabel: "Domain",
        includeContext: true,
        disabledCapabilities: ["domain"],
      }),
      surface,
      target: null,
      signal: new AbortController().signal,
      onApproval: () => {},
      onActivity: () => {},
    });
    expect(await decide({ id: "call", name: "read", input: {} }, tool)).toHaveProperty("reject");
    expect(call).not.toHaveBeenCalled();
  });

  it("refreshes a summary without replacing the active edit target", () => {
    const host = createAgentHost();
    let label = "Before";
    const surface: AgentSurface = {
      kind: "note",
      get label() {
        return label;
      },
      read: () => null,
      write: async () => ({ id: "note", version: "1" }),
    };
    host.registerSurface(surface);
    host.activateSurface("note");
    const before = host.surfaceSummary();
    label = "After";
    host.refreshSurface(surface);
    expect(host.activeSurface()).toBe(surface);
    expect(host.surfaceSummary()).not.toBe(before);
    expect(host.surfaceSummary()?.label).toBe("After");
  });
});
