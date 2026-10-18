// Run with bun scripts/benchmark-knowledge-state.ts. Baseline functions reproduce 112a9bd.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { KnowledgeState } from "../apps/studio/src/knowledge/session/model";
import {
  contentOf,
  emptyKnowledge,
  newNote,
  pendingCount,
} from "../apps/studio/src/knowledge/session/model";
import { withKnowledgeHistory } from "../apps/studio/src/knowledge/session/stateTransitions";
import {
  buildNoteTree,
  visibleNoteRows,
} from "../apps/studio/src/knowledge/workbench/noteTreeModel";
const baselineSame = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function baselinePending(state: KnowledgeState) {
  let count = 0;
  for (const field of ["notes", "collections", "attachments"] as const) {
    const local: Record<string, unknown> = state[field] ?? {},
      base: Record<string, unknown> = state.sync.base[field] ?? {};
    for (const id of new Set([...Object.keys(local), ...Object.keys(base)]))
      if (!baselineSame(local[id], base[id])) count++;
  }
  if (!baselineSame(state.folders, state.sync.base.folders)) count++;
  return count;
}
const notes = Object.fromEntries(
  Array.from({ length: 800 }, (_, i) => {
    const id = `n${i}`;
    return [
      id,
      {
        ...newNote(id),
        id,
        path: `work/${id}.md`,
        createdAt: 1,
        updatedAt: 1,
        body: "large-note-body\n".repeat(1024),
      },
    ];
  }),
);
const base = { notes, collections: {}, folders: [] };
const state = { ...emptyKnowledge(), ...base, sync: { ...emptyKnowledge().sync, base } };
const changed = {
  ...contentOf(state),
  notes: { ...notes, n0: { ...notes.n0!, body: `${notes.n0!.body}edited` } },
};
const dirty = { ...state, ...changed };
const median = (run: () => unknown) => {
  const times = [];
  for (let i = 0; i < 9; i++) {
    const at = performance.now();
    run();
    times.push(performance.now() - at);
  }
  return times.sort((a, b) => a - b)[4];
};
const hashes = Object.fromEntries(
  ["model.ts", "comparison.ts", "contentChanges.ts", "stateTransitions.ts"].map((name) => [
    name,
    createHash("sha256")
      .update(
        readFileSync(new URL(`../apps/studio/src/knowledge/session/${name}`, import.meta.url)),
      )
      .digest("hex"),
  ]),
);
const coldAt = performance.now();
const count = pendingCount(dirty);
const cold = performance.now() - coldAt;
const root = buildNoteTree(Object.values(notes));
console.log(
  JSON.stringify(
    {
      baselineAlgorithmCommit: "112a9bd",
      fixture: {
        notes: 800,
        bodyChars: notes.n0!.body.length,
        totalBodyChars: Object.values(notes).reduce((sum, n) => sum + n.body.length, 0),
      },
      sourceHashes: hashes,
      pendingCount: count,
      pending: {
        baselineMs: median(() => baselinePending(dirty)),
        coldOptimizedMs: cold,
        warmOptimizedMs: median(() => pendingCount(dirty)),
      },
      history: {
        baselineScanMs: median(() =>
          Object.values(state.notes).filter((note) => !baselineSame(note, changed.notes[note.id])),
        ),
        optimizedMs: median(() => withKnowledgeHistory(state, changed, "benchmark")),
      },
      tree: {
        expandedRows: visibleNoteRows(root, []).length,
        collapsedRows: visibleNoteRows(root, ["work"]).length,
      },
    },
    null,
    2,
  ),
);
