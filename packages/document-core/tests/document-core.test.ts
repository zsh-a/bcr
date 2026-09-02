import { describe, expect, it } from "vitest";
import {
  consumeDocumentHandoff,
  createDocumentJob,
  formatForName,
  markReadyStages,
  nextAction,
  publishDocumentHandoff,
} from "../src";

describe("document-core", () => {
  it("normalizes common document extensions", () => {
    expect(formatForName("chapter.MD")).toBe("markdown");
    expect(formatForName("scan.png", "image/png")).toBe("image");
    expect(formatForName("novel.fb2")).toBe("fb2");
  });

  it("keeps ready adapter boundaries explicit", () => {
    const job = createDocumentJob({
      id: "job-1",
      name: "book.txt",
      format: "txt",
      size: 12,
      now: 1,
    });
    const ready = markReadyStages(job);
    expect(ready.stages.find((stage) => stage.id === "extract")).toMatchObject({
      status: "idle",
      progress: 0,
    });
    expect(ready.stages.find((stage) => stage.id === "translate")).toMatchObject({
      status: "blocked",
    });
    expect(nextAction(ready)).toBe("extract");
  });

  it("consumes a handoff once and only in its target app", () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const id = publishDocumentHandoff({
      jobId: "job-handoff",
      target: "reader",
      name: file.name,
      format: "txt",
      file,
    });
    expect(consumeDocumentHandoff(id, "manga")).toBeUndefined();
    expect(consumeDocumentHandoff(id, "reader")?.file).toBe(file);
    expect(consumeDocumentHandoff(id, "reader")).toBeUndefined();
  });
});
