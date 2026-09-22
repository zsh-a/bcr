import { describe, expect, it } from "vitest";
import { createWorkspaceServices, workspaceServices } from "../src/workspace";
import { newNote } from "../src/knowledge/model";

describe("workspace service ownership", () => {
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
    const first = metadata(),
      second = metadata();
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
    await expect(workspace.knowledge.saveNote(newNote("late"), null)).rejects.toThrow("关闭");
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
