import { describe, expect, it, vi } from "vitest";
import { artifactStore, ArtifactStoreTag } from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Context, Effect, Layer } from "effect";
import { createWorkspaceServices, workspaceServices } from "../src/workspace";
import { newNote } from "../src/knowledge/model";

describe("workspace service ownership", () => {
  it("retains one unavailable service through wrappers and isolates sibling sessions", async () => {
    const context = await Effect.runPromise(
      Effect.scoped(Layer.build(artifactStore({ opfs: new MemoryStore() }))),
    );
    const artifacts = Context.get(context, ArtifactStoreTag);
    const context2 = await Effect.runPromise(
      Effect.scoped(Layer.build(artifactStore({ opfs: new MemoryStore() }))),
    );
    const otherArtifacts = Context.get(context2, ArtifactStoreTag);
    const first = { artifacts },
      second = { artifacts: otherArtifacts };
    const workspace = workspaceServices(first);
    expect(workspaceServices({ ...first })).toBe(workspace);
    expect(workspaceServices(second)).not.toBe(workspace);
    await expect(workspace.knowledge.ready).rejects.toThrow("持久化不可用");
    expect(workspaceServices({ ...first }).knowledge).toBe(workspace.knowledge);
    await Promise.all([workspace.close(), workspaceServices(second).close()]);
  });

  it("does not initialize unrelated services during startup or shutdown", async () => {
    const get = vi.fn(async () => undefined);
    const workspace = createWorkspaceServices({ get, set: async () => {} });
    await workspace.close();
    expect(get).not.toHaveBeenCalled();
    expect(() => workspace.knowledge).toThrow("关闭");
  });

  it("recovers the shared knowledge instance without deadlocking queued failed writes", async () => {
    let failing = true;
    const records = new Map<string, string>();
    const workspace = createWorkspaceServices({
      get: async (key) => {
        if (failing) throw new Error("transient storage failure");
        return records.get(key);
      },
      set: async (key, value) => {
        records.set(key, value);
      },
    });
    const store = workspace.knowledge;
    await expect(store.ready).rejects.toThrow("transient");
    const failedWrite = store.saveNote(newNote("before retry"), null);
    const rejected = expect(failedWrite).rejects.toThrow("transient");
    failing = false;
    const retried = store.retryInitialization();
    expect(store.retryInitialization()).toBe(retried);
    await Promise.all([retried, rejected]);
    const published: number[] = [];
    store.subscribe(() => published.push(Object.keys(store.getSnapshot().notes).length));
    await store.saveNote(newNote("after retry"), null);
    expect(workspace.knowledge).toBe(store);
    expect(published).toEqual([1]);
    const restored = createWorkspaceServices({
      get: async (key) => records.get(key),
      set: async () => {},
    });
    await restored.knowledge.ready;
    expect(Object.values(restored.knowledge.getSnapshot().notes)[0]?.title).toBe("after retry");
    await Promise.all([workspace.close(), restored.close()]);
  });
  it("waits for accepted package reads before releasing metadata", async () => {
    const gate = Promise.withResolvers<string | undefined>(),
      entered = Promise.withResolvers<void>();
    const workspace = createWorkspaceServices({
      get: async (key) => {
        if (key.includes("research-package-")) {
          entered.resolve();
          return gate.promise;
        }
        return undefined;
      },
      set: async () => {},
    });
    const reading = workspace.research.readPackageRecord("export");
    await entered.promise;
    let closed = false;
    const closing = workspace.close().then(() => {
      closed = true;
    });
    await expect(workspace.research.readPackageRecord("export")).rejects.toThrow("关闭");
    expect(closed).toBe(false);
    gate.resolve("record");
    expect(await reading).toBe("record");
    await closing;
  });
  it("shares stores within one metadata session and isolates different sessions", async () => {
    const metadata = () => ({ get: async () => undefined, set: async () => {} });
    const first = { metadata: metadata() },
      second = { metadata: metadata() };
    expect(workspaceServices(first)).toBe(workspaceServices(first));
    expect(workspaceServices(first).knowledge).not.toBe(workspaceServices(second).knowledge);
    await Promise.all([workspaceServices(first).close(), workspaceServices(second).close()]);
  });

  it("drains both research queues and rejects new work during closing", async () => {
    const gate = Promise.withResolvers<void>(),
      entered = Promise.withResolvers<void>();
    const writes: string[] = [];
    const workspace = createWorkspaceServices({
      get: async () => undefined,
      set: async (key) => {
        entered.resolve();
        await gate.promise;
        writes.push(key);
      },
    });
    const knowledge = workspace.knowledge;
    await workspace.research.ready;
    const library = workspace.research.update((value) => value);
    const record = workspace.research.writePackageRecord("export", "{}");
    await entered.promise;
    let closed = false;
    const closing = workspace.close();
    expect(workspace.close()).toBe(closing);
    void closing.then(() => {
      closed = true;
    });
    await expect(workspace.research.update((value) => value)).rejects.toThrow("关闭");
    await expect(workspace.research.writePackageRecord("export", "{}")).rejects.toThrow("关闭");
    expect(closed).toBe(false);
    gate.resolve();
    await Promise.all([library, record, closing]);
    expect(writes).toHaveLength(2);
    await expect(knowledge.saveNote(newNote("late"), null)).rejects.toThrow("关闭");
  });

  it("publishes a single sync state and waits for the accepted sync's final commit", async () => {
    const data = new Map<string, string>();
    const workspace = createWorkspaceServices({
      get: async (key) => data.get(key),
      set: async (key, value) => {
        data.set(key, value);
      },
    });
    const store = workspace.knowledge,
      gate = Promise.withResolvers<void>();
    const states: boolean[] = [];
    store.subscribeSync(() => states.push(store.getSyncSnapshot()));
    const sync = store.runSync(async () => {
      await gate.promise;
      await store.saveNote(newNote("receipt"), null);
    });
    expect(store.syncing).toBe(true);
    await expect(store.runSync(async () => {})).rejects.toThrow("正在进行");
    const closing = workspace.close();
    await expect(store.runSync(async () => {})).rejects.toThrow("关闭");
    gate.resolve();
    await Promise.all([sync, closing]);
    expect(Object.values(store.getSnapshot().notes)[0]?.title).toBe("receipt");
    expect(states).toEqual([true, false]);
  });
});
