import { Effect, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRuntime } from "@bcr/runtime-browser";
import { MemoryStore } from "@bcr/storage-opfs";
import type { SqliteDb } from "@bcr/storage-sqlite";
import { artifactPath, type ArtifactRef } from "@bcr/core";
import { demoResearch } from "../src/jsg/demo";
import { DEFAULT_CONFIG } from "../src/jsg/model";
import { researchService, closeResearchService } from "../src/jsg/research-service";
import { restoreSession } from "../src/jsg/session";

async function setup() {
  const binary = new MemoryStore(),
    records = new Map<string, string>();
  const manifest = demoResearch().manifest;
  const manifestRef: ArtifactRef = {
    id: "jsg/manifest/seed",
    type: "quant/jsg-manifest",
    storage: "opfs",
  };
  const partitions: ArtifactRef[] = manifest.partitions.map((_, i) => ({
    id: `jsg/input/seed-${i}`,
    type: "quant/jsg-daily",
    storage: "opfs",
  }));
  await binary.put(artifactPath(manifestRef), new TextEncoder().encode(JSON.stringify(manifest)));
  for (const ref of partitions) await binary.put(artifactPath(ref), new Uint8Array([1]));
  records.set(
    "jsg-project-v1",
    JSON.stringify({
      dataset: { manifestRef, partitions },
      config: DEFAULT_CONFIG,
      resultRef: null,
    }),
  );
  let closed = false;
  const db: SqliteDb = {
    run: () => {},
    all: () => [],
    value: () => undefined,
    persist: async () => {},
    kvGet: async (key) => records.get(key),
    kvSet: async (key, value) => {
      if (closed) throw new Error("metadata already closed");
      records.set(key, value);
    },
    close: async () => {
      closed = true;
    },
  };
  let artifacts: Parameters<typeof closeResearchService>[0];
  const runtime = await createBrowserRuntime({
    namespace: "quant-service-test",
    store: binary,
    openMetadata: async () => db,
    beforeDispose: () => closeResearchService(artifacts),
    execution: (owned) => {
      artifacts = owned;
      return {
        executors: [
          {
            runtime: "wasm",
            version: "test",
            operations: ["quant.backtest.jsg"],
            run: () => Stream.fromEffect(Effect.never),
          },
        ],
        dispose: () => {},
      };
    },
  });
  return { runtime, records, binary };
}

describe("headless research ownership", () => {
  it("shares the service across views and flushes project and draft changes on host shutdown", async () => {
    const { runtime } = await setup();
    const service = researchService(runtime);
    expect(researchService({ ...runtime })).toBe(service);
    const first = service.initialize();
    expect(service.initialize()).toBe(first);
    await first;
    expect(service.getSnapshot().state.error).toBeNull();
    expect(service.getSnapshot().state.dataset).not.toBeNull();
    const listener = vi.fn(),
      detach = service.subscribe(listener);
    service.actions.createProject("跨策略研究");
    service.actions.change({ stockCount: 6 });
    expect(listener).toHaveBeenCalled();
    detach();
    await runtime.host.dispose();
    const restored = await restoreSession(runtime);
    expect(restored?.projects.some((project) => project.name === "跨策略研究")).toBe(true);
    expect(restored?.draft.stockCount).toBe(6);
    await expect(service.actions.run()).rejects.toThrow("关闭");
  });

  it("keeps accepted work alive when a view detaches, then cancels and drains it before closing", async () => {
    const { runtime, records } = await setup();
    const service = researchService(runtime);
    await service.initialize();
    service.actions.change({ stockCount: 7 });
    const detach = service.subscribe(() => {});
    const running = service.actions.run();
    await vi.waitFor(() => expect(service.getSnapshot().state.operation?.kind).toBe("backtest"));
    detach();
    expect(service.getSnapshot().state.operation).not.toBeNull();
    await runtime.host.dispose();
    await running;
    expect(JSON.parse(records.get("jsg-session-v2")!).draft.stockCount).toBe(7);
    expect(runtime.host.sessions()).toEqual([]);
    await expect(service.actions.flush()).rejects.toThrow("关闭");
  });
});
