import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString());
  await page.getByLabel("导入阅读文件").setInputFiles({
    name: "click-turn.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      Array.from(
        { length: 90 },
        (_, i) => `${i} ${"点击翻页需要响应及时，也应保留文字选择。".repeat(30)}`,
      ).join("\n\n"),
    ),
  });
  await page.getByText("导入完成", { exact: true }).waitFor();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => new URL(url).pathname.endsWith("/apps/reader-studio/src/store.ts"))
      .at(-1);
    const { reader } = await import(url);
    reader.setSettings({ layout: "paged", tocPinned: false, pageSpread: false });
  });
  const viewport = page.getByLabel("分页正文", { exact: true });
  const settled = async () => {
    await page.waitForFunction(() => {
      const viewport = document.querySelector(".reader-page-viewport");
      return viewport?.getAttribute("aria-busy") === "false" && !viewport.dataset.pageTurning;
    });
    await page.waitForTimeout(180);
  };
  await settled();
  const width = await viewport.evaluate((element) => element.clientWidth);
  const click = async (direction) => {
    const rect = await viewport.boundingBox();
    await page.mouse.click(
      rect.x + rect.width * (direction > 0 ? 0.88 : 0.12),
      rect.y + rect.height * 0.65,
    );
  };
  await viewport.evaluate((element) => {
    window.pageTurnScrollWrites = 0;
    const scrollTo = element.scrollTo.bind(element);
    element.scrollTo = (...args) => {
      window.pageTurnScrollWrites++;
      return scrollTo(...args);
    };
  });
  const typography = await viewport.evaluate((element) => {
    const content = element.querySelector(".reader-page-content");
    const paragraph = content.querySelector(".reader-prose p, p.reader-prose");
    return {
      paragraphGap: parseFloat(getComputedStyle(paragraph).marginBottom),
      topInset: parseFloat(getComputedStyle(content).marginTop),
    };
  });
  assert(typography.paragraphGap > 0, "TXT paragraphs retain the configured paragraph spacing");
  assert(typography.topInset >= 24, "desktop pages leave breathing room above the text");
  await click(1);
  await page.waitForFunction(
    () => document.querySelector(".reader-page-viewport")?.dataset.pageTurning === "true",
  );
  const intermediate = await viewport.evaluate(
    (element) =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(element.scrollLeft))),
      ),
  );
  assert(
    intermediate > 0 && intermediate < width,
    "animation must slide through intermediate positions",
  );
  await settled();
  assert(Math.abs((await viewport.evaluate((element) => element.scrollLeft)) - width) < 2);
  const scrollWrites = await page.evaluate(() => window.pageTurnScrollWrites);
  assert(
    scrollWrites <= 3,
    `a page turn must not write scroll position each frame: ${scrollWrites}`,
  );
  // A rapid reversal retargets the current motion instead of competing smooth-scroll jobs.
  await page.getByRole("button", { name: "下一页", exact: true }).evaluate((button) => {
    button.click();
    button.click();
    document.querySelector('[aria-label="上一页"]').click();
  });
  await settled();
  assert(Math.abs((await viewport.evaluate((element) => element.scrollLeft)) - 2 * width) < 2);
  await click(-1);
  await settled();
  assert(Math.abs((await viewport.evaluate((element) => element.scrollLeft)) - width) < 2);
  const rect = await viewport.boundingBox();
  // A held pointer and a dragged pointer must not be interpreted as page clicks.
  await page.mouse.move(rect.x + rect.width * 0.88, rect.y + rect.height * 0.7);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
  await settled();
  assert(Math.abs((await viewport.evaluate((element) => element.scrollLeft)) - width) < 2);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(rect.x + rect.width * 0.8, rect.y + rect.height * 0.65);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.9, rect.y + rect.height * 0.65, { steps: 5 });
  await page.mouse.up();
  await settled();
  assert(Math.abs((await viewport.evaluate((element) => element.scrollLeft)) - width) < 2);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await viewport.evaluate((element) => {
    const button = document.createElement("button");
    button.textContent = "正文内交互控件";
    button.style.cssText = `position:absolute;left:${element.scrollLeft + element.clientWidth * 0.8}px;top:20px`;
    element.append(button);
  });
  await page.getByRole("button", { name: "正文内交互控件", exact: true }).click();
  await settled();
  assert(
    Math.abs((await viewport.evaluate((element) => element.scrollLeft)) - width) < 2,
    "interactive content must not turn the page",
  );
  await page
    .getByRole("button", { name: "正文内交互控件", exact: true })
    .evaluate((element) => element.remove());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await click(1);
  assert.equal(await viewport.getAttribute("data-page-turning"), null);
  await settled();
  assert(Math.abs((await viewport.evaluate((element) => element.scrollLeft)) - 2 * width) < 2);
  await page.reload();
  await settled();
  assert(
    Math.abs((await viewport.evaluate((element) => element.scrollLeft)) - 2 * width) < 2,
    "reload retains the finished destination",
  );
  await page.setViewportSize({ width: 375, height: 900 });
  await settled();
  const before = await viewport.evaluate((element) => element.scrollLeft);
  await click(1);
  await settled();
  assert(
    (await viewport.evaluate((element) => element.scrollLeft)) > before,
    "mobile supports the same click zones",
  );
  const chooseAnimation = async (value) => {
    await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
    await page.getByLabel("翻页动画", { exact: true }).selectOption(value);
    await page.getByLabel("关闭阅读设置", { exact: true }).click();
    await settled();
  };
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await chooseAnimation("fade");
  const fadeStart = await viewport.evaluate((element) => element.scrollLeft);
  await click(1);
  await page.waitForFunction(() => {
    const element = document.querySelector(".reader-page-viewport");
    return element.dataset.pageTurning && Number(getComputedStyle(element).opacity) < 0.95;
  });
  await settled();
  assert((await viewport.evaluate((element) => element.scrollLeft)) > fadeStart);
  assert.equal(await viewport.evaluate((element) => getComputedStyle(element).opacity), "1");
  // Interrupt a live fade; cancellation must never leave invisible text or lose queued turns.
  const fadeWidth = await viewport.evaluate((element) => element.clientWidth);
  const fadeBefore = await viewport.evaluate((element) => element.scrollLeft);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForTimeout(35);
  await page.getByRole("button", { name: "下一页", exact: true }).evaluate((button) => {
    button.click();
    document.querySelector('[aria-label="上一页"]').click();
  });
  await settled();
  assert(
    Math.abs((await viewport.evaluate((element) => element.scrollLeft)) - fadeBefore - fadeWidth) <
      2,
  );
  assert.equal(await viewport.evaluate((element) => element.getAnimations().length), 0);
  await page.reload();
  await settled();
  assert(
    Math.abs((await viewport.evaluate((element) => element.scrollLeft)) - fadeBefore - fadeWidth) <
      2,
    "fade completion preserves the destination across reload",
  );
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  assert.equal(await page.getByLabel("翻页动画", { exact: true }).inputValue(), "fade");
  await page.getByLabel("关闭阅读设置", { exact: true }).click();
  await settled();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await click(-1);
  assert.equal(await viewport.getAttribute("data-page-turning"), null);
  assert.equal(await viewport.evaluate((element) => element.getAnimations().length), 0);
  await settled();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await chooseAnimation("none");
  const instantBefore = await viewport.evaluate((element) => element.scrollLeft);
  await click(1);
  assert.equal(await viewport.getAttribute("data-page-turning"), null);
  assert(
    Math.abs(
      (await viewport.evaluate((element) => element.scrollLeft)) - instantBefore - fadeWidth,
    ) < 2,
  );
  await chooseAnimation("paper");
  for (const size of [
    { width: 375, height: 900 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(size);
    await settled();
    const start = await viewport.evaluate((element) => element.scrollLeft);
    const pageWidth = await viewport.evaluate((element) => element.clientWidth);
    const sectionCount = await viewport.locator(".reader-section").count();
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.waitForFunction(() => {
      const element = document.querySelector(".reader-page-viewport");
      return (
        element.dataset.pageEffect === "paper" &&
        getComputedStyle(element).transform.startsWith("matrix3d")
      );
    });
    assert.equal(
      await viewport.locator(".reader-section").count(),
      sectionCount,
      "paper animation must not duplicate publication content",
    );
    await settled();
    assert(
      Math.abs((await viewport.evaluate((element) => element.scrollLeft)) - start - pageWidth) < 2,
    );
    assert.equal(await viewport.evaluate((element) => getComputedStyle(element).transform), "none");
    // Reverse an in-flight sheet, then return to the original page.
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.waitForTimeout(50);
    await page.getByRole("button", { name: "上一页", exact: true }).evaluate((button) => {
      button.click();
      button.click();
    });
    await settled();
    assert(Math.abs((await viewport.evaluate((element) => element.scrollLeft)) - start) < 2);
    assert.equal(await viewport.getAttribute("data-page-effect"), null);
    assert.equal(await viewport.evaluate((element) => element.getAnimations().length), 0);
    assert.equal(await viewport.evaluate((element) => element.style.transformOrigin), "");
  }
  await page.reload();
  await settled();
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  assert.equal(await page.getByLabel("翻页动画", { exact: true }).inputValue(), "paper");
  await page.getByLabel("关闭阅读设置", { exact: true }).click();
  await settled();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await click(1);
  assert.equal(await viewport.getAttribute("data-page-effect"), null);
  assert.equal(await viewport.evaluate((element) => element.getAnimations().length), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Page turn PASSED: desktop/mobile clicks, intermediate animation, rapid reversal, drag/hold protection, reduced motion, reload and persisted slide/fade/paper/none preferences",
  );
} finally {
  await browser.close();
}
