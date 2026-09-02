import { describe, expect, it } from "vitest";
import { findGlossaryMatches, translateWithGlossary } from "../src/glossary";
import type { MangaGlossaryEntry } from "../src/model";

const glossary: ReadonlyArray<MangaGlossaryEntry> = [
  { id: "short", source: "勇", target: "勇者", note: "", enabled: true },
  { id: "long", source: "勇者", target: "勇者大人", note: "", enabled: true },
  { id: "off", source: "秘密", target: "机密", note: "", enabled: false },
];

describe("manga glossary", () => {
  it("matches enabled terms longest-first", () => {
    expect(
      findGlossaryMatches("勇者登场，秘密仍未揭开", glossary).map((entry) => entry.id),
    ).toEqual(["long"]);
  });

  it("lets exact phrases override the fixture translation", () => {
    expect(translateWithGlossary("勇者", glossary, (text) => `译：${text}`)).toBe("勇者大人");
  });

  it("applies terms to fallback output while leaving disabled terms untouched", () => {
    expect(translateWithGlossary("勇者登场，秘密仍未揭开", glossary, (text) => `译：${text}`)).toBe(
      "译：勇者大人登场，秘密仍未揭开",
    );
  });
});
