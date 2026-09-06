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
  assert.deepEqual(errors, []);
  console.log(
    "Page turn PASSED: desktop/mobile clicks, intermediate animation, rapid reversal, drag/hold protection, reduced motion and reload",
  );
} finally {
  await browser.close();
}
