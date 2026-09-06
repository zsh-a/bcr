import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const require = createRequire(new URL("../apps/reader-studio/package.json", import.meta.url));
const { ZipWriter, BlobWriter, TextReader } = require("@zip.js/zip.js");
const readerModules = Object.fromEntries(
  ["readerRuntimeCore", "readerPersistenceQueue", "store"].map((name) => [
    name,
    "/@fs" + fileURLToPath(new URL(`../apps/reader-studio/src/${name}.ts`, import.meta.url)),
  ]),
);
const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const errors = [];
async function pageIn(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/reader`, { waitUntil: "networkidle" });
  await page.getByLabel("导入阅读文件").waitFor();
  return page;
}
async function open(page) {
  await page.getByRole("button", { name: "打开全局搜索" }).click();
  await page.getByRole("button", { name: /资料集合 ·/u }).click();
}
const saved = (page) => page.getByRole("status").filter({ hasText: "已保存到本地" }).waitFor();
async function choosePackage(page, buffer) {
  await page
    .getByLabel("选择 Reader 资料包", { exact: true })
    .setInputFiles({ name: "research.zip", mimeType: "application/zip", buffer });
}
async function epub() {
  const zip = new ZipWriter(new BlobWriter());
  await zip.add("mimetype", new TextReader("application/epub+zip"));
  await zip.add(
    "META-INF/container.xml",
    new TextReader(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
  );
  await zip.add(
    "book.opf",
    new TextReader(
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">package-test</dc:identifier><dc:title>EPUB资料包</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="picture" href="proof.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    ),
  );
  await zip.add(
    "chapter.xhtml",
    new TextReader(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>证据</title></head><body><h1>EPUB资料包</h1><p>EPUB迁移证据需要正确高亮。</p><img src="proof.svg" alt="随源文件恢复的插图"/></body></html>',
    ),
  );
  await zip.add(
    "proof.svg",
    new TextReader(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="green"/></svg>',
    ),
  );
  return Buffer.from(await (await zip.close()).arrayBuffer());
}
try {
  const a = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await pageIn(a);
  for (const [name, mimeType, buffer] of [
    ["source.md", "text/markdown", Buffer.from("# Markdown资料包\n\nMarkdown迁移证据需要保留。")],
    ["source.epub", "application/epub+zip", await epub()],
  ]) {
    await page.getByLabel("导入阅读文件").setInputFiles({ name, mimeType, buffer });
    await page.getByText("导入完成", { exact: true }).waitFor();
    await page.getByLabel("导入阅读文件").waitFor({ state: "visible" });
  }
  await open(page);
  await page.getByLabel("新集合名称").fill("跨浏览器资料");
  await page.getByRole("button", { name: "创建集合", exact: true }).click();
  await saved(page);
  for (const query of ["Markdown迁移证据", "EPUB迁移证据"]) {
    await page.getByRole("button", { name: "工作区搜索", exact: true }).click();
    await page.getByRole("textbox", { name: "全局搜索", exact: true }).fill(query);
    await page.getByRole("tab", { name: /^阅读器/u }).click();
    await page.getByRole("listbox", { name: "搜索结果" }).getByRole("option").first().waitFor();
    await page.getByRole("button", { name: "保存当前结果", exact: true }).click();
    await saved(page);
  }
  await page.getByRole("button", { name: /资料集合 ·/u }).click();
  const first = page
    .locator('[aria-label="集合摘录"] article')
    .filter({ hasText: "Markdown迁移证据" });
  await first.getByRole("textbox", { name: /^笔记：/u }).fill("必须随资料包恢复的个人笔记");
  await first.getByRole("button", { name: "保存笔记", exact: true }).click();
  await saved(page);
  await first.getByRole("textbox", { name: /^笔记：/u }).fill("需要保留的未保存草稿");
  await first.getByRole("button", { name: "核对与重新关联", exact: true }).click();
  await first.getByLabel("查找其它已加载来源").check();
  await first.getByLabel("筛选当前来源").fill("EPUB迁移证据");
  const select = first.getByLabel("选择当前来源片段");
  await select.selectOption(await select.locator("option").nth(1).getAttribute("value"));
  await first.getByLabel("新引用终点").fill("12");
  await first.getByRole("button", { name: "确认重新关联", exact: true }).click();
  await saved(page);
  await page.getByText("Reader 完整资料包", { exact: true }).click();
  await page.getByLabel("打包集合：跨浏览器资料").check();
  await page.getByLabel("资料包包含草稿").check();
  await page.getByRole("button", { name: "检查资料包", exact: true }).click();
  await page.getByLabel("资料包导出预览").waitFor();
  assert.ok((await page.getByLabel("资料包导出预览").innerText()).includes("2 本 Reader"));
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "生成并下载资料包", exact: true }).click();
  const buffer = await readFile(await (await downloading).path());
  await a.close();

  const b = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const restored = await pageIn(b);
  await open(restored);
  await restored.getByText("Reader 完整资料包", { exact: true }).click();
  await choosePackage(restored, Buffer.from("corrupt"));
  await restored
    .getByRole("status")
    .filter({ hasText: /zip|ZIP|format|Format|signature|Signature|file|File/u })
    .first()
    .waitFor();
  assert.equal(await restored.locator('[aria-label="集合摘录"] article').count(), 0);
  await choosePackage(restored, buffer);
  await restored.getByLabel("资料包恢复预览").waitFor();
  await restored.getByRole("button", { name: "取消资料包恢复", exact: true }).click();
  assert.equal(await restored.locator('[aria-label="集合摘录"] article').count(), 0);
  await choosePackage(restored, buffer);
  // Reuse the modules loaded by Vite, including their HMR version query.
  const liveModules = await restored.evaluate(
    (paths) =>
      Object.fromEntries(
        Object.entries(paths).map(([name, path]) => {
          const loaded = performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((url) => new URL(url).pathname === path)
            .at(-1);
          if (!loaded) throw new Error(`Reader module not loaded: ${name}`);
          return [name, loaded];
        }),
      ),
    readerModules,
  );
  // Pause an actual SQLite library write, then change the live library and
  // enqueue an autosave. The restore must merge against these newer changes.
  await restored.evaluate(async (modules) => {
    const { readerRuntime, ensureReaderMetadata } = await import(modules.readerRuntimeCore);
    const runtime = readerRuntime();
    await ensureReaderMetadata(runtime);
    const write = runtime.meta.kvSet.bind(runtime.meta);
    const gate = { entered: false, release: undefined };
    window.__readerCommitGate = gate;
    runtime.meta.kvSet = async (key, raw) => {
      if (!gate.entered && key === "reader/library" && raw.includes("research-")) {
        gate.entered = true;
        await new Promise((resolve) => {
          gate.release = resolve;
        });
      }
      return write(key, raw);
    };
  }, liveModules);
  await restored.getByRole("button", { name: "确认恢复 Reader 资料包", exact: true }).click();
  await restored.waitForFunction(() => window.__readerCommitGate?.entered);
  await restored.evaluate(async (modules) => {
    const { reader, getReaderState } = await import(modules.store);
    const { readerRuntime } = await import(modules.readerRuntimeCore);
    const { persistReaderSnapshot } = await import(modules.readerPersistenceQueue);
    const original = getReaderState().library[0];
    reader.addBook({
      ...original,
      id: "local-during-restore",
      title: "恢复期间新增的本地资料",
      source: { name: "local.txt", format: "txt", mime: "text/plain", size: 18 },
      sections: [
        {
          id: "local-section",
          order: 0,
          label: "本地正文",
          kind: "text",
          text: "恢复期间新增的本地资料必须保留。",
        },
      ],
    });
    reader.removeBook(original.id);
    reader.setSettings({ fontSize: 24 });
    window.__readerConcurrentSave = persistReaderSnapshot(readerRuntime(), { strict: true });
    window.__readerConcurrentSave.catch(() => {});
    window.__readerCommitGate.release();
  }, liveModules);
  await saved(restored);
  const concurrent = await restored.evaluate(async (modules) => {
    await window.__readerConcurrentSave;
    const { getReaderState } = await import(modules.store);
    const state = getReaderState();
    return {
      ids: state.library.map((book) => book.id),
      active: state.activeBookId,
      fontSize: state.settings.fontSize,
    };
  }, liveModules);
  assert.equal(concurrent.ids.length, 3);
  assert.ok(concurrent.ids.includes("local-during-restore"));
  assert.equal(concurrent.active, "local-during-restore");
  assert.equal(concurrent.fontSize, 24);
  assert.equal(await restored.locator('[aria-label="集合摘录"] article').count(), 2);
  const original = restored
    .locator('[aria-label="集合摘录"] article')
    .filter({ hasText: "Markdown迁移证据" });
  assert.equal(
    await original.getByRole("textbox", { name: /^笔记：/u }).inputValue(),
    "需要保留的未保存草稿",
  );
  await original.getByText("关联修订记录 · 1", { exact: true }).waitFor();
  // Repeat import must reuse both source identities and the mapped collection.
  await choosePackage(restored, buffer);
  await restored.getByLabel("资料包恢复预览").waitFor();
  assert.ok((await restored.getByLabel("资料包恢复预览").innerText()).includes("跳过 1"));
  await restored.getByRole("button", { name: "确认恢复 Reader 资料包", exact: true }).click();
  await saved(restored);
  assert.equal(await restored.locator('[aria-label="集合摘录"] article').count(), 2);
  await original.getByRole("button", { name: "回到原文", exact: true }).click();
  await restored.waitForURL(/book=research-/u);
  await restored.locator('[data-reader-search-match="true"]').first().waitFor();
  assert.equal(
    await restored
      .locator('[data-reader-search-match="true"]')
      .allTextContents()
      .then((parts) => parts.join("")),
    "EPUB资料包EPUB迁",
  );
  await restored.getByRole("img", { name: "随源文件恢复的插图" }).evaluate((img) => {
    if (!img.complete || img.naturalWidth !== 80) throw new Error("EPUB illustration not restored");
  });
  await restored.reload({ waitUntil: "networkidle" });
  const reopened = await restored.evaluate(async (modules) => {
    const { getReaderState } = await import(modules.store);
    return {
      ids: getReaderState().library.map((book) => book.id),
      fontSize: getReaderState().settings.fontSize,
    };
  }, liveModules);
  assert.deepEqual(reopened.ids, concurrent.ids);
  assert.equal(reopened.fontSize, 24);

  await restored.locator('[data-reader-search-match="true"]').first().waitFor();
  await restored.getByRole("img", { name: "随源文件恢复的插图" }).evaluate(async (img) => {
    await img.decode();
    if (img.naturalWidth !== 80) throw new Error("EPUB illustration lost after reload");
  });
  await open(restored);
  const epubCard = restored
    .locator('[aria-label="集合摘录"] article')
    .filter({ hasText: "EPUB迁移证据" })
    .last();
  await epubCard.getByRole("button", { name: "回到原文", exact: true }).click();
  await restored
    .locator('[data-reader-search-match="true"]')
    .filter({ hasText: "EPUB迁移证据" })
    .waitFor();
  await mkdir(new URL("./shots/", import.meta.url), { recursive: true });
  await restored.screenshot({
    path: new URL("./shots/research-package-restored.png", import.meta.url).pathname,
  });
  assert.deepEqual(errors, []);
  await b.close();
  console.log("Reader research package cross-browser verification PASSED");
} finally {
  await browser.close();
}
