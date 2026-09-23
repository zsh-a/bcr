import { describe, expect, it, vi } from "vitest";
import { createAgentHost, createAgentSession } from "@bcr/agent";
import { knowledgeCapability } from "../src/knowledge/agent";
import { KnowledgeStore } from "../src/knowledge/store";
import { newNote } from "../src/knowledge/model";
import { noteRevision } from "../src/knowledge/noteRevision";

async function setup() {
  const data = new Map<string, string>();
  const metadata = {
    get: async (key: string) => data.get(key),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
  };
  const store = new KnowledgeStore(metadata);
  await store.ready;
  const tools = knowledgeCapability(store).tools;
  const create = tools.find((tool) => tool.spec.name === "knowledge_create_note")!;
  const update = tools.find((tool) => tool.spec.name === "knowledge_update_note")!;
  const input = JSON.stringify({
    requestId: "test-request",
    title: "AI 笔记",
    body: "original",
    tags: ["AI"],
  });
  return { store, metadata, create, update, input };
}

describe("shared knowledge writes", () => {
  it("previews without writing, saves durably, and deduplicates creation across reload", async () => {
    const s = await setup();
    expect(await s.create.preview!(s.input)).toMatchObject({
      before: "",
      after: expect.stringContaining("original"),
    });
    expect(s.metadata.set).not.toHaveBeenCalled();
    const result = JSON.parse(await s.create.call(s.input));
    expect(result).toMatchObject({
      status: "saved",
      title: "AI 笔记",
      body: "original",
      revision: expect.any(String),
    });
    const restored = new KnowledgeStore(s.metadata);
    await restored.ready;
    const create = knowledgeCapability(restored).tools.find(
      (tool) => tool.spec.name === "knowledge_create_note",
    )!;
    const repeated = JSON.parse(await create.call(s.input));
    expect(repeated.id).toBe(result.id);
    expect(s.metadata.set).toHaveBeenCalledTimes(1);
    await expect(
      create.call(JSON.stringify({ ...JSON.parse(s.input), body: "different" })),
    ).rejects.toThrow("请求已使用");
  });
  it("protects metadata revisions, retains untouched fields and stores history", async () => {
    const s = await setup();
    const note = { ...newNote("Original"), body: "body", tags: ["keep"] };
    await s.store.saveNote(note, null);
    const raw = JSON.stringify({ id: note.id, revision: noteRevision(note), body: "changed" });
    const preview = await s.update.preview!(raw);
    expect(preview.before).toContain("body");
    expect(preview.after).toContain("changed");
    const saved = JSON.parse(await s.update.call(raw));
    expect(saved).toMatchObject({
      status: "saved",
      title: "Original",
      tags: ["keep"],
      body: "changed",
    });
    expect(s.store.getSnapshot().history[0]?.note).toEqual(note);
    await expect(s.update.call(raw)).rejects.toThrow("版本已变化");
    const current = s.store.getSnapshot().notes[note.id]!;
    await s.store.saveNote({ ...current, title: "renamed" }, current);
    await expect(
      s.update.call(JSON.stringify({ id: note.id, revision: saved.revision, body: "overwrite" })),
    ).rejects.toThrow("版本已变化");
  });
  it("rechecks drafts and revisions inside the durable write queue", async () => {
    const s = await setup();
    const note = newNote("Test");
    await s.store.saveNote(note, null);
    let dirty = false;
    const unregister = s.store.registerDraft(note.id, () => dirty);
    const raw = JSON.stringify({ id: note.id, revision: noteRevision(note), body: "AI" });
    await s.update.preview!(raw);
    dirty = true;
    await expect(s.update.call(raw)).rejects.toThrow("草稿");
    dirty = false;
    const started = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    s.metadata.set.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
    });
    const prior = s.store.saveCollection("group", "Group");
    await started.promise;
    const pending = s.update.call(raw);
    await Promise.resolve();
    dirty = true;
    release.resolve();
    await prior;
    await expect(pending).rejects.toThrow("草稿");
    expect(s.store.getSnapshot().notes[note.id]?.body).toBe("");
    unregister();
  });
  it("rejects recovery drafts, malformed arguments, missing collections, conflicts and cancellation", async () => {
    const s = await setup();
    const note = newNote("Test");
    await s.store.saveNote(note, null);
    const raw = JSON.stringify({ id: note.id, revision: noteRevision(note), body: "AI" });
    const tool = knowledgeCapability(s.store, () => {
      throw new Error("恢复草稿");
    }).tools.find((tool) => tool.spec.name === "knowledge_update_note")!;
    await expect(tool.preview!(raw)).rejects.toThrow("恢复草稿");
    for (const patch of [
      { collectionId: "missing" },
      { title: "" },
      { tags: [4] },
      { unexpected: true },
      { requestId: "__proto__" },
    ]) {
      await expect(
        s.create.call(JSON.stringify({ ...JSON.parse(s.input), ...patch })),
      ).rejects.toThrow();
    }
    const controller = new AbortController();
    controller.abort();
    await expect(
      s.create.call(s.input, { callId: "call", signal: controller.signal }),
    ).rejects.toThrow();
    await s.store.update((state) => ({
      ...state,
      conflicts: [{ kind: "note", key: note.id, base: note, local: note, remote: note }],
    }));
    await expect(s.update.call(raw)).rejects.toThrow("同步冲突");
  });
  it("never returns saved when persistence fails", async () => {
    const s = await setup();
    s.metadata.set.mockRejectedValueOnce(new Error("disk full"));
    await expect(s.create.call(s.input)).rejects.toThrow("disk full");
    expect(Object.keys(s.store.getSnapshot().notes)).toHaveLength(0);
  });
  it.each([true, false])(
    "requires host approval in a different workspace: approved=%s",
    async (approved) => {
      const s = await setup(),
        host = createAgentHost();
      host.registerAgentCapability(knowledgeCapability(s.store));
      const session = createAgentSession(
        () => ({
          workspaceId: "studio",
          workspaceLabel: "Studio",
          includeContext: false,
          disabledCapabilities: [],
        }),
        host,
        async (_endpoint, _messages, round) =>
          round.resume
            ? null
            : {
                state: {},
                toolCalls: [
                  { id: "create", name: "knowledge_create_note", input: JSON.parse(s.input) },
                ],
              },
      );
      session.subscribe(() => {
        const approval = session.getSnapshot().approval;
        if (approval) {
          expect(approval.preview?.after).toContain("AI 笔记");
          expect(s.metadata.set).not.toHaveBeenCalled();
          approval.settle(approved);
        }
      });
      await session.run(
        { baseUrl: "http://test/v1", apiKey: "", model: "test" },
        [{ role: "user", content: "保存笔记" }],
        new AbortController().signal,
      );
      expect(Object.keys(s.store.getSnapshot().notes)).toHaveLength(approved ? 1 : 0);
    },
  );
});
