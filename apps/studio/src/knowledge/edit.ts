/**
 * Range-based editing for note bodies.
 *
 * A note body is a single Markdown string, and every producer of a change —
 * an AI rewrite, a future snippet inserter, an import — is expressed as a list
 * of {@link EditChange} addressed against the *original* text. Positions are
 * therefore stable across a multi-edit batch, matching CodeMirror's own
 * `ChangeSpec`, which is what `MarkdownEditor` dispatches. Keeping one shape
 * means preview, apply and undo are implemented once instead of per producer.
 *
 * Everything here is pure and DOM-free so it can be unit-tested in Node.
 */

/** A replacement of `text[from, to)` with `insert`; `from === to` inserts. */
export interface EditChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/** Raised when a change set cannot be applied; callers surface this rather than writing. */
export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

/** Replace one range. */
export function replaceRange(from: number, to: number, insert: string): EditChange {
  return { from, to, insert };
}

/** Insert at a point, without removing anything. */
export function insertAt(position: number, insert: string): EditChange {
  return { from: position, to: position, insert };
}

/**
 * The smallest single-range edit that turns `before` into `after`.
 *
 * Trimming the common prefix and suffix keeps AI output surgical: an untouched
 * leading paragraph stays byte-identical, so a concurrent edit elsewhere in the
 * note still merges instead of conflicting. Returns `null` when both are equal.
 */
export function minimalChange(before: string, after: string): EditChange | null {
  if (before === after) return null;
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before[start] === after[start]) start += 1;
  let tail = 0;
  while (
    tail < limit - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail += 1;
  return {
    from: start,
    to: before.length - tail,
    insert: after.slice(start, after.length - tail),
  };
}

/** A whole-document replacement, used when a producer has no better range. */
export function replaceAll(before: string, after: string): EditChange[] {
  const change = minimalChange(before, after);
  return change === null ? [] : [change];
}

/**
 * Apply changes addressed against `text`.
 *
 * Changes are applied against the original offsets, so a batch never has to
 * account for earlier edits shifting later ones. Overlaps and out-of-range
 * offsets are rejected rather than clamped: a producer computing a bad range is
 * a bug, and silently writing a mangled note is worse than refusing.
 */
export function applyEdits(text: string, changes: readonly EditChange[]): string {
  const ordered = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  let previous: EditChange | null = null;
  for (const change of ordered) {
    if (!Number.isInteger(change.from) || !Number.isInteger(change.to))
      throw new EditError("编辑范围必须是整数");
    if (change.from < 0 || change.to > text.length || change.from > change.to)
      throw new EditError(
        `编辑范围超出正文：${change.from}–${change.to}（正文 ${text.length} 字符）`,
      );
    if (previous !== null && change.from < previous.to) throw new EditError("编辑范围相互重叠");
    previous = change;
  }
  let result = "",
    cursor = 0;
  for (const change of ordered) {
    result += text.slice(cursor, change.from) + change.insert;
    cursor = change.to;
  }
  return result + text.slice(cursor);
}

/** What a change applies to. Producers pick a target; the range is resolved locally, never by the model. */
export type EditTarget =
  | { readonly kind: "document" }
  | { readonly kind: "selection"; readonly from: number; readonly to: number }
  | { readonly kind: "cursor"; readonly at: number };

/** The range a target covers, in original-document coordinates. */
export function targetRange(
  text: string,
  target: EditTarget,
): { readonly from: number; readonly to: number } {
  switch (target.kind) {
    case "document":
      return { from: 0, to: text.length };
    case "selection":
      if (target.from > target.to || target.to > text.length)
        throw new EditError("选区已失效，请重新选择");
      return { from: target.from, to: target.to };
    case "cursor":
      if (target.at > text.length) throw new EditError("光标位置已失效");
      return { from: target.at, to: target.at };
  }
}

/** The text a target covers, which is what a producer is asked to transform. */
export function targetText(text: string, target: EditTarget): string {
  const range = targetRange(text, target);
  return text.slice(range.from, range.to);
}

/**
 * Build the change for a target given the text that should occupy it.
 *
 * For a document target this narrows to the changed region, so a rewrite that
 * leaves the opening intact does not rewrite the whole note.
 */
export function changeFor(text: string, target: EditTarget, replacement: string): EditChange[] {
  const range = targetRange(text, target);
  return replaceAll(text.slice(range.from, range.to), replacement).map((change) => ({
    from: range.from + change.from,
    to: range.from + change.to,
    insert: change.insert,
  }));
}

/**
 * A proposed edit held back from the note until it is applied.
 *
 * `base` is the body the proposal was computed from. Applying compares it with
 * the current body so an edit the user has since typed over is discarded rather
 * than applied to a document it no longer describes.
 */
export interface EditProposal {
  readonly base: string;
  readonly changes: readonly EditChange[];
  readonly summary: string;
}

/** Whether a proposal still describes the current text. */
export function isCurrent(proposal: EditProposal, text: string): boolean {
  return proposal.base === text;
}

/** The text a proposal would produce, without touching anything. */
export function preview(proposal: EditProposal): string {
  return applyEdits(proposal.base, proposal.changes);
}

/**
 * The body as it should be written, or `null` when there is nothing to write.
 *
 * Refuses a proposal whose base no longer matches, which is the case that
 * matters: the user kept typing while the model was thinking.
 */
export function resolve(proposal: EditProposal, current: string): string | null {
  if (!isCurrent(proposal, current)) return null;
  const next = preview(proposal);
  return next === current ? null : next;
}
