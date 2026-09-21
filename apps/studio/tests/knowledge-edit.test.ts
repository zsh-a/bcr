import { describe, expect, it } from "vitest";
import { newNote, type KnowledgeNote } from "../src/knowledge/model";
import { KnowledgeStore } from "../src/knowledge/store";
import {
  applyEdits,
  changeFor,
  EditError,
  insertAt,
  isCurrent,
  minimalChange,
  preview,
  replaceAll,
  resolve,
  targetRange,
  targetText,
  type EditProposal,
} from "../src/knowledge/edit";

const body = "第一段\n\n第二段\n\n第三段\n";
const note = (value = body): KnowledgeNote => ({
  ...newNote("笔记"),
  id: "note-one",
  body: value,
  createdAt: 1,
  updatedAt: 1,
});

describe("range edits", () => {
  it("keeps untouched edges intact so distant edits stay mergeable", () => {
    expect(minimalChange("head\nmiddle\ntail\n", "head\nMIDDLE\ntail\n")).toEqual({
      from: 5,
      to: 11,
      insert: "MIDDLE",
    });
    expect(minimalChange(body, body)).toBeNull();
    expect(minimalChange("", "new")).toEqual({ from: 0, to: 0, insert: "new" });
  });
  it("applies a batch against original offsets regardless of order", () => {
    const changes = [insertAt(0, "A"), insertAt(body.length, "Z"), replaceAll("第二段", "②")[0]!];
    const forward = applyEdits(body, changes);
    expect(applyEdits(body, [...changes].reverse())).toBe(forward);
    expect(forward.startsWith("A")).toBe(true);
    expect(forward.endsWith("Z")).toBe(true);
    expect(forward).toContain("②");
    expect(applyEdits(body, [])).toBe(body);
  });
  it("refuses overlapping, out-of-range and non-integer ranges instead of clamping", () => {
    expect(() => applyEdits(body, [replaceAll("a", "b")[0]!, replaceAll("x", "y")[0]!])).toThrow(
      EditError,
    );
    expect(() => applyEdits(body, [{ from: 0, to: body.length + 1, insert: "x" }])).toThrow(
      "超出正文",
    );
    expect(() => applyEdits(body, [{ from: 3, to: 1, insert: "x" }])).toThrow(EditError);
    expect(() => applyEdits(body, [{ from: 0.5, to: 1, insert: "x" }])).toThrow("整数");
  });
  it("resolves targets to the right text", () => {
    expect(targetRange(body, { kind: "document" })).toEqual({ from: 0, to: body.length });
    expect(targetText(body, { kind: "selection", from: 0, to: 3 })).toBe("第一段");
    expect(targetRange(body, { kind: "cursor", at: 4 })).toEqual({ from: 4, to: 4 });
    expect(targetText(body, { kind: "cursor", at: 4 })).toBe("");
    expect(() => targetText(body, { kind: "selection", from: 0, to: 999 })).toThrow("选区已失效");
  });
  it("narrows a document rewrite to the region that actually changed", () => {
    const changed = `开头\n\n${body}`;
    const [change] = changeFor(body, { kind: "document" }, changed);
    expect(change).toEqual({ from: 0, to: 0, insert: "开头\n\n" });
    expect(applyEdits(body, [change!])).toBe(changed);
    expect(changeFor(body, { kind: "document" }, body)).toEqual([]);
  });
  it("appends at a cursor and replaces only the selected range", () => {
    const append = changeFor(body, { kind: "cursor", at: body.length }, "补充一句");
    expect(applyEdits(body, append)).toBe(`${body}补充一句`);
    const sel = changeFor(body, { kind: "selection", from: 5, to: 8 }, "改写");
    expect(applyEdits(body, sel)).toBe("第一段\n\n改写\n\n第三段\n");
  });
});

const proposal = (base = body, insert = "改写后"): EditProposal => ({
  base,
  changes: changeFor(base, { kind: "selection", from: 5, to: 8 }, insert),
  summary: "改写第二段",
});

describe("edit proposals", () => {
  it("previews without touching the source and discards a stale base", () => {
    const p = proposal();
    expect(preview(p)).toBe("第一段\n\n改写后\n\n第三段\n");
    expect(resolve(p, body)).toBe("第一段\n\n改写后\n\n第三段\n");
    const typed = `${body}边打字边等`;
    expect(isCurrent(p, typed)).toBe(false);
    expect(resolve(p, typed)).toBeNull();
  });
  it("reports nothing to write when the model echoed the original", () => {
    expect(resolve(proposal(body, "第二段"), body)).toBeNull();
  });
});

describe("proposals through the durable store", () => {
  function device() {
    let raw: string | undefined;
    const metadata = {
      get: async () => raw,
      set: async (_: string, value: string) => {
        raw = value;
      },
    };
    return { store: new KnowledgeStore(metadata), raw: () => raw };
  }
  it("writes the accepted edit and keeps the previous body as a revision", async () => {
    const d = device(),
      base = note();
    await d.store.saveNote(base, null);
    const p = proposal();
    const next = resolve(p, d.store.getSnapshot().notes[base.id]!.body)!;
    const current = d.store.getSnapshot().notes[base.id]!;
    await d.store.saveNote({ ...current, body: next, updatedAt: 2 }, current);
    const saved = d.store.getSnapshot();
    expect(saved.notes[base.id]!.body).toBe("第一段\n\n改写后\n\n第三段\n");
    expect(saved.history[0]).toMatchObject({ reason: "编辑前版本" });
    expect(saved.history[0]!.note.body).toBe(body);

    await d.store.restore(saved.history[0]!.note);
    expect(d.store.getSnapshot().notes[base.id]!.body).toBe(body);
  });
  it("writes nothing when the proposal is stale", async () => {
    const d = device(),
      base = note();
    await d.store.saveNote(base, null);
    const p = proposal();
    const current = d.store.getSnapshot().notes[base.id]!;
    const typed = { ...current, body: `${body}用户继续输入`, updatedAt: 2 };
    await d.store.saveNote(typed, current);
    expect(resolve(p, d.store.getSnapshot().notes[base.id]!.body)).toBeNull();
    expect(d.store.getSnapshot().notes[base.id]!.body).toBe(`${body}用户继续输入`);
  });
});
