import { describe, expect, it } from "vitest";
import { diffSpans, excerptSpans } from "../src/knowledge/diffView";
import { mergeConflictNote } from "../src/knowledge/conflicts";
import { countRewrittenLinks } from "../src/knowledge/moveSummary";
import { newNote, type KnowledgeNote } from "../src/knowledge/model";
import { planNoteMove } from "../src/knowledge/changePlan";
import { KnowledgeStore } from "../src/knowledge/store";

const note = (id: string, body: string, extra: Partial<KnowledgeNote> = {}): KnowledgeNote => ({
  ...newNote("标题"),
  id,
  body,
  ...extra,
});

describe("token-level rendered diff", () => {
  it("marks only the changed tokens as removed/added and keeps the rest same", () => {
    const spans = diffSpans("把零散想法连成知识。", "把零散想法连成体系。");
    const removed = spans.find((span) => span.kind === "removed"),
      added = spans.find((span) => span.kind === "added");
    expect(removed?.text).toBe("知识");
    expect(added?.text).toBe("体系");
    expect(
      spans
        .filter((span) => span.kind === "same")
        .map((span) => span.text)
        .join(""),
    ).toBe("把零散想法连成。");
  });

  it("returns plain same spans for identical text and full blocks for different text", () => {
    expect(diffSpans("同一段", "同一段")).toEqual([{ kind: "same", text: "同一段" }]);
    expect(diffSpans("", "新内容")).toEqual([{ kind: "added", text: "新内容" }]);
    expect(diffSpans("旧内容", "")).toEqual([{ kind: "removed", text: "旧内容" }]);
  });

  it("clips far-away changes with honest omission markers", () => {
    const before = `开头${"甲".repeat(600)}结尾前缀`,
      after = `开头${"甲".repeat(600)}结尾后缀`;
    const clipped = excerptSpans(before, after);
    expect(clipped.truncated).toBe(true);
    expect(clipped.spans.filter((span) => span.kind === "omitted").length).toBeGreaterThan(0);
    const near = excerptSpans("把想法连成知识", "把想法连成体系");
    expect(near.truncated).toBe(false);
    expect(near.spans.some((span) => span.kind === "omitted")).toBe(false);
  });
});

describe("conflict merge candidate", () => {
  it("merges non-overlapping body edits from both sides", () => {
    const base = note("a", "第一段\n\n第二段"),
      local = note("a", "第一段（本机补充）\n\n第二段"),
      remote = note("a", "第一段\n\n第二段（远端补充）");
    const merged = mergeConflictNote(base, local, remote);
    expect(merged?.body).toContain("（本机补充）");
    expect(merged?.body).toContain("（远端补充）");
  });

  it("refuses overlapping edits and delete conflicts instead of dropping content", () => {
    const base = note("a", "同一行"),
      local = note("a", "同一行本机改写"),
      remote = note("a", "同一行远端改写");
    expect(mergeConflictNote(base, local, remote)).toBeNull();
    expect(mergeConflictNote(base, null, remote)).toBeNull();
    expect(mergeConflictNote(base, local, null)).toBeNull();
  });

  it("keeps local title and path (renames move through plans) but takes remote-only metadata", () => {
    const base = note("a", "段一\n\n段二", { title: "原标题", path: "旧/笔记.md", tags: [] }),
      local = note("a", "段一本机\n\n段二", { title: "原标题", path: "旧/笔记.md", tags: [] }),
      remote = note("a", "段一\n\n段二远端", {
        title: "远端新标题",
        path: "远端/笔记.md",
        tags: ["远端"],
      });
    const merged = mergeConflictNote(base, local, remote);
    expect(merged?.title).toBe("原标题");
    expect(merged?.path).toBe("旧/笔记.md");
    expect(merged?.tags).toEqual(["远端"]);
  });

  it("keeps local metadata when both sides changed it differently", () => {
    const base = note("a", "段一\n\n段二", { tags: ["基线"] }),
      local = note("a", "段一本机\n\n段二", { tags: ["本机"] }),
      remote = note("a", "段一\n\n段二远端", { tags: ["远端"] });
    expect(mergeConflictNote(base, local, remote)?.tags).toEqual(["本机"]);
  });
});

describe("conflict merge application", () => {
  it("applies the merge result without dropping either side and keeps local title/path", async () => {
    const data = new Map<string, string>();
    const store = new KnowledgeStore({
      get: async (key) => data.get(key),
      set: async (key, value) => {
        data.set(key, value);
      },
    });
    const base = note("alpha", "第一段\n\n第二段", {
      title: "原标题",
      path: "旧/笔记.md",
    });
    const local = note("alpha", "第一段本机\n\n第二段", {
      title: "本机标题",
      path: "旧/笔记.md",
    });
    const remote = note("alpha", "第一段\n\n第二段远端", {
      title: "远端标题",
      path: "旧/笔记.md",
    });
    await store.saveNote(local, null);
    await store.integrate({ notes: { alpha: remote }, collections: {} }, "a".repeat(40), {
      notes: { alpha: base },
      collections: {},
    });
    const conflict = store.getSnapshot().conflicts[0]!;
    expect(conflict.kind).toBe("note");
    // 与冲突面板相同的落地次序：采用本机清冲突，再写入合并结果。
    const merged = mergeConflictNote(conflict.base as KnowledgeNote, local, remote)!;
    expect(merged.title).toBe("本机标题");
    await store.resolve(conflict, "local");
    await store.restore(merged);
    const saved = store.getSnapshot().notes.alpha!;
    expect(saved.title).toBe("本机标题");
    expect(saved.path).toBe("旧/笔记.md");
    expect(saved.body).toContain("第一段本机");
    expect(saved.body).toContain("第二段远端");
    expect(store.getSnapshot().conflicts).toEqual([]);
    // 未采用的远端版本没有被丢弃。
    expect(store.getSnapshot().history.some((entry) => entry.reason === "冲突远端版本")).toBe(true);
    await store.close();
  });
});

describe("move link rewrites", () => {
  it("counts exactly the link references a move rewrites", () => {
    const notes = {
      alpha: note("alpha", "# Alpha", { title: "Alpha", path: "old/Alpha.md" }),
      beta: note("beta", "[[./Alpha|相关笔记]]\n\n[来源](./Alpha.md)", {
        title: "Beta",
        path: "old/Beta.md",
      }),
    };
    const plan = planNoteMove(notes, { alpha: "new/Alpha.md" });
    const changed = plan.changes.filter((change) => change.before.body !== change.after.body);
    expect(changed.map((change) => change.after.body)).toEqual([
      "[[alpha|相关笔记]]\n\n[来源](alpha.md)",
    ]);
    expect(countRewrittenLinks(plan.changes)).toBe(2);
  });

  it("returns zero when a move touches no links", () => {
    const plan = planNoteMove(
      { alpha: note("alpha", "# Alpha", { title: "Alpha", path: "old/Alpha.md" }) },
      { alpha: "new/Alpha.md" },
    );
    expect(countRewrittenLinks(plan.changes)).toBe(0);
  });
});
