import { describe, expect, it } from "vitest";
import { newNote } from "../src/knowledge/model";
import { noteSearchHit, searchKnowledge } from "../src/knowledge/retrieval";
import { knowledgeCapability } from "../src/knowledge/agent";
import { KnowledgeStore } from "../src/knowledge/store";

describe("knowledge retrieval", () => {
  it("ranks titles over recent body hits and normalizes Unicode", () => {
    const titled = { ...newNote("ＡＩ"), updatedAt: 1 };
    const recent = { ...newNote("Recent"), body: "ai", updatedAt: 2 };
    expect(searchKnowledge([recent, titled], "AI").hits.map((hit) => hit.note.id)).toEqual([
      titled.id,
      recent.id,
    ]);
    expect(searchKnowledge([recent, titled], "AI", { limit: 1 }).nextOffset).toBe(1);
    expect(searchKnowledge([recent, titled], "AI", { limit: 1, offset: 1 }).hits[0]?.note.id).toBe(
      recent.id,
    );
  });
  it("returns the matching passage and original offsets, not just the beginning", () => {
    const note = { ...newNote("Note"), body: "前文".repeat(500) + "ＡＩ 的结论" };
    const hit = noteSearchHit(note, "AI");
    expect(hit.preview).toContain("ＡＩ");
    expect(hit.match).toEqual({ start: 1000, end: 1002 });
    expect(note.body.slice(hit.previewRange.start, hit.previewRange.end)).toBe(hit.preview);
    expect(hit.route).toContain(note.id);
  });
  it("guards paginated reads by version and preserves provenance", async () => {
    const store = new KnowledgeStore({ get: async () => undefined, set: async () => {} });
    const note = {
      ...newNote("Note"),
      body: "x".repeat(12001),
      citations: [
        {
          id: "citation",
          documentId: "reader:book",
          title: "Book",
          source: "reader" as const,
          route: "/reader?book=book",
          text: "quote",
          note: "",
          savedAt: 1,
        },
      ],
    };
    await store.saveNote(note, null);
    const read = knowledgeCapability(store).tools.find(
      (tool) => tool.spec.name === "knowledge_read_note",
    )!;
    const first = JSON.parse(await read.call(JSON.stringify({ id: note.id })));
    expect(first.nextOffset).toBe(12000);
    expect(first.citations[0].quote).toBe("quote");
    await store.saveNote({ ...note, body: "changed" }, note);
    await expect(
      read.call(JSON.stringify({ id: note.id, offset: 12000, version: first.version })),
    ).rejects.toThrow("版本已变化");
  });
});
