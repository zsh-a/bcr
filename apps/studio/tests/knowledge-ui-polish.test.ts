import { describe, expect, it } from "vitest";
import { MemoryStore } from "@bcr/storage-opfs";
import {
  attachmentPath,
  type KnowledgeAttachment,
} from "../src/knowledge/attachments/attachmentModel";
import {
  isPlainTextAttachment,
  readPlainTextPage,
  TEXT_PREVIEW_PAGE_BYTES,
} from "../src/knowledge/attachments/attachmentPlainText";
import { noteCharacterCount } from "../src/knowledge/notes/markdownAnalysis";
import { adjacentNoteTab, visibleNoteTabs } from "../src/knowledge/workbench/noteTabsModel";
import { emptyWorkbench, MAX_TABS, openNote } from "../src/knowledge/workbench/workbench";
import { newNote } from "../src/knowledge/session/model";

const asset = (size: number, extra: Partial<KnowledgeAttachment> = {}): KnowledgeAttachment => ({
  id: "text-preview",
  name: "config.yaml",
  mime: "application/octet-stream",
  hash: "a".repeat(64),
  size,
  createdAt: 1,
  ...extra,
});

describe("bounded plain-text previews", () => {
  it("reads windows without loading the file and preserves Unicode across page boundaries", async () => {
    const text =
      "x".repeat(TEXT_PREVIEW_PAGE_BYTES - 2) +
      "中🙂文" +
      "y".repeat(TEXT_PREVIEW_PAGE_BYTES - 8) +
      "\ufeffend";
    const bytes = new TextEncoder().encode(text),
      item = asset(bytes.length);
    const binary = new MemoryStore();
    const path = `artifacts/${attachmentPath(item.hash)}`;
    await binary.put(path, bytes);
    const get = binary.get.bind(binary),
      read = binary.readRange.bind(binary);
    const ranges: number[] = [];
    binary.get = async () => {
      throw new Error("must not read entire file");
    };
    binary.getBlob = async () => {
      throw new Error("must not read entire file");
    };
    binary.readRange = async (key, from, length) => {
      ranges.push(length);
      return read(key, from, length);
    };
    const first = await readPlainTextPage(binary, item, 1);
    let combined = first.text;
    for (let page = 2; page <= first.pages; page++)
      combined += (await readPlainTextPage(binary, item, page)).text;
    expect(combined).toBe(text);
    expect(ranges.every((length) => length <= TEXT_PREVIEW_PAGE_BYTES + 4)).toBe(true);
    expect(await get(path)).toEqual(bytes);
    expect(await binary.list()).toEqual([path]);
  });
  it("recognizes safe text types without treating renamed images or PDFs as text", () => {
    for (const extra of [
      { mime: "application/json", name: "settings" },
      { mime: "text/plain", name: "notes" },
      { name: "sample.html" },
      { name: "sample.svg", mime: "image/svg+xml" },
    ])
      expect(isPlainTextAttachment(asset(10, extra))).toBe(true);
    for (const mime of ["image/png", "application/pdf", "audio/mpeg", "video/mp4"])
      expect(isPlainTextAttachment(asset(10, { mime }))).toBe(false);
  });
  it("handles empty files, missing bytes, invalid pages, incomplete reads and cancellation", async () => {
    const binary = new MemoryStore(),
      item = asset(0);
    const path = `artifacts/${attachmentPath(item.hash)}`;
    await expect(readPlainTextPage(binary, item, 1)).rejects.toThrow("缺少附件");
    await binary.put(path, new Uint8Array());
    expect(await readPlainTextPage(binary, item, 1)).toMatchObject({ text: "", pages: 1 });
    for (const page of [0, 2, Number.NaN, 1.5])
      await expect(readPlainTextPage(binary, item, page)).rejects.toThrow("页码");
    await binary.put(path, new Uint8Array([65, 66]));
    await expect(readPlainTextPage(binary, item, 1)).rejects.toThrow("长度不符");
    binary.readRange = async () => new Uint8Array([65]);
    await expect(readPlainTextPage(binary, asset(2), 1)).rejects.toThrow("不完整");
    const controller = new AbortController();
    controller.abort();
    await expect(readPlainTextPage(binary, item, 1, controller.signal)).rejects.toThrow();
  });
});

describe("document orientation", () => {
  it("shows the active preview even when every saved tab is pinned", () => {
    const tabs = Array.from({ length: MAX_TABS }, (_, index) => `note-${index}`);
    const state = { ...emptyWorkbench(), tabs, pinned: tabs };
    const notes = Object.fromEntries(
      [...tabs, "preview"].map((id) => [id, { ...newNote(id), id }]),
    );
    const opened = openNote(state, "preview");
    expect(opened.tabs).toHaveLength(MAX_TABS);
    expect(visibleNoteTabs(opened.tabs, notes, "preview").at(-1)).toBe("preview");
    expect(state.tabs).toEqual(tabs);
  });
  it("closes toward the right neighbor then the left, without inventing a replacement", () => {
    expect(adjacentNoteTab(["a", "b", "c"], "b")).toBe("c");
    expect(adjacentNoteTab(["a", "b", "c"], "c")).toBe("b");
    expect(adjacentNoteTab(["a"], "a")).toBeUndefined();
    expect(adjacentNoteTab(["a"], "missing")).toBeUndefined();
  });
  it("counts visible prose without attachment URLs, link destinations or markup", () => {
    const body =
      "# 标题\n\n**你好** [参考](https://example.com/a/long/path) [[id|别名]] 🙂\n\n[配置](attachment:file-id)\n\n![图片](attachment:image-id)";
    expect(noteCharacterCount(body)).toBe(Array.from("标题你好参考别名🙂").length);
    expect(noteCharacterCount("[config.yaml][file]\n\n[file]: attachment:file-id")).toBe(0);
    expect(noteCharacterCount("```js\nconst x = 1;\n```")).toBe("constx=1;".length);
  });
});
