import assert from "node:assert/strict";
import { chromium } from "playwright";
import { ensureShots } from "./lib/browser.mjs";

const browser = await chromium.launch({ headless: true });
const shots = ensureShots();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  reducedMotion: "reduce",
});
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const button = (name) => page.getByRole("button", { name, exact: true });
const footer = page.locator(".reader-mobile-nav");
const progress = () => page.getByRole("dialog", { name: "阅读进度", exact: true });
const slider = () => page.getByRole("slider", { name: "调整进度", exact: true });
const readingPosition = () => page.locator(".reader-reading-scroll").evaluate((el) => el.scrollTop);
async function footerFits(height) {
  const box = await footer.boundingBox();
  assert.equal(box.height, height, "footer changed height between navigation states");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  for (const control of await footer.locator("button:visible").all()) {
    const target = await control.boundingBox();
    assert(target.width >= 44 && target.height >= 44, "footer touch target is too small");
    assert(target.x >= 0 && target.x + target.width <= page.viewportSize().width + 1);
  }
}
try {
  await page.goto(new URL("/reader", process.env.BASE_URL ?? "http://127.0.0.1:5199").href);
  await page.locator(".reader-reading-scroll").waitFor();
  const paragraphs = Array.from(
    { length: 48 },
    (_, index) =>
      `<p>${index % 12 === 0 ? "航标。" : ""}第 ${index} 段。${"在书页间停留，让阅读保持安静与流畅。".repeat(12)}</p>`,
  ).join("");
  await page.getByLabel("导入阅读文件", { exact: true }).setInputFiles({
    name: "footer-review.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      `<html><head><title>沿着海岸阅读：一段很长的章节名称</title></head><body><h1>海岸</h1>${paragraphs}</body></html>`,
    ),
  });
  await page
    .getByRole("heading", { name: "沿着海岸阅读：一段很长的章节名称", exact: true })
    .waitFor();

  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await footerFits(60);
    await button("调整阅读进度").click();
    const sheet = progress();
    assert(await sheet.evaluate((el) => el.matches(":modal")));
    await slider().click({ trial: true });
    const range = await slider().boundingBox();
    assert(
      range.width >= Math.min(viewport.width - 48, 512),
      `progress slider is constrained by the footer button: ${JSON.stringify({ viewport, range })}`,
    );
    assert(range.y >= 0 && range.y + range.height <= viewport.height);
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press("Tab");
      assert(
        await sheet.evaluate((el) => el.contains(document.activeElement)),
        "focus escaped progress sheet",
      );
    }
    await button("查看跳转历史").click();
    const history = page.getByRole("dialog", { name: "跳转历史", exact: true });
    await button("返回进度调整").waitFor();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "返回进度调整",
    );
    assert(await history.evaluate((el) => el.contains(document.activeElement)));
    await button("返回进度调整").click();
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden" });
    assert(await button("调整阅读进度").evaluate((el) => el === document.activeElement));
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await button("调整阅读进度").click();
  const beforeSeek = await readingPosition();
  const initialRange = await slider().boundingBox();
  await page.mouse.move(initialRange.x + 12, initialRange.y + 22);
  await page.mouse.down();
  await page.mouse.move(initialRange.x + initialRange.width * 0.65, initialRange.y + 22, {
    steps: 8,
  });
  const draggingRange = await slider().boundingBox();
  assert.equal(draggingRange.y, initialRange.y, "preview moved the slider under the finger");
  assert.equal(await readingPosition(), beforeSeek, "dragging navigated before release");
  await page.mouse.up();
  await page.waitForFunction(
    (before) => document.querySelector(".reader-reading-scroll").scrollTop > before + 1000,
    beforeSeek,
  );
  await progress().getByRole("button", { name: "返回原处", exact: true }).click();
  await page.waitForFunction(
    (before) => Math.abs(document.querySelector(".reader-reading-scroll").scrollTop - before) < 180,
    beforeSeek,
  );
  await button("调整阅读进度").click();
  await button("查看跳转历史").click();
  await button("前进到跳转位置").click();
  await page.waitForFunction(
    (before) => document.querySelector(".reader-reading-scroll").scrollTop > before + 1000,
    beforeSeek,
  );

  await button("在当前读物中搜索").click();
  const search = page.getByRole("dialog", { name: "搜索原文", exact: true });
  await search.getByRole("combobox").fill("航标");
  await search.getByRole("option").last().click();
  await search.waitFor({ state: "hidden" });
  await page.locator(".reader-search-count").filter({ hasText: "4 / 4" }).waitFor();
  await button("下一个命中").click();
  await page.locator(".reader-search-count").filter({ hasText: "1 / 4" }).waitFor();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await footerFits(60);
    assert.equal(await footer.getByRole("button", { name: "下一章", exact: true }).count(), 0);
    const count = page.locator(".reader-search-count");
    assert(
      await count.evaluate((el) => el.scrollWidth <= el.clientWidth),
      "search counter wraps or overflows",
    );
    await page.screenshot({ path: `${shots}/reader-footer-search-${width}.png` });
  }
  await page.waitForTimeout(250);
  const searchedPosition = await readingPosition();
  await button("退出搜索导航").click();
  await button("调整阅读进度").waitFor();
  await page.waitForTimeout(150);
  assert(
    Math.abs((await readingPosition()) - searchedPosition) < 2,
    "exiting search moved the reading position",
  );
  await footerFits(60);

  await button("打开阅读设置").click();
  await button("分页阅读").click();
  await button("夜间").click();
  await button("关闭阅读设置").click();
  const paged = page.locator(".reader-page-viewport");
  await paged.waitFor();
  const geometry = () =>
    paged.evaluate((el) => ({
      width: el.clientWidth,
      height: el.clientHeight,
      left: el.scrollLeft,
    }));
  await page.waitForTimeout(350);
  const before = await geometry();
  await button("调整阅读进度").click();
  await page.screenshot({ path: `${shots}/reader-footer-progress-night.png` });
  const themed = await footer.evaluate((el) => ({
    expected: getComputedStyle(el).getPropertyValue("--read-raised").trim(),
    actual: getComputedStyle(el).backgroundColor,
  }));
  assert.equal(themed.expected, "#1b2421");
  assert.equal(themed.actual, "rgb(27, 36, 33)");
  await page.keyboard.press("Escape");
  await progress().waitFor({ state: "hidden" });
  assert.deepEqual(await geometry(), before, "progress sheet changed pagination");
  await paged.tap({ position: { x: 180, y: 220 } });
  await footer.waitFor({ state: "hidden" });
  assert.deepEqual(await geometry(), before, "hiding footer changed pagination");
  await button("显示阅读工具栏").click();
  await button("调整阅读进度").click({ trial: true });
  assert.deepEqual(await geometry(), before);
  await page.screenshot({ path: `${shots}/reader-footer-night.png` });
  assert.deepEqual(errors, []);
  console.log(
    "Reader mobile footer PASSED: stable height, touch targets, modal focus, wide slider, seek undo/redo, search exit, night theme and pagination",
  );
} catch (error) {
  await page.screenshot({ path: `${shots}/reader-footer-failure.png` });
  throw error;
} finally {
  await browser.close();
}
