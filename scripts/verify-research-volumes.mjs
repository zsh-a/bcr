import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const require = createRequire(new URL("../apps/reader-studio/package.json", import.meta.url));
const { ZipWriter, BlobWriter, TextReader } = require("@zip.js/zip.js");
const resumeTask = process.env.RESUME_TASK === "1";
const streaming = process.env.STREAM_SAVE === "1";
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
async function epub(label) {
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
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">package-test</dc:identifier><dc:title>EPUB资料包</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="picture" href="proof.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>'.replaceAll(
        "EPUB资料包",
        label,
      ),
    ),
  );
  await zip.add(
    "chapter.xhtml",
    new TextReader(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>证据</title></head><body><h1>EPUB资料包</h1><p>EPUB迁移证据需要正确高亮。</p><img src="proof.svg" alt="随源文件恢复的插图"/></body></html>'
        .replaceAll("EPUB资料包", label)
        .replaceAll("EPUB迁移证据", `${label}迁移证据`),
    ),
  );
  await zip.add(
    "proof.svg",
    new TextReader(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="green"/></svg>',
    ),
  );
  await zip.add("padding.txt", new TextReader(label.repeat(650 * 1024)), { level: 0 });
  return Buffer.from(await (await zip.close()).arrayBuffer());
}
try {
  const a = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  if (streaming)
    await a.addInitScript(() => {
      window.showSaveFilePicker = async ({ suggestedName }) => {
        window.__savedPackage = suggestedName;
        return (await navigator.storage.getDirectory()).getFileHandle(suggestedName, {
          create: true,
        });
      };
    });
  const page = await pageIn(a);
  for (const label of ["A", "B"]) {
    await page.getByLabel("导入阅读文件").setInputFiles({
      name: `${label}.epub`,
      mimeType: "application/epub+zip",
      buffer: await epub(label),
    });
    await page.getByText("导入完成", { exact: true }).waitFor();
  }
  await open(page);
  await page.getByLabel("新集合名称").fill("分卷资料");
  await page.getByRole("button", { name: "创建集合", exact: true }).click();
  await saved(page);
  for (const query of ["A迁移证据", "B迁移证据"]) {
    await page.getByRole("button", { name: "工作区搜索", exact: true }).click();
    await page.getByRole("textbox", { name: "全局搜索", exact: true }).fill(query);
    await page.getByRole("tab", { name: /^阅读器/u }).click();
    await page.getByRole("listbox", { name: "搜索结果" }).getByRole("option").first().waitFor();
    await page.getByRole("button", { name: "保存当前结果", exact: true }).click();
    await saved(page);
  }
  await page.getByRole("button", { name: /资料集合 ·/u }).click();
  await page.getByText("Reader 完整资料包", { exact: true }).click();
  await page.getByLabel("打包集合：分卷资料").check();
  await page.getByLabel("单卷源文件上限", { exact: true }).selectOption(String(1024 * 1024));
  await page.getByRole("button", { name: "检查资料包", exact: true }).click();
  await page.getByLabel("资料包导出预览").waitFor();
  assert.equal(await page.getByLabel("选择资料包分卷").locator("option").count(), 2);
  const buffers = [];
  for (const index of [0, 1]) {
    await page.getByLabel("选择资料包分卷").selectOption(String(index));
    if (streaming) {
      await page.getByRole("button", { name: "直接保存当前卷", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: `第 ${index + 1}/2 卷已保存。` })
        .waitFor();
      buffers.push(
        Buffer.from(
          await page.evaluate(async () => {
            const handle = await (
              await navigator.storage.getDirectory()
            ).getFileHandle(window.__savedPackage);
            return [...new Uint8Array(await (await handle.getFile()).arrayBuffer())];
          }),
        ),
      );
    } else {
      const downloading = page.waitForEvent("download");
      await page.getByRole("button", { name: "生成并下载资料包", exact: true }).click();
      const download = await downloading;
      assert.match(download.suggestedFilename(), new RegExp(`-${index + 1}-of-2\\.zip$`));
      buffers.push(await readFile(await download.path()));
    }
    if (resumeTask && index === 0) {
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="分卷任务保存状态"]')?.textContent ===
          "分卷任务已保存到本地",
      );
      await page.reload({ waitUntil: "networkidle" });
      await open(page);
      await page.getByText("Reader 完整资料包", { exact: true }).click();
      await page.getByLabel("上次分卷任务").waitFor();
      assert.ok((await page.getByLabel("上次分卷任务").innerText()).includes("1 卷已有输出记录"));
      await page.getByRole("button", { name: "核验并继续上次任务", exact: true }).click();
      await page.getByLabel("资料包导出预览").waitFor();
      assert.equal(await page.getByLabel("选择资料包分卷").inputValue(), "1");
    }
  }
  assert.equal(
    (await page.getByLabel("资料包分卷清单").innerText()).match(
      streaming ? /已保存到文件/gu : /已触发下载/gu,
    ).length,
    2,
  );
  await a.close();
  const b = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const restored = await pageIn(b);
  await open(restored);
  await restored.getByText("Reader 完整资料包", { exact: true }).click();
  for (const [step, index] of [1, 1, 0, 0].entries()) {
    await choosePackage(restored, buffers[index]);
    await restored.getByLabel("资料包恢复预览").waitFor();
    if (step)
      assert.ok((await restored.getByLabel("资料包恢复预览").innerText()).includes("跳过 1"));
    await restored.getByRole("button", { name: "确认恢复 Reader 资料包", exact: true }).click();
    await saved(restored);
    await restored.getByLabel("资料包恢复预览").waitFor({ state: "hidden" });
    assert.equal(await restored.locator('[aria-label="集合摘录"] article').count(), 2);
    const statuses = await restored.getByLabel("分卷来源恢复状态").innerText();
    if (step < 2) {
      assert.ok(statuses.includes("待恢复第 1 卷"));
      await restored
        .locator('[aria-label="集合摘录"] article')
        .filter({ hasText: "待恢复第 1/2 卷" })
        .waitFor();
    } else assert.equal(statuses.includes("待恢复"), false);
    if (resumeTask && step === 0) {
      await restored.getByLabel("按卷查看来源").selectOption("1");
      assert.equal(await restored.getByLabel("分卷来源恢复状态").locator("li").count(), 1);
      assert.ok(
        (await restored.getByLabel("分卷来源恢复状态").innerText()).includes("待恢复第 1 卷"),
      );
      await restored.getByLabel("按卷查看来源").selectOption("2");
      assert.equal(await restored.getByLabel("分卷来源恢复状态").locator("li").count(), 1);
      assert.ok((await restored.getByLabel("分卷来源恢复状态").innerText()).includes("已恢复"));
      await restored.getByLabel("按卷查看来源").selectOption("0");
    }
  }
  for (const label of ["A", "B"]) {
    const article = restored
      .locator('[aria-label="集合摘录"] article')
      .filter({ hasText: `${label}迁移证据` });
    await article.getByRole("button", { name: "回到原文", exact: true }).click();
    await restored.waitForURL(/book=research-/u);
    await restored.locator('[data-reader-search-match="true"]').first().waitFor();
    await restored.waitForFunction(
      (needle) =>
        [...document.querySelectorAll('[data-reader-search-match="true"]')]
          .map((node) => node.textContent)
          .join("")
          .includes(needle),
      `${label}迁移证据`,
    );
    // Reload first restores text; binary resources are rebuilt in the background.
    await restored.waitForFunction(() => {
      const img = document.querySelector('img[alt="随源文件恢复的插图"]');
      return img?.complete && img.naturalWidth === 80;
    });
    await restored.getByRole("img", { name: "随源文件恢复的插图" }).evaluate(async (img) => {
      await img.decode();
      if (!img.complete || img.naturalWidth !== 80) throw new Error("EPUB image missing");
    });
    await restored.reload({ waitUntil: "networkidle" });
    await restored.locator('[data-reader-search-match="true"]').first().waitFor();
    await open(restored);
  }
  assert.equal(await restored.locator('[aria-label="集合摘录"] article').count(), 2);
  assert.equal(
    (await restored.locator('[aria-label="集合摘录"]').innerText()).includes("待恢复第"),
    false,
  );
  if (resumeTask) {
    await restored.getByText("Reader 完整资料包", { exact: true }).click();
    await restored.getByLabel("资料来源汇总").waitFor();
    await restored.getByRole("button", { name: "重新核验来源状态", exact: true }).click();
    await restored.getByRole("status").filter({ hasText: "来源状态已重新核验" }).waitFor();
    assert.ok((await restored.getByLabel("资料来源汇总").innerText()).includes("已恢复 2"));
  }
  assert.deepEqual(errors, []);
  console.log(
    "Research volumes: sequential downloads, fresh storage, missing-volume hints, reverse/repeated restore, EPUB images and citation jumps/reload passed.",
  );
} finally {
  await browser.close();
}
