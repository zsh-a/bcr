import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveRename,
  type LiveRename,
  type LiveRenamePort,
} from "../src/knowledge/liveRename";
import { planNoteRename, type NoteChangePlan } from "../src/knowledge/changePlan";
import { newNote, type KnowledgeNote } from "../src/knowledge/model";

const target = { ...newNote("旧标题"), id: "target", body: "[[旧标题]]" };
const source = { ...newNote("引用"), id: "source", body: "[[旧标题]] 与 [[target|稳定]]" };

interface EngineCalls {
  plans: string[];
  applied: number;
  rewrites: number;
  confirmed: number;
  phases: string[];
  failed: unknown[];
}

function fixture(extra: KnowledgeNote[] = []) {
  const notes: Record<string, KnowledgeNote> = Object.fromEntries(
    [target, source, ...extra].map((note) => [note.id, note]),
  );
  const calls: EngineCalls = {
    plans: [],
    applied: 0,
    rewrites: 0,
    confirmed: 0,
    phases: [],
    failed: [],
  };
  let approve = true;
  let failApply = false;
  const port: LiveRenamePort = {
    async plan(title) {
      calls.plans.push(title);
      return planNoteRename(notes, "target", title);
    },
    async apply(plan: NoteChangePlan) {
      if (failApply) throw new Error("保存失败");
      calls.applied++;
      calls.rewrites = plan.rewrites;
      for (const change of plan.changes) notes[change.after.id] = change.after;
    },
    async confirm() {
      calls.confirmed++;
      return approve;
    },
    phase(next) {
      calls.phases.push(next);
    },
    failed(reason) {
      calls.failed.push(reason);
    },
  };
  return {
    notes,
    calls,
    port,
    decline() {
      approve = false;
    },
    breakApply() {
      failApply = true;
    },
  };
}

describe("inline rename debounce and plan path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces title input into one rename with automatic link rewrites", async () => {
    const f = fixture();
    const renamer: LiveRename = createLiveRename(f.port, 600);
    renamer.schedule("A");
    await vi.advanceTimersByTimeAsync(300);
    renamer.schedule("新标题");
    await vi.advanceTimersByTimeAsync(599);
    expect(f.calls.plans).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls.plans).toEqual(["新标题"]);
    expect(f.calls.confirmed).toBe(0);
    expect(f.calls.applied).toBe(1);
    expect(f.calls.rewrites).toBeGreaterThan(0);
    expect(f.calls.phases).toEqual(["working", "clear"]);
    expect(f.notes.target!.title).toBe("新标题");
    expect(f.notes.source!.body).toBe("[[target|旧标题]] 与 [[target|稳定]]");
  });

  it("asks for confirmation only when the plan reports ambiguous same-name links", async () => {
    const f = fixture([{ ...target, id: "duplicate", body: "同名笔记" }]);
    const renamer = createLiveRename(f.port, 600);
    renamer.schedule("新标题");
    await vi.advanceTimersByTimeAsync(600);
    expect(f.calls.confirmed).toBe(1);
    expect(f.calls.applied).toBe(1);
    expect(f.notes.source!.body).toBe("[[旧标题]] 与 [[target|稳定]]");

    const declined = fixture([{ ...target, id: "duplicate", body: "同名笔记" }]);
    declined.decline();
    const second = createLiveRename(declined.port, 600);
    second.schedule("新标题");
    await vi.advanceTimersByTimeAsync(600);
    expect(declined.calls.confirmed).toBe(1);
    expect(declined.calls.applied).toBe(0);
    expect(declined.notes.target!.title).toBe("旧标题");
  });

  it("settles pending input immediately for the navigation save barrier", async () => {
    const f = fixture();
    const renamer = createLiveRename(f.port, 600);
    renamer.schedule("新标题");
    await renamer.settle();
    expect(f.calls.plans).toEqual(["新标题"]);
    expect(f.calls.applied).toBe(1);
  });

  it("cancel drops pending input without touching the notes", async () => {
    const f = fixture();
    const renamer = createLiveRename(f.port, 600);
    renamer.schedule("新标题");
    renamer.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.calls.plans).toEqual([]);
    expect(f.notes.target!.title).toBe("旧标题");
  });

  it("reports failures quietly and leaves the notes untouched", async () => {
    const f = fixture();
    f.breakApply();
    const renamer = createLiveRename(f.port, 600);
    renamer.schedule("新标题");
    await vi.advanceTimersByTimeAsync(600);
    expect(f.calls.failed).toHaveLength(1);
    expect(f.notes.target!.title).toBe("旧标题");
  });

  it("never applies a plan without changes", async () => {
    const f = fixture();
    const renamer = createLiveRename(f.port, 600);
    renamer.schedule("旧标题");
    await vi.advanceTimersByTimeAsync(600);
    expect(f.calls.plans).toEqual(["旧标题"]);
    expect(f.calls.applied).toBe(0);
    expect(f.calls.phases).toEqual(["working", "clear"]);
  });
});
