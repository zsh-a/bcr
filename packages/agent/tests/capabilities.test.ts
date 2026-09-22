import { describe, expect, it } from "vitest";
import {
  agentCapabilities,
  availableAgentCapabilities,
  registerAgentCapability,
} from "../src/capabilities";

describe("agent capabilities", () => {
  it("registers domain tools and removes them with their owner", () => {
    const capability = { id: "test.lookup", label: "查找", tools: [] };
    const unregister = registerAgentCapability(capability);
    expect(agentCapabilities()).toContain(capability);
    expect(() => registerAgentCapability(capability)).toThrow(/Duplicate/);
    unregister();
    expect(agentCapabilities()).not.toContain(capability);
  });
  it("shares explicit shared capabilities and limits workspace capabilities to their domain", () => {
    const shared = registerAgentCapability({
      id: "test.shared",
      label: "共享",
      domain: "knowledge",
      scope: "shared",
      tools: [],
    });
    const local = registerAgentCapability({
      id: "test.local",
      label: "当前领域",
      domain: "knowledge",
      scope: "workspace",
      tools: [],
    });
    try {
      expect(availableAgentCapabilities("knowledge").map((item) => item.id)).toEqual([
        "test.shared",
        "test.local",
      ]);
      expect(availableAgentCapabilities("studio").map((item) => item.id)).toEqual(["test.shared"]);
      expect(
        availableAgentCapabilities("knowledge", ["test.shared"]).map((item) => item.id),
      ).toEqual(["test.local"]);
    } finally {
      local();
      shared();
    }
  });
});
