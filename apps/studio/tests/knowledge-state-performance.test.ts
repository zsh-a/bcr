import { describe, expect, it, vi } from "vitest";
import {
  contentOf,
  decodeStateChanges,
  emptyKnowledge,
  newNote,
  pendingCount,
  same,
} from "../src/knowledge/session/model";
import { contentChanges } from "../src/knowledge/session/contentChanges";
import { sameRecord } from "../src/knowledge/session/comparison";
import { withKnowledgeHistory } from "../src/knowledge/session/stateTransitions";
import { pendingSyncItems } from "../src/knowledge/sync/syncFeedback";

const note = (id: string) => ({ ...newNote(id), id, body: "正文".repeat(100_000) });

describe("immutable knowledge comparisons", () => {
  it("skips serialization for identical snapshots, but never caches mutable form values", () => {
    const value = { toJSON: vi.fn(() => "value") };
    expect(same(value, value)).toBe(true);
    expect(value.toJSON).not.toHaveBeenCalled();
    const a = { text: "before" },
      b = { text: "before" };
    expect(same(a, b)).toBe(true);
    a.text = "after";
    expect(same(a, b)).toBe(false);
  });
  it("memoizes immutable pair comparisons without retaining serialized note bodies", () => {
    const left = { toJSON: vi.fn(() => ({ body: "large" })) };
    const right = { toJSON: vi.fn(() => ({ body: "large" })) };
    expect(sameRecord(left, right)).toBe(true);
    expect(sameRecord(left, right)).toBe(true);
    expect(left.toJSON).toHaveBeenCalledTimes(1);
    expect(right.toJSON).toHaveBeenCalledTimes(1);
  });
  it("shares content diffs across counts, popovers and sync-only state updates", () => {
    const old = note("old"),
      gone = note("gone"),
      added = note("added");
    const state = {
      ...emptyKnowledge(),
      notes: { old: { ...old, title: "changed" }, added },
      folders: ["folder"],
      collections: { c: { id: "c", name: "新集合" } },
    };
    state.sync.base = { notes: { old, gone }, collections: {}, folders: [] };
    const changes = contentChanges(state, state.sync.base);
    expect(pendingCount(state)).toBe(5);
    expect(pendingSyncItems(state)).toEqual([
      { label: "changed", change: "修改" },
      { label: "added", change: "新增" },
      { label: "gone", change: "删除" },
      { label: "新集合", change: "新增" },
      { label: "文件夹结构", change: "修改" },
    ]);
    const syncOnly = { ...state, sync: { ...state.sync, lastSyncedAt: 1 } };
    expect(contentChanges(syncOnly, syncOnly.sync.base)).toBe(changes);
    const edited = { ...state, notes: { ...state.notes, old } };
    expect(pendingCount(edited)).toBe(4);
    const accepted = { ...edited, sync: { ...edited.sync, base: contentOf(edited) } };
    expect(pendingCount(accepted)).toBe(0);
  });
  it("keeps previously validated histories and base maps through repeated saves", () => {
    const original = note("original");
    const initial = { ...emptyKnowledge(), notes: { original } };
    const edited = { ...original, body: "changed", updatedAt: original.updatedAt + 1 };
    const changed = withKnowledgeHistory(
      initial,
      { ...contentOf(initial), notes: { original: edited } },
      "编辑",
    );
    const validated = decodeStateChanges(changed, initial);
    expect(validated.history[0]!.note).toBe(original);
    expect(validated.sync.base).toBe(initial.sync.base);
    const again = decodeStateChanges(
      { ...validated, sync: { ...validated.sync, lastSyncedAt: 1 } },
      validated,
    );
    expect(again.history).toBe(validated.history);
    expect(again.notes).toBe(validated.notes);
    expect(again.collections).toBe(validated.collections);
    expect(again.folders).toBe(validated.folders);
    const invalid = { ...again, history: [{ ...again.history[0]!, at: -1 }] };
    expect(() => decodeStateChanges(invalid, again)).toThrow("时间");
  });
  it("only adds revisions for modified or deleted notes, preserving history order", () => {
    const untouched = note("untouched"),
      modified = note("modified"),
      deleted = note("deleted");
    const initial = { ...emptyKnowledge(), notes: { untouched, modified, deleted } };
    const result = withKnowledgeHistory(
      initial,
      { ...contentOf(initial), notes: { untouched, modified: { ...modified, body: "new" } } },
      "编辑",
    );
    expect(result.history.map((entry) => entry.note.id)).toEqual(["modified", "deleted"]);
  });
});
