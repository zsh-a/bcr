import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const require = createRequire(new URL("../apps/reader-studio/package.json", import.meta.url));
const { ZipWriter, BlobWriter, TextReader, BlobReader } = require("@zip.js/zip.js");
const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const coreRequire = createRequire(new URL("../packages/core/package.json", import.meta.url));
const { blake3 } = coreRequire("@noble/hashes/blake3.js");
const hash = async (blob) =>
  Buffer.from(blake3(new Uint8Array(await blob.arrayBuffer()))).toString("hex");
async function fixture() {
  const source = new Blob(["恢复中断测试正文"]),
    sourceHash = await hash(source);
  const zip = new ZipWriter(new BlobWriter());
  await zip.add(`sources/${sourceHash}`, new BlobReader(source));
  await zip.add(
    "reader.json",
    new TextReader(
      JSON.stringify({
        format: "bcr-reader-backup",
        version: 1,
        createdAt: 1,
        settings: {
          theme: "paper",
          layout: "scroll",
          fontSize: 20,
          fontFamily: "sans",
          latinFontFamily: "sans",
          lineHeight: 1.7,
          contentWidth: "narrow",
        },
        progressByBook: {},
        bookmarksByBook: {},
        annotationsByBook: {},
        books: [
          {
            book: {
              id: "old",
              title: "恢复中断测试",
              source: { name: "source.txt", format: "txt", mime: "text/plain", size: source.size },
              sections: [
                { id: "s", kind: "text", order: 0, label: "正文", text: "恢复中断测试正文" },
              ],
              importedAt: 1,
              updatedAt: 1,
              tags: [],
            },
            source: { path: `sources/${sourceHash}`, hash: sourceHash, size: source.size },
          },
        ],
      }),
    ),
  );
  const reader = await zip.close();
  const research = new Blob([
    JSON.stringify({
      format: "bcr-research-backup",
      version: 1,
      createdAt: 1,
      includesDrafts: false,
      library: {
        version: 1,
        collections: [
          {
            id: "c",
            name: "恢复测试集合",
            excerpts: [
              {
                id: "e",
                documentId: "doc",
                title: "恢复中断测试",
                source: "Reader",
                owner: "reader",
                route: "/reader?book=old&section=s",
                text: "恢复中断测试正文",
                note: "原始笔记",
                savedAt: 1,
              },
            ],
          },
        ],
      },
    }),
  ]);
  const outer = new ZipWriter(new BlobWriter());
  const entries = [];
  for (const [path, blob] of [
    ["reader.zip", reader],
    ["research.json", research],
  ]) {
    entries.push({ path, size: blob.size, hash: await hash(blob) });
    await outer.add(path, new BlobReader(blob));
  }
  await outer.add(
    "manifest.json",
    new TextReader(JSON.stringify({ format: "bcr-research-package", version: 1, entries })),
  );
  return Buffer.from(await (await outer.close()).arrayBuffer());
}
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const errors = [];
async function open(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/reader`, { waitUntil: "networkidle" });
  await page.getByLabel("导入阅读文件").waitFor();
  await page.getByRole("button", { name: "打开全局搜索" }).click();
  await page.getByRole("button", { name: /资料集合 ·/u }).click();
  await page.getByText("Reader 完整资料包", { exact: true }).click();
  return page;
}
try {
  const buffer = await fixture();
  // Each cut closes the page while the operation is suspended. The same browser
  // context retains real OPFS/SQLite/localStorage for the next page.
  for (const cut of ["sources-staged", "reader-library", "reader-restored", "collections-merged"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    let page = await open(context);
    await page
      .getByLabel("选择 Reader 资料包", { exact: true })
      .setInputFiles({ name: "recovery.zip", mimeType: "application/zip", buffer });
    await page.getByLabel("资料包恢复预览").waitFor();
    await page.evaluate(async (phase) => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((url) => new URL(url).pathname.endsWith("/src/research.ts"))
        .at(-1);
      if (!url) throw new Error("Research module not loaded");
      if (phase === "sources-staged" || phase === "reader-library") {
        const runtimeUrl = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((url) =>
            new URL(url).pathname.endsWith("/apps/reader-studio/src/readerRuntimeCore.ts"),
          )
          .at(-1);
        const { readerRuntime, ensureReaderMetadata } = await import(runtimeUrl);
        const runtime = readerRuntime();
        await ensureReaderMetadata(runtime);
        const write = runtime.meta.kvSet.bind(runtime.meta);
        runtime.meta.kvSet = async (key, raw) => {
          if (key === "reader/library" && raw.includes("research-")) {
            if (phase === "reader-library") await write(key, raw);
            window.__recoveryCut = true;
            await new Promise(() => {});
          }
          return write(key, raw);
        };
        return;
      }
      const { ResearchStore } = await import(url);
      const original = ResearchStore.prototype.writePackageRecord;
      ResearchStore.prototype.writePackageRecord = async function (kind, raw) {
        if (kind === "recovery" && JSON.parse(raw).phase === phase) {
          window.__recoveryCut = true;
          await new Promise(() => {});
        }
        return original.call(this, kind, raw);
      };
    }, cut);
    await page.getByRole("button", { name: "确认恢复 Reader 资料包", exact: true }).click();
    await page.waitForFunction(() => window.__recoveryCut);
    await page.close();
    page = await open(context);
    await page.getByRole("button", { name: "继续恢复", exact: true }).waitFor();
    if (cut === "collections-merged") {
      await page.getByRole("textbox", { name: /^笔记：/u }).fill("中断后修改，必须保留");
      await page.getByRole("button", { name: "保存笔记", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "已保存到本地" }).waitFor();
    }
    await page.getByRole("button", { name: "继续恢复", exact: true }).click();
    await page
      .getByRole("button", { name: "继续恢复", exact: true })
      .waitFor({ state: "detached" });
    assert.equal(await page.locator('[aria-label="集合摘录"] article').count(), 1);
    assert.equal(
      await page.getByRole("textbox", { name: /^笔记：/u }).inputValue(),
      cut === "collections-merged" ? "中断后修改，必须保留" : "原始笔记",
    );
    const count = await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((url) => new URL(url).pathname.endsWith("/apps/reader-studio/src/store.ts"))
        .at(-1);
      const { getReaderState } = await import(url);
      return getReaderState().library.filter((b) => b.id.startsWith("research-")).length;
    });
    assert.equal(count, 1);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("Reader research interruption recovery verification PASSED");
} finally {
  await browser.close();
}
