import { describe, expect, it, vi } from "vitest";
import { DiagramStore } from "../src/diagram/store";
import {
  decodeDocument,
  decodeIndex,
  decodeScene,
  diagramKey,
  DIAGRAM_INDEX,
  emptyScene,
  nativeFile,
  type DiagramScene,
} from "../src/diagram/model";
import { parseGraph } from "../src/diagram/graph";
import { diagramCapability } from "../src/diagram/agent";

function setup() {
  const data = new Map<string, string>();
  const metadata = {
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    batch: vi.fn(async (entries: ReadonlyArray<readonly [string, string | undefined]>) => {
      for (const [key, value] of entries) {
        if (value === undefined) data.delete(key);
        else data.set(key, value);
      }
    }),
  };
  const store = new DiagramStore(metadata);
  return { store, metadata, data };
}

describe("drawing persistence and live revisions", () => {
  it("drains accepted creation and dirty drafts before closing and rejects new work", async () => {
    const s = setup();
    const gate = Promise.withResolvers<void>(),
      entered = Promise.withResolvers<void>();
    const commit = s.metadata.batch.getMockImplementation()!;
    s.metadata.batch.mockImplementationOnce(async (entries) => {
      entered.resolve();
      await gate.promise;
      await commit(entries);
    });
    const creating = s.store.create("Accepted");
    await entered.promise;
    const closing = s.store.close();
    expect(s.store.close()).toBe(closing);
    await expect(s.store.create("Late")).rejects.toThrow("关闭");
    await expect(s.store.open("late")).rejects.toThrow("关闭");
    gate.resolve();
    const draft = await creating;
    await closing;
    expect(decodeDocument(s.data.get(diagramKey(draft.getSnapshot().document.id))!).title).toBe(
      "Accepted",
    );
    expect(() => draft.change({ title: "Late" })).toThrow("关闭");

    const dirty = setup(),
      pending = await dirty.store.create("Before");
    pending.change({ title: "Unsaved" });
    await dirty.store.close();
    expect(
      decodeDocument(dirty.data.get(diagramKey(pending.getSnapshot().document.id))!).title,
    ).toBe("Unsaved");
  });
  it("loads only the index until a drawing is opened and atomically saves one document", async () => {
    const s = setup();
    const draft = await s.store.create("架构图");
    const id = draft.getSnapshot().document.id;
    expect(s.metadata.batch.mock.calls[0]![0].map(([key]) => key)).toEqual([
      diagramKey(id),
      DIAGRAM_INDEX,
    ]);
    const restored = new DiagramStore(s.metadata);
    await restored.ready;
    const reads = s.metadata.get.mock.calls.length;
    expect(restored.getSnapshot()[0]?.title).toBe("架构图");
    expect((await restored.open(id)).getSnapshot().document.scene).toEqual(emptyScene());
    expect(s.metadata.get.mock.calls.slice(reads)).toEqual([[diagramKey(id)]]);
    expect(JSON.parse(nativeFile(draft.getSnapshot().document))).toMatchObject({
      type: "excalidraw",
      version: 2,
      elements: [],
    });
    await Promise.all([s.store.close(), restored.close()]);
  });
  it("keeps failed saves in memory, retries uncertain commits without duplicating writes", async () => {
    const s = setup(),
      draft = await s.store.create("Original");
    draft.change({ title: "Changed" });
    const commit = s.metadata.batch.getMockImplementation()!;
    s.metadata.batch.mockImplementationOnce(async (entries) => {
      await commit(entries);
      throw new Error("lost receipt");
    });
    await expect(draft.flush()).rejects.toThrow("lost receipt");
    expect(draft.getSnapshot()).toMatchObject({
      dirty: true,
      error: "lost receipt",
      document: { title: "Changed" },
    });
    await draft.flush();
    expect(draft.getSnapshot()).toMatchObject({ dirty: false, error: "" });
    expect(s.metadata.batch).toHaveBeenCalledTimes(2);
    await s.store.close();
  });
  it("does not overwrite a newer manual draft while an earlier save is awaiting persistence", async () => {
    const s = setup(),
      draft = await s.store.create("Original");
    const gate = Promise.withResolvers<void>(),
      entered = Promise.withResolvers<void>();
    const commit = s.metadata.batch.getMockImplementation()!;
    s.metadata.batch.mockImplementationOnce(async (entries) => {
      entered.resolve();
      await gate.promise;
      await commit(entries);
    });
    draft.change({ title: "First" });
    const saving = draft.flush();
    await entered.promise;
    draft.change({ title: "Second" });
    gate.resolve();
    expect((await saving).title).toBe("First");
    expect(draft.getSnapshot()).toMatchObject({ dirty: true, document: { title: "Second" } });
    await draft.flush();
    expect(decodeDocument(s.data.get(diagramKey(draft.getSnapshot().document.id))!).title).toBe(
      "Second",
    );
    await s.store.close();
  });
  it("rejects stale AI revisions and conflicting writes from another window", async () => {
    const s = setup(),
      first = await s.store.create("Original"),
      id = first.getSnapshot().document.id;
    const secondStore = new DiagramStore(s.metadata),
      second = await secondStore.open(id);
    const revision = first.getSnapshot().document.revision;
    first.change({ title: "Manual" });
    expect(() => first.apply(emptyScene(), revision)).toThrow("画布已变化");
    await first.flush();
    second.change({ title: "Stale" });
    await expect(second.flush()).rejects.toThrow("其他窗口");
    expect(decodeDocument(s.data.get(diagramKey(id))!).title).toBe("Manual");
    // Avoid an abandoned debounce timer; the conflict remains explicit to the caller.
    await expect(second.close()).rejects.toThrow("其他窗口");
    await s.store.close();
  });
  it("deduplicates AI creation, rejects a reused identity with different content, and removes atomically", async () => {
    const s = setup(),
      identity = { id: "ai-once", creationKey: "request-hash" };
    const first = await s.store.create("AI", emptyScene(), identity);
    expect(await s.store.create("AI", emptyScene(), identity)).toBe(first);
    expect(s.metadata.batch).toHaveBeenCalledTimes(1);
    await expect(
      s.store.create("Different", emptyScene(), { ...identity, creationKey: "different" }),
    ).rejects.toThrow("内容不同");
    await s.store.remove(identity.id, first.getSnapshot().document.revision);
    expect(s.data.has(diagramKey(identity.id))).toBe(false);
    expect(decodeIndex(s.data.get(DIAGRAM_INDEX))).toEqual([]);
    await expect(s.store.open(identity.id)).rejects.toThrow("不存在");
    await s.store.close();
  });
  it("retains corrupt data and fails closed when atomic storage is unavailable", async () => {
    const s = setup();
    await s.store.ready;
    s.data.set(DIAGRAM_INDEX, "broken");
    const broken = new DiagramStore(s.metadata);
    await expect(broken.ready).rejects.toThrow();
    await expect(broken.create()).rejects.toThrow();
    expect(s.data.get(DIAGRAM_INDEX)).toBe("broken");
    const readonly = new DiagramStore({ get: async () => undefined, set: async () => {} });
    await expect(readonly.create()).rejects.toThrow("原子保存");
    await Promise.all([s.store.close(), broken.close(), readonly.close()]);
  });
  it("offers bounded live reads and approval-gated writes without mounting the drawing editor", async () => {
    const s = setup(),
      draft = await s.store.create("Saved");
    const capability = diagramCapability(s.store);
    expect(capability.scope).toBe("shared");
    for (const tool of capability.tools.filter((tool) =>
      /diagram_(create|patch|layout)$/.test(tool.spec.name),
    )) {
      expect(tool.spec.risk).toBe("high");
      expect(tool.preview).toBeTypeOf("function");
    }
    draft.change({ title: "Live draft" });
    const read = capability.tools.find((tool) => tool.spec.name === "diagram_read")!;
    const args = { id: draft.getSnapshot().document.id };
    const output = JSON.parse(await read.call(JSON.stringify(args)));
    expect(output).toMatchObject({
      title: "Live draft",
      state: "draft",
      selection: [],
      elements: [],
    });
    await expect(read.call(JSON.stringify({ ...args, offset: 100 }))).rejects.toThrow("画布已变化");
    await expect(read.call(JSON.stringify({ ...args, revision: "old" }))).rejects.toThrow(
      "画布已变化",
    );
    await s.store.close();
  });
});

describe("diagram input boundaries", () => {
  it("validates node identities, colors and referenced endpoints", () => {
    const graph = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ id: "ab", source: "a", target: "b" }],
    };
    expect(parseGraph(graph).direction).toBe("RIGHT");
    for (const invalid of [
      { ...graph, edges: [{ id: "a", source: "a", target: "b" }] },
      { ...graph, edges: [{ id: "e", source: "a", target: "missing" }] },
      { nodes: [{ id: "__proto__", label: "bad" }] },
      { nodes: [{ id: "a", label: "A", strokeColor: "url(bad)" }] },
    ])
      expect(() => parseGraph(invalid)).toThrow();
    expect(() =>
      decodeScene({ ...emptyScene(), elements: [{ id: "a", type: "rectangle", x: Infinity }] }),
    ).toThrow();
    const base = { id: "a", x: 0, y: 0, width: 10, height: 10, angle: 0, version: 1 };
    expect(() =>
      decodeScene({
        ...emptyScene(),
        elements: [
          {
            ...base,
            type: "arrow",
            points: [
              [0, 0],
              [NaN, 1],
            ],
          },
        ],
      }),
    ).toThrow("坐标");
    expect(() =>
      decodeScene({ ...emptyScene(), elements: [{ ...base, type: "text", text: null }] }),
    ).toThrow("文字");
    expect(() =>
      decodeScene({
        ...emptyScene(),
        files: { bad: { id: "bad", dataURL: "https://remote", mimeType: "image/png" } },
      } as unknown as DiagramScene),
    ).toThrow();
  });
});
