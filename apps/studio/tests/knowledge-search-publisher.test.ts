import { describe, expect, it, vi } from "vitest";
import { createSearchIndex } from "@bcr/core";
import { createAgentHost } from "@bcr/agent";
import { createBrowserRuntime } from "@bcr/runtime-browser";
import { MemoryStore } from "@bcr/storage-opfs";
import { knowledgePlugin } from "../src/knowledge/plugin";
import { workspaceServices } from "../src/workspace";
import { createKnowledgePublisher } from "../src/knowledge/search";
import { newNote, type KnowledgeContent } from "../src/knowledge/model";

const a = { ...newNote("Alpha"), id: "a", body: "alpha text", updatedAt: 1 };
const b = { ...newNote("Beta"), id: "b", body: "beta text", updatedAt: 1 };
const initial: KnowledgeContent = { notes: { a, b }, collections: {}, folders: [] };

describe("incremental knowledge projections", () => {
  it("recovers existing search and Agent subscriptions after knowledge initialization fails", async () => {
    let fail = true;
    const records = new Map<string, string>();
    const session = await createBrowserRuntime({
      namespace: "knowledge-retry",
      store: new MemoryStore(),
      openMetadata: async () => ({
        run: () => {},
        all: () => [],
        value: () => undefined,
        persist: async () => {},
        close: async () => {},
        kvGet: async (key) => {
          if (fail) throw new Error("temporary database failure");
          return records.get(key);
        },
        kvSet: async (key, value) => {
          records.set(key, value);
        },
      }),
      execution: () => ({ executors: [], dispose: () => {} }),
    });
    const search = createSearchIndex(),
      agent = createAgentHost(),
      reportError = vi.fn();
    const runtime = { ...session, search };
    const store = workspaceServices(runtime).knowledge;
    const dispose = knowledgePlugin.activate({ runtime, agent, reportError });
    const capability = agent.agentCapabilities()[0]!;
    const find = capability.tools.find((tool) => tool.spec.name === "knowledge_find_notes")!;
    try {
      await expect(store.ready).rejects.toThrow("temporary");
      await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(expect.any(Error)));
      fail = false;
      await store.retryInitialization();
      await store.saveNote({ ...newNote("原地恢复"), body: "共享实例保持一致" }, null);
      await vi.waitFor(() =>
        expect(search.documents().some((doc) => doc.title === "原地恢复")).toBe(true),
      );
      expect(agent.agentCapabilities()[0]).toBe(capability);
      expect(JSON.parse(await find.call(JSON.stringify({ query: "共享实例" }))).notes).toHaveLength(
        1,
      );
      expect(reportError).toHaveBeenLastCalledWith(undefined);
    } finally {
      dispose();
      await workspaceServices(runtime).close();
      await search.close();
      await session.dispose();
      agent.conversations.dispose();
    }
  });
  it("rebuilds stale persisted projections once, then preserves untouched document identity", async () => {
    const search = createSearchIndex();
    await search.ready;
    search.upsert({
      id: "old",
      source: "knowledge",
      kind: "knowledge-note",
      title: "stale",
      updatedAt: 0,
    });
    const replace = vi.spyOn(search, "replaceSource"),
      patch = vi.spyOn(search, "patchSource");
    const publisher = createKnowledgePublisher(search);
    publisher.publish(initial);
    expect(search.documents().some((doc) => doc.id === "old")).toBe(false);
    const untouched = search.documents().find((doc) => doc.id === "knowledge:b:0");
    publisher.publish(structuredClone(initial));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
    publisher.publish({ ...initial, notes: { a: { ...a, body: "changed" }, b } });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]?.[1].upsert.map((doc) => doc.id)).toEqual(["knowledge:a:0"]);
    expect(search.documents().find((doc) => doc.id === "knowledge:b:0")).toBe(untouched);
    expect(search.search("changed")[0]?.document.id).toBe("knowledge:a:0");
  });
  it("removes stale chunks after shortening a note and removes all chunks on deletion", async () => {
    const search = createSearchIndex();
    await search.ready;
    const publisher = createKnowledgePublisher(search);
    publisher.publish({
      ...initial,
      notes: { ...initial.notes, a: { ...a, body: "long ".repeat(1000) } },
    });
    expect(search.documents().filter((doc) => doc.id.startsWith("knowledge:a:"))).toHaveLength(3);
    publisher.publish(initial);
    expect(search.documents().filter((doc) => doc.id.startsWith("knowledge:a:"))).toHaveLength(1);
    publisher.publish({ notes: { b }, collections: {}, folders: [] });
    expect(search.documents().map((doc) => doc.id)).toEqual(["knowledge:b:0"]);
  });
  it("updates collection names and paths and can be fully rebuilt from canonical notes", async () => {
    const search = createSearchIndex();
    await search.ready;
    const publisher = createKnowledgePublisher(search);
    const content = {
      notes: { a: { ...a, collectionId: "group", path: "项目/想法.md" } },
      collections: { group: { id: "group", name: "Old" } },
      folders: [],
    };
    publisher.publish(content);
    publisher.publish({ ...content, collections: { group: { id: "group", name: "Renamed" } } });
    expect(search.documents()[0]?.subtitle).toBe("Renamed · 项目/想法.md");
    expect(search.search("项目")).toHaveLength(1);
    search.removeSource("knowledge");
    expect(search.documents()).toHaveLength(0);
    publisher.publish(content, true);
    expect(search.documents()[0]?.subtitle).toBe("Old · 项目/想法.md");
  });
  it("persists projected changes and treats reload as unverified until republished", async () => {
    let raw: string | undefined;
    const persistence = {
      load: async () => raw,
      save: async (value: string) => {
        raw = value;
      },
    };
    const search = createSearchIndex(persistence);
    await search.ready;
    const publisher = createKnowledgePublisher(search);
    publisher.publish(initial);
    publisher.publish({ notes: { a }, collections: {}, folders: [] });
    await search.close();
    const reopened = createSearchIndex(persistence);
    await reopened.ready;
    expect(reopened.isSourceLive("knowledge")).toBe(false);
    expect(reopened.documents()).toHaveLength(1);
    createKnowledgePublisher(reopened).publish({ notes: {}, collections: {}, folders: [] });
    expect(reopened.documents()).toEqual([]);
    expect(reopened.isSourceLive("knowledge")).toBe(true);
    await reopened.close();
  });
});
