import { describe, expect, it } from "vitest";
import { createSearchIndex } from "@bcr/core";
import { mediaCitationTarget, mediaDocuments } from "../src/mediaSearchDocuments";

describe("media evidence search", () => {
  it("finds individual cues beyond the former combined 24k limit and preserves source/time", () => {
    const index = createSearchIndex();
    index.replaceSource(
      "media",
      mediaDocuments({ ref: { id: "source/?&" }, name: "lecture.wav" }, [
        { start: 0, end: 5, text: "a".repeat(25000) },
        { start: 123.5, end: 128, text: "证据在这里", translation: "evidence" },
      ]),
    );
    const [result] = index.search("evidence");
    expect(result?.document.body).toBe("证据在这里\nevidence");
    const params = new URL(result!.document.route!, "https://example.org").search;
    expect(mediaCitationTarget(params, "source/?&")).toEqual({ time: 123.5 });
    expect(mediaCitationTarget(params, "another-source").error).toBeTruthy();
  });
  it("rejects invalid time and never seeks a different source", () => {
    for (const time of ["NaN", "Infinity", "-1", ""])
      expect(mediaCitationTarget(`?source=a&time=${time}`, "a").error).toBeTruthy();
    expect(mediaCitationTarget("?source=a&time=3", undefined).time).toBeUndefined();
    expect(mediaCitationTarget("", "a")).toEqual({});
  });
});

it("revalidates saved subtitle citations after timeline changes, edits and duplicates", async () => {
  const { createTextCitation, withTextCitation, findTextMatches } = await import("@bcr/core");
  const original = [
    { start: 1, end: 2, text: "前段" },
    { start: 4, end: 6, text: "关键字幕证据" },
  ];
  const doc = mediaDocuments({ ref: { id: "media-source" }, name: "audio" }, original)[2]!;
  const citation = createTextCitation(
    doc.body!,
    doc.citation!,
    findTextMatches(doc.body!, "字幕")[0]!,
  );
  const route = new URL(withTextCitation(doc.route!, citation), "https://example.org").search;
  expect(mediaCitationTarget(route, "media-source", original).cueIndex).toBe(1);
  const moved = [{ start: 8, end: 10, text: "关键字幕证据" }];
  expect(mediaCitationTarget(route, "media-source", moved)).toMatchObject({
    time: 8,
    cueIndex: 0,
    relocated: true,
  });
  expect(
    mediaCitationTarget(route, "media-source", [{ start: 4, end: 6, text: "已修改正文" }]).time,
  ).toBeUndefined();
  expect(
    mediaCitationTarget(route, "media-source", [
      ...moved,
      { start: 12, end: 14, text: "关键字幕证据" },
    ]).error,
  ).toContain("多个");
});
