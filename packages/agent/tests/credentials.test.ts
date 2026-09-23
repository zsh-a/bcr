import { describe, expect, it } from "vitest";
import {
  createCredentialStore,
  normalizeEndpointUrl,
  type SettingsStorage,
} from "../src/credentials";
import { createAgentSettings } from "../src/settings";

function memory(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}
describe("credential persistence", () => {
  it("keeps memory credentials out of storage", () => {
    const session = memory(),
      device = memory(),
      store = createCredentialStore({ session, device });
    store.save("agent:a", "secret", "memory");
    expect(store.get("agent:a").value).toBe("secret");
    expect(session.data.size + device.data.size).toBe(0);
    expect(createCredentialStore({ session, device }).get("agent:a").value).toBe("");
  });
  it("restores session credentials on reload, not in a fresh tab", () => {
    const session = memory(),
      device = memory();
    createCredentialStore({ session, device }).save("agent:a", "secret", "session");
    expect(createCredentialStore({ session, device }).get("agent:a").value).toBe("secret");
    expect(createCredentialStore({ session: memory(), device }).get("agent:a").value).toBe("");
    expect(device.data.size).toBe(0);
  });
  it("removes previous copies on downgrade and deletion; isolates providers", () => {
    const session = memory(),
      device = memory(),
      store = createCredentialStore({ session, device });
    store.save("agent:a", "secret", "device");
    store.save("github:owner/repo", "token", "device");
    expect(createCredentialStore({ device }).get("agent:a").value).toBe("secret");
    store.save("agent:a", "secret", "session");
    expect(createCredentialStore({ device }).get("agent:a").value).toBe("");
    store.save("agent:a", "secret", "memory");
    expect(session.data.size).toBe(0);
    store.save("github:owner/repo", "", "memory");
    expect(device.data.size).toBe(0);
  });
  it("fails visibly without disclosing the secret or claiming old copies were cleared", () => {
    const broken: SettingsStorage = {
      getItem: () => {
        throw new Error("secret");
      },
      setItem: () => {
        throw new Error("secret");
      },
      removeItem: () => {
        throw new Error("secret");
      },
    };
    const store = createCredentialStore({ device: broken });
    expect(store.get("test").error).toBeTruthy();
    const result = store.save("test", "private-key", "device");
    expect(result.scope).toBe("memory");
    expect(result.error).toContain("旧副本可能未清除");
    expect(result.error).not.toContain("secret");
    expect(result.value).toBe("private-key");
  });
  it("does not overwrite corrupted records on read", () => {
    const device = memory();
    device.setItem("bcr/credentials/v1/test", "bad-json");
    expect(createCredentialStore({ device }).get("test").error).toBeTruthy();
    expect(device.getItem("bcr/credentials/v1/test")).toBe("bad-json");
  });
});
describe("connection metadata", () => {
  const endpoint = { baseUrl: "https://example.test/v1", model: "model", apiKey: "secret" };
  it("restores metadata separately, requiring a memory-only key to be refilled", () => {
    const profile = memory(),
      device = memory();
    createAgentSettings(profile, createCredentialStore({ device })).configure(endpoint);
    expect([...profile.data.values()].join("")).not.toContain("secret");
    const restored = createAgentSettings(profile, createCredentialStore({ device }));
    expect(restored.getSnapshot()).toEqual({ ...endpoint, apiKey: "" });
    expect(restored.getPersistenceSnapshot().needsKey).toBe(true);
  });
  it("restores an opted-in key and clears it when the endpoint changes", () => {
    const profile = memory(),
      device = memory();
    createAgentSettings(profile, createCredentialStore({ device })).configure(endpoint, "device");
    const restored = createAgentSettings(profile, createCredentialStore({ device }));
    expect(restored.getSnapshot()).toEqual(endpoint);
    restored.configure({ ...endpoint, baseUrl: "https://other.test/v1" }, "device");
    expect(restored.getSnapshot().apiKey).toBe("");
    expect(device.data.size).toBe(0);
    restored.configure(null);
    expect(profile.data.size).toBe(0);
  });
  it("supports local endpoints without a key and normalizes harmless trailing slashes", () => {
    const profile = memory();
    createAgentSettings(profile).configure({ baseUrl: "/api/llm/v1/", model: "mimo", apiKey: "" });
    const restored = createAgentSettings(profile);
    expect(restored.getSnapshot().baseUrl).toBe("/api/llm/v1");
    expect(restored.getPersistenceSnapshot().needsKey).toBe(false);
  });
  it.each([
    "https://user:secret@example.test/v1",
    "https://example.test/v1?api_key=secret",
    "https://example.test/#secret",
    "javascript:alert(1)",
    "//example.test/v1",
  ])("rejects unsafe address %s", (address) => {
    expect(() => normalizeEndpointUrl(address)).toThrow();
  });
});
