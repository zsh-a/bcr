import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const quote = "重复选段 é😀";
const selectSecond = async () => {
  await page
    .locator(".reader-prose")
    .first()
    .evaluate((prose, quote) => {
      const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
      const matches = [];
      let node;
      while ((node = walker.nextNode())) {
        const index = node.textContent.indexOf(quote);
        if (index >= 0) matches.push({ node, index });
      }
      const target = matches.at(-1);
      if (!target) throw new Error("selection fixture not rendered");
      const range = document.createRange();
      range.setStart(target.node, target.index);
      range.setEnd(target.node, target.index + quote.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, quote);
  await page.getByRole("button", { name: "加入资料集合", exact: true }).click();
};
try {
  await page.goto(`${origin}/reader`);
  await page.getByLabel("导入阅读文件").setInputFiles({
    name: "capture.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      `<html><head><title>Direct capture</title></head><body><p>第一处。${quote}。前段结束。</p><p>分隔正文。</p><p>第二处。${quote}。后段结束。</p></body></html>`,
    ),
  });
  await page.getByText("导入完成", { exact: true }).waitFor();
  await selectSecond();
  await page.getByLabel("集合名称", { exact: true }).fill("阅读现场");
  await page.getByLabel("摘录笔记", { exact: true }).fill("保存第二处，稍后核对");
  await page.evaluate(() => {
    const write = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = function (...args) {
      if (this.name === "meta.db")
        return Promise.reject(new DOMException("collection storage full", "QuotaExceededError"));
      return write.apply(this, args);
    };
    window.restoreCaptureWrites = () => {
      FileSystemFileHandle.prototype.createWritable = write;
    };
  });
  await page.getByRole("button", { name: "保存到集合", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "collection storage full" }).waitFor();
  assert.equal(
    await page.getByLabel("摘录笔记", { exact: true }).inputValue(),
    "保存第二处，稍后核对",
  );
  await page.evaluate(() => window.restoreCaptureWrites());
  await page.getByRole("button", { name: "保存到集合", exact: true }).click();
  // A failed SQLite flush may have updated the live DB before rejecting.
  // Retrying must durably commit that same excerpt, with either acknowledgement.
  await page.getByRole("dialog", { name: "保存选段", exact: true }).waitFor({ state: "hidden" });
  await page.getByText(/^(已加入资料集合|此选段已在集合中，已有笔记保留。)$/u).waitFor();
  await selectSecond();
  await page.getByRole("button", { name: "保存到集合", exact: true }).click();
  await page.getByRole("dialog", { name: "保存选段", exact: true }).waitFor({ state: "hidden" });
  await page.getByText("此选段已在集合中，已有笔记保留。", { exact: true }).waitFor();
  await page.reload();
  await page.locator(".reader-workspace").waitFor();
  await page.getByRole("button", { name: "打开全局搜索", exact: true }).click();
  await page.getByRole("button", { name: /资料集合 ·/u }).click();
  assert.equal(await page.locator('[aria-label="集合摘录"] article').count(), 1);
  assert.equal(
    await page.getByRole("textbox", { name: /^笔记：/u }).inputValue(),
    "保存第二处，稍后核对",
  );
  await page.getByRole("button", { name: "回到原文", exact: true }).click();
  await page.waitForURL(/cite=/u);
  const citation = JSON.parse(new URL(page.url()).searchParams.get("cite"));
  assert(citation.start > 20, "citation resolved to the first repeated passage");
  await page.locator('[data-reader-search-match="true"]').first().waitFor();
  assert.equal(
    await page.locator('[data-reader-search-match="true"]').first().textContent(),
    quote,
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await selectSecond();
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({
    path: "scripts/shots/reader-capture-mobile.png",
    animations: "disabled",
  });
  const sheet = await page.locator(".reader-capture-sheet").boundingBox();
  assert(
    sheet && sheet.width > 300 && sheet.x >= 0 && sheet.y >= 0 && sheet.y + sheet.height <= 812,
    "capture sheet escaped the mobile viewport",
  );
  assert(await page.getByRole("button", { name: "保存到集合", exact: true }).isVisible());
  await page.getByRole("button", { name: "关闭摘录", exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    "Reader capture PASSED: second occurrence, collection creation, note, deduplication, refresh, source return, mobile sheet",
  );
} catch (error) {
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({ path: "scripts/shots/reader-capture-failure.png" });
  throw error;
} finally {
  await browser.close();
}
