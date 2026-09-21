import { describe, expect, it } from "vitest";
import { textVersion } from "@bcr/core";
import {
  EditError,
  isCurrent,
  minimalChange,
  previewEdit,
  resolveEdit,
  suggestRange,
  textInRange,
  type TextEditSuggestion,
} from "../src/suggestion";

const body = "第一段\n\n第二段\n\n第三段\n";

describe("minimal change", () => {
  it("keeps untouched edges intact so distant edits stay mergeable", () => {
    expect(minimalChange("head\nmiddle\ntail\n", "head\nMIDDLE\ntail\n")).toEqual({
      start: 5,
      end: 11,
      insert: "MIDDLE",
    });
    expect(minimalChange(body, body)).toBeNull();
    expect(minimalChange("", "new")).toEqual({ start: 0, end: 0, insert: "new" });
    expect(minimalChange("abc", "")).toEqual({ start: 0, end: 3, insert: "" });
  });
  it("narrows a rewrite that only appends or only edits the middle", () => {
    expect(minimalChange("abc", "abcXYZ")).toEqual({ start: 3, end: 3, insert: "XYZ" });
    expect(minimalChange("abcdef", "abXef")).toEqual({ start: 2, end: 4, insert: "X" });
  });
});

describe("range addressing", () => {
  it("returns the covered text and rejects a range past the end", () => {
    expect(textInRange(body, { start: 0, end: 3 })).toBe("第一段");
    expect(textInRange(body, { start: 4, end: 4 })).toBe("");
    expect(() => textInRange(body, { start: 0, end: body.length + 1 })).toThrow("超出正文");
    expect(() => textInRange(body, { start: 3, end: 1 })).toThrow(EditError);
    expect(() => textInRange(body, { start: 0.5, end: 1 })).toThrow("整数");
  });
  it("suggests the minimal edit for a passage, not a whole-document rewrite", () => {
    const suggestion = suggestRange(body, 5, 8, "改写后", "改写第二段");
    expect(suggestion.range).toEqual({ start: 5, end: 8 });
    expect(suggestion.replacement).toBe("改写后");
    expect(previewEdit(body, suggestion)).toBe("第一段\n\n改写后\n\n第三段\n");
    // The suggestion is addressed against the whole text it was computed from.
    expect(suggestion.baseVersion).toBe(textVersion(body));
  });
  it("narrows a document-scope replacement down to the changed region", () => {
    const changed = `开头\n\n${body}`;
    const suggestion = suggestRange(body, 0, body.length, changed, "加开头");
    expect(suggestion.range).toEqual({ start: 0, end: 0 });
    expect(suggestion.replacement).toBe("开头\n\n");
    expect(previewEdit(body, suggestion)).toBe(changed);
  });
  it("yields an empty range when the replacement equals the passage", () => {
    const suggestion = suggestRange(body, 5, 8, "第二段", "没变");
    expect(suggestion.range).toEqual({ start: 5, end: 5 });
    expect(resolveEdit(body, suggestion)).toBeNull();
  });
});

describe("version guard", () => {
  const suggestion = (text = body, insert = "改写后"): TextEditSuggestion =>
    suggestRange(text, 5, 8, insert, "改写第二段");

  it("previews without touching the source and reports staleness", () => {
    const pending = suggestion();
    expect(previewEdit(body, pending)).toBe("第一段\n\n改写后\n\n第三段\n");
    expect(resolveEdit(body, pending)).toBe("第一段\n\n改写后\n\n第三段\n");
    expect(isCurrent(pending, body)).toBe(true);
  });
  it("drops a suggestion once the text has moved on", () => {
    const pending = suggestion();
    const typed = `${body}边打字边等`;
    expect(isCurrent(pending, typed)).toBe(false);
    expect(resolveEdit(typed, pending)).toBeNull();
  });
  it("detects a same-length edit, which a length check would miss", () => {
    const pending = suggestRange(body, 5, 8, "改写后", "改写");
    const swapped = body.replace("第一段", "另一段");
    expect(swapped.length).toBe(body.length);
    expect(resolveEdit(swapped, pending)).toBeNull();
  });
  it("refuses to preview a range that no longer fits the text", () => {
    const pending = suggestRange(body, 5, 8, "改写后", "改写");
    expect(() => previewEdit("短", pending)).toThrow("建议范围");
  });
});
