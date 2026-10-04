import { describe, expect, it } from "vitest";
import { parseSharedContent } from "../src/shareInbox";

describe("Android shared content validation", () => {
  it("accepts URLs sent in Android's text field without dropping their surrounding text", () => {
    const form = new FormData();
    form.set("title", "  阅读资料  ");
    form.set("text", "稍后阅读 https://example.com/article");
    const share = parseSharedContent("knowledge", form);
    expect(share.title).toBe("阅读资料");
    expect(share.text).toBe("稍后阅读 https://example.com/article");
    expect(share.files).toEqual([]);
    expect(share.id).toMatch(/^[\da-f-]{36}$/u);
  });
  it("rejects empty notes, unsafe URL parameters and oversized text", () => {
    const form = new FormData();
    expect(() => parseSharedContent("knowledge", form)).toThrow("没有收到");
    form.set("url", "javascript:alert(1)");
    expect(() => parseSharedContent("knowledge", form)).toThrow("http");
    form.delete("url");
    form.set("text", "a".repeat(200_001));
    expect(() => parseSharedContent("knowledge", form)).toThrow("过长");
  });
  it("accepts reader files, preserving names and binary content", async () => {
    const form = new FormData();
    form.append("files", new File(["中文正文"], "书籍.TXT", { type: "text/plain" }));
    const content = parseSharedContent("reader", form);
    expect(content.files[0]?.name).toBe("书籍.TXT");
    expect(await content.files[0]?.text()).toBe("中文正文");
    expect(() => parseSharedContent("knowledge", form)).toThrow("导入附件");
  });
  it("rejects unsupported files and batches exceeding the mobile limit", () => {
    const form = new FormData();
    form.append("files", new File(["binary"], "installer.exe"));
    expect(() => parseSharedContent("reader", form)).toThrow("仅支持");
    form.delete("files");
    for (let i = 0; i < 9; i++) form.append("files", new File(["text"], `${i}.txt`));
    expect(() => parseSharedContent("reader", form)).toThrow("8 个文件");
  });
});
