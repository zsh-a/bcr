import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeDocumentHandoff,
  createDocumentContentPackage,
  createDocumentOcrContent,
  createDocumentJob,
  formatForName,
  hasDocumentHandoff,
  listDocumentHandoffs,
  markDocumentHandoffExpired,
  markReadyStages,
  nextAction,
  documentOcrSettings,
  publishDocumentHandoff,
} from "../src";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("document-core", () => {
  it("normalizes common document extensions", () => {
    expect(formatForName("chapter.MD")).toBe("markdown");
    expect(formatForName("scan.png", "image/png")).toBe("image");
    expect(formatForName("novel.fb2")).toBe("fb2");
    expect(formatForName("draft.docx")).toBe("docx");
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
    expect(ready.stages.find((stage) => stage.id === "ocr")).toMatchObject({
      status: "blocked",
    });
    expect(ready.stages.find((stage) => stage.id === "translate")).toMatchObject({
      status: "idle",
      capability: "adapter",
      adapter: "fixture.translate",
    });
    expect(nextAction(ready)).toBe("extract");
  });

  it("does not route binary packages through the text extractor", () => {
    const job = markReadyStages(
      createDocumentJob({
        id: "job-epub",
        name: "book.epub",
        format: "epub",
        size: 120,
        now: 1,
      }),
    );
    expect(job.stages.find((stage) => stage.id === "extract")).toMatchObject({
      status: "blocked",
      detail: "该格式由 Reader / Manga 专用适配器直接读取",
    });
    expect(nextAction(job)).toBeUndefined();
  });

  it("enables the local OCR adapter only for image jobs", () => {
    const job = markReadyStages(
      createDocumentJob({
        id: "job-scan",
        name: "scan.png",
        format: "image",
        size: 120,
        sourceRef: {
          id: "source/scan",
          type: "file/png",
          storage: "opfs",
          format: "image/png",
        },
        now: 1,
      }),
    );
    expect(job.stages.find((stage) => stage.id === "extract")).toMatchObject({
      status: "blocked",
    });
    expect(job.stages.find((stage) => stage.id === "ocr")).toMatchObject({
      status: "idle",
      capability: "adapter",
      adapter: "document.ocr.onnx",
    });
  });

  it("projects visual OCR lines into the canonical image content package", () => {
    const content = createDocumentOcrContent({
      id: "document-content/scan/ocr",
      sourceName: "scan.png",
      sourceHash: "scan-hash",
      sourceLanguage: "ja",
      adapter: "document.ocr.onnx",
      lines: [
        {
          id: "page-1",
          label: "Page 1",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          text: "こんにちは",
          writingMode: "vertical-rl",
          confidence: 0.72,
        },
      ],
    });
    expect(content).toMatchObject({
      format: "image",
      sourceName: "scan.png",
      metadata: { language: "ja" },
      provenance: { adapter: "document.ocr.onnx", sourceHash: "scan-hash" },
    });
    expect(content.blocks[0]).toMatchObject({
      id: "page-1",
      text: "こんにちは",
      pageNumber: 1,
      writingMode: "vertical-rl",
      confidence: 0.72,
      geometry: { x: 0, y: 0, width: 100, height: 100 },
    });
  });

  it("normalizes OCR settings and swaps the model with the adapter", () => {
    expect(documentOcrSettings(undefined)).toMatchObject({
      adapter: "vision.onnx",
      model: "Xenova/trocr-small-printed",
      sourceLanguage: "en",
    });
    expect(documentOcrSettings({ adapter: "manga.onnx" })).toMatchObject({
      adapter: "manga.onnx",
      model: "onnx-community/manga-ocr-base-ONNX",
    });
  });

  it("consumes a handoff once and only in its target app", () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const content = createDocumentContentPackage({
      id: "content-handoff",
      format: "txt",
      sourceName: file.name,
      adapter: "text.extract",
      blocks: [{ text: "hello" }],
    });
    const id = publishDocumentHandoff({
      jobId: "job-handoff",
      target: "reader",
      name: file.name,
      format: "txt",
      file,
      content,
    });
    expect(listDocumentHandoffs().find((record) => record.id === id)).toMatchObject({
      target: "reader",
      status: "pending",
    });
    expect(consumeDocumentHandoff(id, "manga")).toBeUndefined();
    expect(consumeDocumentHandoff(id, "reader")).toMatchObject({ file, content });
    expect(consumeDocumentHandoff(id, "reader")).toBeUndefined();
    expect(listDocumentHandoffs().find((record) => record.id === id)).toMatchObject({
      target: "reader",
      status: "consumed",
    });
  });

  it("supports a reverse Reader/Manga to Document target", () => {
    const file = new File(["projected"], "projected.md", { type: "text/markdown" });
    const id = publishDocumentHandoff({
      jobId: "reader-projected",
      target: "document",
      name: file.name,
      format: "markdown",
      file,
    });
    expect(consumeDocumentHandoff(id, "document")).toMatchObject({
      id,
      target: "document",
      file,
    });
  });

  it("records an expired handoff without allowing a later consume", () => {
    const file = new File(["page"], "page.png", { type: "image/png" });
    const id = publishDocumentHandoff({
      jobId: "job-expired",
      target: "manga",
      name: file.name,
      format: "image",
      file,
    });
    expect(markDocumentHandoffExpired(id, "manga")).toMatchObject({
      id,
      target: "manga",
      status: "expired",
    });
    expect(consumeDocumentHandoff(id, "manga")).toBeUndefined();
    expect(markDocumentHandoffExpired(id, "manga")).toMatchObject({
      id,
      status: "expired",
    });
  });

  it("从持久化 marker 恢复 artifact-backed handoff，而不需要 File 句柄", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const sourceRef = {
      id: "document/source/hash",
      type: "file/epub",
      storage: "opfs" as const,
      format: "application/epub+zip",
      hash: "hash",
    };
    values.set(
      "bcr.document-handoff.v1",
      JSON.stringify({
        id: "recovered-handoff",
        target: "reader",
        jobId: "job-recovered",
        name: "recovered.epub",
        format: "epub",
        size: 42,
        sourceRef,
        createdAt: 12,
      }),
    );

    expect(hasDocumentHandoff("recovered-handoff")).toBe(true);
    const recovered = consumeDocumentHandoff("recovered-handoff", "reader");
    expect(recovered?.file).toBeUndefined();
    expect(recovered).toMatchObject({
      id: "recovered-handoff",
      sourceRef,
      size: 42,
    });
    expect(hasDocumentHandoff("recovered-handoff")).toBe(false);
  });
});
