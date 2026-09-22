import { describe, expect, it, vi } from "vitest";
import { createAgentHost } from "../src/host";
import { agentConfigured } from "../src/settings";

describe("host-local model settings", () => {
  it("isolates endpoints and credentials across hosts", () => {
    const first = createAgentHost(),
      second = createAgentHost();
    const listener = vi.fn();
    second.settings.subscribe(listener);
    first.settings.configure({
      baseUrl: " https://example.test/v1/ ",
      apiKey: " secret ",
      model: " model ",
    });
    expect(first.settings.getSnapshot()).toEqual({
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      model: "model",
    });
    expect(agentConfigured(second.settings.getSnapshot())).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    first.settings.configure(null);
    expect(first.settings.getSnapshot().apiKey).toBe("");
  });
  it("keeps equivalent snapshots stable and supports unsubscribing", () => {
    const { settings } = createAgentHost(),
      listener = vi.fn();
    const off = settings.subscribe(listener);
    settings.configure({ baseUrl: "http://localhost/v1", apiKey: "", model: "local" });
    const snapshot = settings.getSnapshot();
    settings.configure({ ...snapshot });
    expect(settings.getSnapshot()).toBe(snapshot);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    settings.configure(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
