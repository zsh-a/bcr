import { describe, expect, it } from "vitest";
import { formatForFile } from "../src/adapters";
import {
  READER_FORMAT_CATALOG,
  readerAcceptAttribute,
  readerFormatDescriptor,
} from "@bcr/reader-core";

describe("reader format catalog", () => {
  it("keeps common extensions and MIME fallbacks in one registry", () => {
    expect(formatForFile({ name: "notes.mdown", type: "" })).toBe("markdown");
    expect(formatForFile({ name: "report", type: "application/pdf" })).toBe("pdf");
    expect(formatForFile({ name: "chapter.zip", type: "application/zip" })).toBe("cbz");
    expect(
      formatForFile({
        name: "draft.bin",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe("docx");
    expect(formatForFile({ name: "novel.mobi", type: "" })).toBe("mobi");
  });

  it("exposes only native formats to file inputs", () => {
    const accept = readerAcceptAttribute();
    expect(accept).toContain(".docx");
    expect(accept).toContain("application/pdf");
    expect(accept).not.toContain(".mobi");
    expect(READER_FORMAT_CATALOG.filter((item) => item.support === "native")).toHaveLength(8);
    expect(readerFormatDescriptor("docx")).toMatchObject({
      label: "DOCX",
      support: "native",
    });
  });
});
