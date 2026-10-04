import { describe, expect, it } from "vitest";
import { createWorkspaceServices } from "../src/workspace";
import {
  createKnowledgeActions,
  researchToKnowledge,
  importSharedNote,
} from "../src/knowledge/notes/actions";
import type { ResearchLibrary } from "../src/research/model";

describe("knowledge application operations", () => {
  it("waits for the draft barrier before creating and stops on save failure", async () => {
    const data = new Map<string, string>();
    const workspace = createWorkspaceServices({
      get: async (key) => data.get(key),
      set: async (key, value) => {
        data.set(key, value);
      },
    });
    const gate = Promise.withResolvers<void>();
    const actions = createKnowledgeActions(
      workspace.knowledge,
      workspace.research,
      () => gate.promise,
    );
    const creating = actions.create(null);
    expect(Object.keys(workspace.knowledge.getSnapshot().notes)).toHaveLength(0);
    gate.resolve();
    const id = await creating;
    expect(workspace.knowledge.getSnapshot().notes[id]).toBeDefined();
    const blocked = createKnowledgeActions(workspace.knowledge, workspace.research, async () => {
      throw new Error("draft conflict");
    });
    await expect(blocked.create(null)).rejects.toThrow("draft conflict");
    await expect(blocked.exportBackup()).rejects.toThrow("draft conflict");
    expect(Object.keys(workspace.knowledge.getSnapshot().notes)).toHaveLength(1);
    await workspace.close();
  });

  it("retries a shared note without duplicating or overwriting later edits", async () => {
    const data = new Map<string, string>();
    const workspace = createWorkspaceServices({
      get: async (key) => data.get(key),
      set: async (key, value) => {
        data.set(key, value);
      },
    });
    const share = {
      id: "receipt-1",
      title: "收藏",
      text: "稍后阅读 https://example.com",
      url: "https://example.com",
    };
    const id = await importSharedNote(workspace.knowledge, share);
    const original = workspace.knowledge.getSnapshot().notes[id]!;
    expect(original.body).toBe(share.text);
    await workspace.knowledge.saveNote({ ...original, body: "我补充的想法" }, original);
    expect(await importSharedNote(workspace.knowledge, share)).toBe(id);
    expect(Object.keys(workspace.knowledge.getSnapshot().notes)).toEqual([id]);
    expect(workspace.knowledge.getSnapshot().notes[id]?.body).toBe("我补充的想法");
    await workspace.close();
  });

  it("converts research with stable identities and preserves source evidence without mutation", () => {
    const library: ResearchLibrary = {
      version: 1,
      collections: [
        {
          id: "group",
          name: "Reading",
          excerpts: [
            {
              id: "excerpt",
              documentId: "doc",
              title: "Quote",
              source: "reader",
              route: "/reader?book=1",
              text: "first\nsecond",
              note: "my thought",
              savedAt: 1,
            },
          ],
        },
      ],
    };
    const before = JSON.stringify(library),
      first = researchToKnowledge(library),
      second = researchToKnowledge(library);
    expect(Object.keys(first.notes)).toEqual(Object.keys(second.notes));
    expect(Object.keys(first.collections)).toEqual(Object.keys(second.collections));
    expect(Object.values(first.notes)[0]).toMatchObject({
      body: "> first\n> second\n\nmy thought",
      citations: [library.collections[0]!.excerpts[0]],
    });
    expect(JSON.stringify(library)).toBe(before);
  });
});
