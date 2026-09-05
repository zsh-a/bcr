import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const require = createRequire(new URL("../apps/reader-studio/package.json", import.meta.url));
const { BlobWriter, TextReader, ZipWriter } = require("@zip.js/zip.js");
const writer = new ZipWriter(new BlobWriter("application/epub+zip"));
await writer.add("mimetype", new TextReader("application/epub+zip"));
await writer.add(
  "META-INF/container.xml",
  new TextReader('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
);
await writer.add(
  "book.opf",
  new TextReader(
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>分页边界测试</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
  ),
);
for (const [name, label] of [
  ["one", "第一章"],
  ["two", "第二章"],
]) {
  const paragraphs = Array.from(
    { length: 90 },
    (_, i) =>
      `<p>${label}第 ${i} 段。${`阅读位置属于文字而不是屏幕，每次翻页都应回应操作 ${i}。`.repeat(5)}</p>`,
  ).join("");
  await writer.add(
    `${name}.xhtml`,
    new TextReader(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${label}</title></head><body><h1>${label}</h1>${paragraphs}</body></html>`,
    ),
  );
}
const fixture = Buffer.from(await (await writer.close()).arrayBuffer());
const browser = await chromium.launch({ headless: true });
const base = new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString();
mkdirSync(new URL("./shots/", import.meta.url), { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator(".reader-reading-scroll").waitFor();
  assert.equal(await page.locator(".reader-chapter-rail").count(), 0);
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({ name: "pagination.epub", mimeType: "application/epub+zip", buffer: fixture });
  await page.getByRole("heading", { name: "分页边界测试", exact: true }).waitFor();
  const settings = async () =>
    page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  const close = async () => page.getByRole("button", { name: "关闭阅读设置", exact: true }).click();
  await settings();
  await page.getByText("字体已就绪", { exact: false }).waitFor();
  await page.getByRole("button", { name: "分页阅读", exact: true }).click();
  await close();
  const viewport = page.locator(".reader-page-viewport");
  await page.waitForFunction(() => document.querySelectorAll(".reader-page-stops span").length > 5);
  await page.waitForTimeout(250);
  const width = await viewport.evaluate((element) => element.clientWidth);
  assert(width <= 728, "single-page measure exceeds configured line length plus margins");
  await page.getByRole("button", { name: "下一页", exact: true }).evaluate((button) => {
    button.click();
    button.click();
    button.click();
  });
  await page.waitForFunction(
    (width) => Math.abs(document.querySelector(".reader-page-viewport").scrollLeft - 3 * width) < 2,
    width,
  );
  await page.waitForTimeout(1100);
  await page.reload();
  await viewport.waitFor();
  await page.waitForFunction(
    (width) => Math.abs(document.querySelector(".reader-page-viewport").scrollLeft - 3 * width) < 2,
    width,
  );

  // Returning across a chapter boundary must land on its actual last page.
  await page.waitForFunction(
    () => document.querySelector(".reader-page-viewport").getAttribute("aria-busy") === "false",
  );
  await page.waitForTimeout(300);
  await viewport.evaluate((element) =>
    element.scrollTo({ left: element.scrollWidth, behavior: "instant" }),
  );
  await page.waitForTimeout(250);
  const last = await viewport.evaluate((element) => element.scrollLeft);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.locator(".reader-page-content h1", { hasText: "第二章" }).waitFor();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await page.locator(".reader-page-content h1", { hasText: "第一章" }).waitFor();
  await page.waitForFunction(
    (left) => Math.abs(document.querySelector(".reader-page-viewport").scrollLeft - left) < 2,
    last,
  );

  await page.setViewportSize({ width: 1920, height: 1080 });
  await settings();
  await page.getByRole("checkbox", { name: "大屏双页", exact: false }).check();
  await close();
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".reader-page-content")).columnCount === "2",
  );
  await page.waitForFunction(
    () => document.querySelector(".reader-page-viewport").getAttribute("aria-busy") === "false",
  );
  await viewport.evaluate((element) => element.scrollTo({ left: 0, behavior: "instant" }));
  await page.waitForTimeout(250);
  await page.screenshot({
    path: new URL("./shots/reader-pagination-spread.png", import.meta.url).pathname,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".reader-page-content")).columnCount === "1",
  );
  await page.waitForTimeout(300);
  assert(await viewport.evaluate((element) => element.scrollHeight <= element.clientHeight + 1));
  await viewport.evaluate((element) =>
    element.scrollTo({ left: element.scrollWidth, behavior: "instant" }),
  );
  await page.waitForTimeout(250);
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 270, y: 270 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 100, y: 270 }],
  });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.locator(".reader-page-content h1", { hasText: "第二章" }).waitFor();
  await page.screenshot({
    path: new URL("./shots/reader-pagination-mobile.png", import.meta.url).pathname,
  });
  assert.deepEqual(errors, []);
  console.log(
    "reader pagination verification PASSED: rapid turns, exact reload, chapter boundaries, responsive spreads, edge swipe",
  );
} finally {
  await browser.close();
}
