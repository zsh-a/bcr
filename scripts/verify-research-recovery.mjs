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
async function fixture(createdAt = 1) {
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
      createdAt,
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
  const wrongBuffer = await fixture(999);
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
          window.__recoveryStore = this;
          window.__recoveryCut = true;
          await new Promise(() => {});
        }
        return original.call(this, kind, raw);
      };
    }, cut);
    await page.getByRole("button", { name: "确认恢复 Reader 资料包", exact: true }).click();
    await page.waitForFunction(() => window.__recoveryCut);
    if (cut === "reader-restored" || cut === "collections-merged") {
      const catalog = await page.evaluate(async () => {
        const record = JSON.parse(await window.__recoveryStore.readPackageRecord("recovery"));
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((url) => new URL(url).pathname.endsWith("/apps/reader-studio/src/store.ts"))
          .at(-1);
        const { getReaderState } = await import(url);
        const book = getReaderState().library.find((b) => b.id.startsWith("research-"));
        return {
          format: "bcr-research-volumes",
          version: 1,
          researchHash: "0".repeat(64),
          total: 1,
          books: [
            {
              book: record.manifest.books[0].book.id,
              target: book.id,
              title: book.title,
              hash: book.source.ref.hash,
              volume: 1,
            },
          ],
        };
      });
      const set = await hash(new Blob([JSON.stringify(catalog)]));
      await page.evaluate(
        async (record) =>
          window.__recoveryStore.writePackageRecord("restore", JSON.stringify(record)),
        { volume: { catalog, set, index: 1 } },
      );
    }
    await page.close();
    page = await open(context);
    await page.getByRole("button", { name: "继续恢复", exact: true }).waitFor();
    const summaryBefore = await page.getByLabel("资料来源汇总").allTextContents();
    await page
      .getByLabel("选择 Reader 资料包", { exact: true })
      .setInputFiles({ name: "wrong.zip", mimeType: "application/zip", buffer: wrongBuffer });
    await page.getByRole("status").filter({ hasText: "请选择中断任务的同一资料包分卷" }).waitFor();
    assert.equal(await page.getByLabel("资料包恢复预览").count(), 0);
    assert.deepEqual(await page.getByLabel("资料来源汇总").allTextContents(), summaryBefore);
    if (cut === "collections-merged") {
      await page.getByRole("textbox", { name: /^笔记：/u }).fill("中断后修改，必须保留");
      await page.getByRole("button", { name: "保存笔记", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "已保存到本地" }).waitFor();
      await page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((url) => new URL(url).pathname.endsWith("/apps/reader-studio/src/store.ts"))
          .at(-1);
        const { reader, getReaderState } = await import(url);
        for (const book of getReaderState().library.filter((b) => b.id.startsWith("research-")))
          reader.removeBook(book.id);
      });
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
    assert.equal(count, cut === "collections-merged" ? 0 : 1);
    if (cut === "reader-restored" || cut === "collections-merged") {
      await page
        .getByLabel("资料来源汇总")
        .getByText(
          cut === "collections-merged"
            ? "已恢复 0 · 缺失 1 · 需修复 0"
            : "已恢复 1 · 缺失 0 · 需修复 0",
          { exact: true },
        )
        .waitFor();
    }
    await context.close();
  }
  const lifecycleContext = await browser.newContext();
  const lifecyclePage = await open(lifecycleContext);
  await lifecyclePage.evaluate(async () => {
    const loaded = (suffix) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((url) => new URL(url).pathname.endsWith(suffix))
        .at(-1);
    const reactModule = await import(loaded("/react.js"));
    const React = reactModule.default ?? reactModule;
    const domModule = await import(loaded("/react-dom_client.js"));
    const { createRoot } = domModule.default ?? domModule;
    const { useResearchPackageRecovery } = await import(
      loaded("/src/components/useResearchPackageRecovery.ts")
    );
    const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
    const wait = async (predicate) => {
      for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await tick();
      }
      throw new Error("Hook state did not settle");
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let state;
    function Probe({ store }) {
      state = useResearchPackageRecovery(store);
      return React.createElement("span", null, state.notice);
    }
    const reads = [];
    const store = {
      readPackageRecord: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
      writePackageRecord: async () => {},
    };
    root.render(React.createElement(Probe, { store }));
    await wait(() => reads.length === 1);
    const clearing = state.clear();
    await wait(() => reads.length === 2);
    reads[1].resolve(undefined);
    await clearing;
    await wait(() => state.ready);
    reads[0].reject(new Error("late old read"));
    await tick();
    if (state.notice) throw new Error("Old read replaced a newer refresh");
    const oldReads = [];
    const oldStore = {
      ...store,
      readPackageRecord: () => new Promise((resolve, reject) => oldReads.push({ resolve, reject })),
    };
    root.render(React.createElement(Probe, { store: oldStore }));
    await wait(() => oldReads.length === 1);
    const oldState = state;
    const nextReads = [];
    const nextStore = {
      ...store,
      readPackageRecord: () => new Promise((resolve) => nextReads.push(resolve)),
    };
    root.render(React.createElement(Probe, { store: nextStore }));
    await wait(() => nextReads.length === 1);
    if (state.ready || oldState.isCurrent())
      throw new Error("Previous Store state remained active");
    oldReads[0].reject(new Error("old store failed"));
    await tick();
    if (state.ready || state.notice) throw new Error("Old Store result leaked into the new Store");
    nextReads[0](undefined);
    await wait(() => state.ready);
    const pendingClear = state.clear();
    await wait(() => nextReads.length === 2);
    root.unmount();
    nextReads[1](undefined);
    await pendingClear;
    if (state.isCurrent()) throw new Error("Unmounted scope remained active");
    host.remove();
  });
  await lifecycleContext.close();
  assert.deepEqual(errors, []);
  console.log("Reader research interruption recovery verification PASSED");
} finally {
  await browser.close();
}
