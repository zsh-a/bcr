import { describe, expect, it } from "vitest";
import { createDemoBook } from "../src/model";
import { normalizeReaderProgress } from "../src/session-contract";

describe("reader session contract", () => {
  it("re-derives percentage from a durable locator and drops unknown books", () => {
    const book = createDemoBook();
    const result = normalizeReaderProgress([book], {
      [book.id]: {
        percentage: 0.99,
        updatedAt: 42,
        locator: {
          kind: "section",
          sectionId: "removed-section",
          progression: 4,
        },
      },
      "deleted-book": {
        percentage: 1,
        updatedAt: 99,
        locator: { kind: "section", sectionId: "ghost", progression: 1 },
      },
    });
    expect(result[book.id]?.locator.sectionId).toBe(book.sections[0]?.id);
    expect(result[book.id]?.percentage).toBe(0);
    expect(result["deleted-book"]).toBeUndefined();
  });

  it("preserves page and image locator kinds while clamping progression", () => {
    const book = {
      ...createDemoBook(),
      id: "pdf-book",
      source: { ...createDemoBook().source, format: "pdf" as const },
      sections: createDemoBook().sections.map((section, order) => ({
        ...section,
        id: `page-${order + 1}`,
        kind: "pdf-page" as const,
        pageNumber: order + 1,
      })),
    };
    const result = normalizeReaderProgress([book], {
      [book.id]: {
        updatedAt: 100,
        locator: { kind: "page", sectionId: "page-2", progression: 3, pageNumber: 2 },
      },
    });
    expect(result[book.id]?.locator).toMatchObject({
      kind: "page",
      sectionId: "page-2",
      progression: 1,
      pageNumber: 2,
    });
    expect(result[book.id]?.percentage).toBeCloseTo(2 / 3);
  });

  it("restores a persisted text anchor and re-derives its progression", () => {
    const book = createDemoBook();
    const section = book.sections[0]!;
    const text = section.text;
    const start = text.indexOf("内容藏在按钮");
    const result = normalizeReaderProgress([book], {
      [book.id]: {
        updatedAt: 100,
        locator: {
          kind: "section",
          sectionId: section.id,
          progression: 0,
          textAnchor: {
            exact: "内容藏在按钮",
            prefix: "阅读器不应该把",
            suffix: "后面。",
            start,
            end: start + "内容藏在按钮".length,
          },
        },
      },
    });
    expect(result[book.id]?.locator.textAnchor?.exact).toBe("内容藏在按钮");
    expect(result[book.id]?.locator.progression).toBeCloseTo(start / text.length);
  });
});
