import { textVersion, type TextRange } from "@bcr/core";

/**
 * A proposed change to a run of text.
 *
 * Deliberately domain-neutral: the unit is any string, so the same protocol
 * serves a note body, one OCR block, or a single translated line. The producer
 * supplies a replacement for a range it already knows; addressing stays local
 * and deterministic while the model only rewrites words.
 *
 * `baseVersion` is what makes applying safe. It is compared with the version of
 * the text at accept time, so an edit the user has since typed over is dropped
 * instead of being written into a document it no longer describes.
 */
export interface TextEditSuggestion {
  readonly baseVersion: string;
  readonly range: TextRange;
  readonly replacement: string;
  /** What produced this, shown before accepting. */
  readonly summary: string;
}

/** A replacement of `before[start, end)` with `insert`; `start === end` inserts. */
export interface TextChange extends TextRange {
  readonly insert: string;
}

/** Raised when a range cannot be addressed; callers surface this rather than writing. */
export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

/**
 * The smallest single change that turns `before` into `after`, or `null` when
 * they are equal.
 *
 * Narrowing is what keeps an edit surgical: untouched text stays byte-identical,
 * so a concurrent edit elsewhere still merges instead of conflicting.
 */
export function minimalChange(before: string, after: string): TextChange | null {
  if (before === after) return null;
  const limit = Math.min(before.length, after.length);
  let head = 0;
  while (head < limit && before[head] === after[head]) head += 1;
  let tail = 0;
  while (tail < limit - head && before[before.length - 1 - tail] === after[after.length - 1 - tail])
    tail += 1;
  return {
    start: head,
    end: before.length - tail,
    insert: after.slice(head, after.length - tail),
  };
}

function inRange(text: string, range: TextRange, what: string): void {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end))
    throw new EditError(`${what}必须是整数`);
  if (range.start < 0 || range.end > text.length || range.start > range.end)
    throw new EditError(`${what}超出正文：${range.start}–${range.end}（正文 ${text.length} 字符）`);
}

/** The text a range covers. */
export function textInRange(text: string, range: TextRange): string {
  inRange(text, range, "范围");
  return text.slice(range.start, range.end);
}

/**
 * Build the suggestion that makes `text[start, end)` read as `replacement`.
 *
 * The result is narrowed to the region that actually differs, so the range is
 * the edit rather than the passage. An unchanged result yields an empty range,
 * which `resolveEdit` reports as nothing to write.
 */
export function suggestRange(
  text: string,
  start: number,
  end: number,
  replacement: string,
  summary: string,
): TextEditSuggestion {
  inRange(text, { start, end }, "编辑范围");
  const change = minimalChange(text.slice(start, end), replacement) ?? {
    start: 0,
    end: 0,
    insert: "",
  };
  return {
    baseVersion: textVersion(text),
    range: { start: start + change.start, end: start + change.end },
    replacement: change.insert,
    summary,
  };
}

/** Whether a suggestion still describes `text` as it is now. */
export function isCurrent(suggestion: TextEditSuggestion, text: string): boolean {
  return suggestion.baseVersion === textVersion(text);
}

/** The text a suggestion would produce. Does not validate the version. */
export function previewEdit(text: string, suggestion: TextEditSuggestion): string {
  inRange(text, suggestion.range, "建议范围");
  const { start, end } = suggestion.range;
  return text.slice(0, start) + suggestion.replacement + text.slice(end);
}

/**
 * The text to write, or `null` when nothing should be written.
 *
 * Returns `null` when the suggestion is stale — the case that matters, because
 * the user kept editing while the model was running — or when applying it would
 * change nothing, so a no-op write never reaches a store.
 */
export function resolveEdit(text: string, suggestion: TextEditSuggestion): string | null {
  if (!isCurrent(suggestion, text)) return null;
  const next = previewEdit(text, suggestion);
  return next === text ? null : next;
}
