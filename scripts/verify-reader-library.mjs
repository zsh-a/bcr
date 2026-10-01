import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, devices } from "playwright";
import { trackModuleRequests } from "./lib/modules.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch();
async function attachStore(page) {
  await page.evaluate(async () => {
    const urls = await window.__bcrTestModuleUrls();
    window.libraryAudit = await import(
      urls.find((url) => new URL(url).pathname.endsWith("/packages/reader-studio/src/store.ts"))
    );
  });
}
async function openLibrary(page) {
  await page.getByLabel("阅读内容", { exact: true }).waitFor();
  const button = page.getByRole("button", { name: "打开书库", exact: true });
  if (await button.isVisible()) await button.click();
}
const files = ["First", "Second", "Third"].map((name) => ({
  name: `${name}.txt`,
  mimeType: "text/plain",
  buffer: Buffer.from(
    [
      name,
      "第一章 开始",
      ...Array.from(
        { length: 100 },
        (_, index) => `${name} ${index} needle ${"在安静的书页间停留。".repeat(8)}`,
      ),
      "第二章 结束",
      "另一章的正文。",
    ].join("\n\n"),
  ),
}));
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await trackModuleRequests(page);
  await page.goto(`${origin}/pwa/reader/`);
  await page.getByLabel("导入阅读文件", { exact: true }).setInputFiles(files);
  await page.getByText("导入完成", { exact: true }).waitFor();
  await attachStore(page);
  await openLibrary(page);
  await page.getByRole("button", { name: "管理 First", exact: true }).click();
  await page.getByRole("button", { name: "收藏读物", exact: true }).click();
  await page.getByLabel("读物名称", { exact: true }).fill("第一册（已改名）");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await page.getByRole("button", { name: "管理 第一册（已改名）", exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.reload();
  await openLibrary(page);
  await page.getByLabel("筛选书名或作者", { exact: true }).waitFor();
  await attachStore(page);
  await page.getByLabel("仅收藏", { exact: true }).check();
  await page.waitForFunction(() => document.querySelectorAll(".reader-book-card").length === 1);
  assert.match(await page.locator(".reader-book-card").innerText(), /第一册（已改名）/u);
  await page.getByLabel("仅收藏", { exact: true }).uncheck();
  await page.getByLabel("筛选书名或作者", { exact: true }).fill("已改名");
  assert.equal(await page.locator(".reader-book-card").count(), 1);
  await page.getByLabel("筛选书名或作者", { exact: true }).fill("");
  await page.getByLabel("书库排序", { exact: true }).selectOption("favorite");
  assert.match(await page.locator(".reader-book-card").first().innerText(), /第一册（已改名）/u);

  await page.keyboard.press("Control+f");
  await page.getByLabel("在书库中搜索", { exact: true }).fill("needle");
  await page.waitForFunction(() => window.libraryAudit.getReaderState().searchHits.length === 80);
  const counts = await page.evaluate(() => {
    const state = window.libraryAudit.getReaderState();
    return state.library
      .filter((book) => !book.tags.includes("DEMO"))
      .map((book) => state.searchHits.filter((hit) => hit.bookId === book.id).length);
  });
  assert.deepEqual(counts, [27, 27, 26]);
  await page
    .getByText("显示 80 次出现，已按读物分配结果；请缩小范围或细化关键词。", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "关闭搜索结果", exact: true }).click();
  await page.locator(".reader-book-card").filter({ hasText: "第一册（已改名）" }).click();
  await page.getByRole("button", { name: "从进度条前往 第二章 结束", exact: true }).click();
  await page.waitForFunction(() => {
    const state = window.libraryAudit.getReaderState();
    const book = state.library.find((item) => item.id === state.activeBookId);
    return (
      state.activeSectionId === book.toc.find((item) => item.label === "第二章 结束").sectionId
    );
  });
  await page.getByRole("button", { name: "标记当前位置", exact: true }).click();
  await page.getByRole("button", { name: "打开阅读目录", exact: true }).click();
  await page.getByRole("tab", { name: /书签/u }).click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("tabpanel")
    .getByRole("button", { name: "导出书签（JSON）", exact: true })
    .click();
  const download = await downloaded;
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.format, "bcr-reader-bookmarks");
  assert.equal(exported.book.title, "第一册（已改名）");
  assert.equal(exported.bookmarks.length, 1);
  assert(exported.bookmarks[0].locator.sectionId);
  assert.match(download.suggestedFilename(), /bookmarks\.json$/u);
  await page.getByRole("button", { name: "关闭阅读导航", exact: true }).click();

  const before = await page.evaluate(() => {
    const state = window.libraryAudit.getReaderState();
    return { id: state.activeBookId, locator: state.progressByBook[state.activeBookId].locator };
  });
  await page.getByRole("button", { name: "管理书库", exact: true }).click();
  await page.getByRole("button", { name: "选择 Second", exact: true }).click();
  await page.getByRole("button", { name: "选择 Third", exact: true }).click();
  await page.getByRole("button", { name: "移除所选…", exact: true }).click();
  assert.match(
    await page.getByRole("dialog", { name: "移除 2 本读物？", exact: true }).innerText(),
    /Second[\s\S]*Third/u,
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.locator(".reader-book-card").count(), 4);
  await page.getByRole("button", { name: "移除所选…", exact: true }).click();
  await page.getByRole("button", { name: "确认移除所选读物", exact: true }).click();
  await page.waitForFunction(() => window.libraryAudit.getReaderState().library.length === 2);
  assert.equal(
    await page.evaluate(() => window.libraryAudit.getReaderState().activeBookId),
    before.id,
  );
  assert.deepEqual(
    await page.evaluate(() => {
      const state = window.libraryAudit.getReaderState();
      return state.progressByBook[state.activeBookId].locator;
    }),
    before.locator,
  );
  await page.reload();
  await openLibrary(page);
  await page.getByLabel("筛选书名或作者", { exact: true }).waitFor();
  assert.equal(await page.locator(".reader-book-card").count(), 2);
  assert.equal(await page.getByRole("button", { name: "管理 Second", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();

  const mobile = await browser.newContext({ ...devices["iPhone 13"] });
  const phone = await mobile.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(`${origin}/pwa/reader/`);
  await phone.getByRole("button", { name: "打开书库", exact: true }).click();
  await phone
    .locator(".reader-library-panel")
    .getByLabel("导入阅读文件", { exact: true })
    .setInputFiles(files[0]);
  await phone.getByText("导入完成", { exact: true }).waitFor();
  const libraryButton = phone.getByRole("button", { name: "打开书库", exact: true });
  if (await libraryButton.isVisible()) await libraryButton.click();
  const action = phone.getByRole("button", { name: "管理 First", exact: true });
  const target = await action.boundingBox();
  assert(target.width >= 44 && target.height >= 44);
  await action.click();
  await phone.getByRole("button", { name: "收藏读物", exact: true }).click();
  await phone.getByLabel("读物名称", { exact: true }).fill("手机中的书");
  await phone.getByRole("button", { name: "保存名称", exact: true }).click();
  await phone.getByRole("button", { name: "管理 手机中的书", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await mobile.close();
  console.log(
    "Reader library PASSED: rename/favorite persistence, fair search, chapter jump, bookmark JSON download, atomic batch removal and iPhone actions",
  );
} finally {
  await browser.close();
}
