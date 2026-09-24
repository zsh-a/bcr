import { describe, expect, it, vi } from "vitest";
import { createSearchIndex } from "@bcr/core";
import { createKnowledgePublisher } from "../src/knowledge/search";
import { newNote, type KnowledgeContent } from "../src/knowledge/model";

const a = { ...newNote("Alpha"), id: "a", body: "alpha text", updatedAt: 1 };
const b = { ...newNote("Beta"), id: "b", body: "beta text", updatedAt: 1 };
const initial: KnowledgeContent = { notes: { a, b }, collections: {} };

describe("incremental knowledge projections", () => {
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
    publisher.publish({ notes: { b }, collections: {} });
    expect(search.documents().map((doc) => doc.id)).toEqual(["knowledge:b:0"]);
  });
  it("updates collection names and paths and can be fully rebuilt from canonical notes", async () => {
    const search = createSearchIndex();
    await search.ready;
    const publisher = createKnowledgePublisher(search);
    const content = {
      notes: { a: { ...a, collectionId: "group", path: "项目/想法.md" } },
      collections: { group: { id: "group", name: "Old" } },
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
    publisher.publish({ notes: { a }, collections: {} });
    await search.close();
    const reopened = createSearchIndex(persistence);
    await reopened.ready;
    expect(reopened.isSourceLive("knowledge")).toBe(false);
    expect(reopened.documents()).toHaveLength(1);
    createKnowledgePublisher(reopened).publish({ notes: {}, collections: {} });
    expect(reopened.documents()).toEqual([]);
    expect(reopened.isSourceLive("knowledge")).toBe(true);
    await reopened.close();
  });
});
