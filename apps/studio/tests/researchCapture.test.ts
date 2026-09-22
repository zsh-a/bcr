import { describe, expect, it } from "vitest";
import { createTextCitation, textVersion, type RuntimeMetadata } from "@bcr/core";
import { saveResearchCapture } from "../src/research/capture";
import { workspaceServices } from "../src/workspace";

function setup() {
  const data = new Map<string, string>();
  let fail = false;
  const metadata: RuntimeMetadata = {
    get: async (key) => data.get(key),
    set: async (key, value) => {
      if (fail) throw new Error("disk full");
      data.set(key, value);
    },
  };
  const text = "A selected sentence. Another sentence.";
  const citation = createTextCitation(
    text,
    { scope: "reader", unit: "body", offset: 0, version: textVersion(text) },
    { start: 2, end: 10 },
  );
  const capture = {
    document: {
      id: "body",
      source: "reader",
      kind: "reader-section" as const,
      title: "Chapter",
      route: "/reader?book=one",
      updatedAt: 1,
    },
    citation,
    note: "My note",
  };
  return {
    metadata,
    capture,
    store: workspaceServices(metadata).research,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

describe("direct research capture", () => {
  it("shares the workspace queue and atomically creates a collection with a cited note", async () => {
    const { metadata, store, capture } = setup();
    expect(workspaceServices(metadata).research).toBe(store);
    await saveResearchCapture(store, { id: "new", name: "Reading" }, capture);
    const excerpt = store.getSnapshot().collections[0]!.excerpts[0]!;
    expect(excerpt).toMatchObject({ note: "My note", citation: capture.citation, owner: "reader" });
    expect(excerpt.route).toContain("cite=");
    await expect(
      saveResearchCapture(store, { id: "new" }, { ...capture, note: "replace?" }),
    ).resolves.toBe("duplicate");
    expect(store.getSnapshot().collections[0]!.excerpts).toEqual([excerpt]);
  });
  it("keeps failed captures unpublished and supports retry without losing concurrent edits", async () => {
    const { store, capture, fail } = setup();
    await store.ready;
    fail(true);
    await expect(
      saveResearchCapture(store, { id: "new", name: "Reading" }, capture),
    ).rejects.toThrow("disk full");
    expect(store.getSnapshot().collections).toEqual([]);
    fail(false);
    await Promise.all([
      saveResearchCapture(store, { id: "new", name: "Reading" }, capture),
      saveResearchCapture(store, { id: "other", name: "Other" }, capture),
    ]);
    expect(store.getSnapshot().collections.map((collection) => collection.id)).toEqual([
      "new",
      "other",
    ]);
    await expect(saveResearchCapture(store, { id: "missing" }, capture)).rejects.toThrow("不存在");
  });
});
