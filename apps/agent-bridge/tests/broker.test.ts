import { describe, expect, it, vi } from "vitest";
import { BridgeBroker, sameToken, type BrowserPeer } from "../src/broker";
import { decodeCatalog, type BridgeCatalog } from "@bcr/agent/bridge";

const token = "a".repeat(64);
const catalog: BridgeCatalog = {
  workspace: "workspace-one",
  label: "BCR",
  files: true,
  write: false,
  tools: [
    {
      name: "read",
      description: "Read",
      capability: "notes",
      risk: "read_only",
      input_schema: { type: "object" },
    },
    {
      name: "write",
      description: "Write",
      capability: "notes",
      risk: "high",
      input_schema: { type: "object" },
    },
  ],
};
function setup(write = false) {
  const sent: Record<string, unknown>[] = [],
    broker = new BridgeBroker(token);
  const peer: BrowserPeer = { send: (raw) => sent.push(JSON.parse(raw)), close: vi.fn() };
  broker.receive(
    peer,
    JSON.stringify({ type: "hello", version: 1, token, catalog: { ...catalog, write } }),
  );
  return { broker, peer, sent };
}
describe("external agent broker", () => {
  it("rejects invalid credentials including non-ASCII values without throwing", () => {
    expect(sameToken("中".repeat(64), token)).toBe(false);
    const broker = new BridgeBroker(token),
      peer = { send: vi.fn(), close: vi.fn() };
    broker.receive(peer, JSON.stringify({ type: "hello", version: 1, token: "wrong", catalog }));
    expect(peer.close).toHaveBeenCalled();
    expect(broker.connected).toBe(false);
  });
  it("pins the workspace and rejects a second browser without replacing the owner", () => {
    const { broker, peer } = setup(),
      other = { send: vi.fn(), close: vi.fn() };
    broker.receive(other, JSON.stringify({ type: "hello", version: 1, token, catalog }));
    expect(broker.owns(peer)).toBe(true);
    expect(other.close).toHaveBeenCalled();
    broker.detach(peer);
    broker.receive(
      other,
      JSON.stringify({
        type: "hello",
        version: 1,
        token,
        catalog: { ...catalog, workspace: "different" },
      }),
    );
    expect(broker.connected).toBe(false);
  });
  it("rejects writes and file imports independently of catalog visibility", async () => {
    const { broker } = setup();
    await expect(broker.invoke({ kind: "tool", name: "write", input: {} })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      broker.invoke({ kind: "file.import", transfer: "x", name: "x", mime: "text/plain" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(broker.invoke({ kind: "tool", name: "unknown", input: {} })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    broker.close();
  });
  it("correlates concurrent calls and preserves structured domain failures", async () => {
    const { broker, peer, sent } = setup(true);
    const first = broker.invoke({ kind: "tool", name: "read", input: {} });
    const second = broker.invoke({ kind: "tool", name: "write", input: {} });
    const failure = expect(second).rejects.toMatchObject({
      code: "TOOL_ERROR",
      message: "revision conflict",
    });
    broker.receive(
      peer,
      JSON.stringify({
        type: "result",
        id: sent[2]!.id,
        error: { code: "TOOL_ERROR", message: "revision conflict" },
      }),
    );
    broker.receive(
      peer,
      JSON.stringify({ type: "result", id: sent[1]!.id, result: { revision: "v1" } }),
    );
    await expect(first).resolves.toEqual({ revision: "v1" });
    await failure;
    broker.close();
  });
  it("rejects pending calls on disconnect and ignores late results after reconnect", async () => {
    const { broker, peer, sent } = setup();
    const call = broker.invoke({ kind: "tool", name: "read", input: {} });
    const failure = expect(call).rejects.toMatchObject({ code: "WORKSPACE_DISCONNECTED" });
    broker.detach(peer);
    await failure;
    broker.receive(peer, JSON.stringify({ type: "hello", version: 1, token, catalog }));
    broker.receive(peer, JSON.stringify({ type: "result", id: sent[1]!.id, result: "late" }));
    expect(broker.connected).toBe(true);
    broker.close();
  });
  it("cancels the exact in-flight call", async () => {
    const { broker, sent } = setup(),
      controller = new AbortController();
    const call = broker.invoke({ kind: "tool", name: "read", input: {} }, controller.signal);
    const failure = expect(call).rejects.toMatchObject({ code: "CANCELLED" });
    controller.abort();
    await failure;
    expect(sent.at(-1)).toEqual({ type: "cancel", id: sent[1]!.id });
    broker.close();
  });
  it("settles calls when sending to the browser fails", async () => {
    const { broker, peer } = setup();
    peer.send = () => {
      throw new Error("socket closed");
    };
    await expect(broker.invoke({ kind: "tool", name: "read", input: {} })).rejects.toMatchObject({
      code: "WORKSPACE_DISCONNECTED",
    });
    expect(broker.connected).toBe(false);
  });
  it("times out rather than leaving promises pending", async () => {
    vi.useFakeTimers();
    try {
      const { broker } = setup();
      const call = broker.invoke({ kind: "tool", name: "read", input: {} });
      const failure = expect(call).rejects.toMatchObject({ code: "TIMEOUT" });
      await vi.advanceTimersByTimeAsync(180001);
      await failure;
      broker.close();
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects duplicate or reserved tool names", () => {
    expect(() =>
      decodeCatalog({ ...catalog, tools: [catalog.tools[0], catalog.tools[0]] }),
    ).toThrow();
    expect(() =>
      decodeCatalog({ ...catalog, tools: [{ ...catalog.tools[0], name: "bcr_bridge_status" }] }),
    ).toThrow();
  });
});
