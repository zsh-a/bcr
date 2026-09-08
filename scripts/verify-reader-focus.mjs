import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString());
  await page.getByLabel("导入阅读文件").setInputFiles({
    name: "山间随笔.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      [
        "第一章 山间清晨",
        ...Array.from({ length: 40 }, () =>
          "清晨的光穿过树林，落在石阶上。远处传来溪水的声音，山路沿着坡地缓缓伸展。我们停下脚步，翻开手中的书，让文字与风景一起展开。".repeat(
            2,
          ),
        ),
        "第二章 灯下夜读",
        "夜色渐深，山间安静下来。",
      ].join("\n\n"),
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
    reader.setSettings({
      layout: "paged",
      tocPinned: false,
      theme: "night",
      pageSpread: true,
      fontSize: 22,
      lineHeight: 1.9,
      pageAnimation: "none",
    });
  });
  const settled = async () => {
    await page.waitForFunction(
      () => document.querySelector(".reader-txt-viewport")?.getAttribute("aria-busy") === "false",
    );
    await page.waitForTimeout(250);
  };
  const viewport = page.getByLabel("分页正文", { exact: true });
  await settled();
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 375, height: 900 },
    { width: 1920, height: 1000 },
  ]) {
    await page.setViewportSize(size);
    await settled();
    const before = await viewport.boundingBox();
    const start = await page
      .locator(".reader-txt-page")
      .first()
      .getAttribute("data-txt-page-start");
    await page.mouse.click(before.x + before.width * 0.5, before.y + before.height * 0.6);
    await page.waitForTimeout(220);
    assert.equal(await page.locator(".reader-quiet-heading").isVisible(), true);
    assert.equal(await page.locator(".reader-quiet-status").isVisible(), true);
    const titleBounds = await page.locator(".reader-quiet-heading").boundingBox();
    const textBounds = await page.locator(".reader-txt-page").first().boundingBox();
    assert(Math.abs(titleBounds.x - textBounds.x) < 1, "quiet context aligns with the text column");
    assert.equal(await page.getByRole("button", { name: "打开阅读设置", exact: true }).count(), 0);
    assert.deepEqual(
      await viewport.boundingBox(),
      before,
      "hiding controls must not change the text geometry",
    );
    assert.equal(
      await page.locator(".reader-txt-page").first().getAttribute("data-txt-page-start"),
      start,
    );
    assert(
      await viewport.evaluate((element) => document.activeElement === element),
      "focus follows the reading surface when controls hide",
    );
    await page.keyboard.press("ArrowRight");
    await settled();
    assert.notEqual(
      await page.locator(".reader-txt-page").first().getAttribute("data-txt-page-start"),
      start,
      "keyboard turns remain available in focus mode",
    );
    if (process.env.READER_FOCUS_SHOTS)
      await page.screenshot({ path: `/tmp/bcr-focus-${size.width}.png` });
    await page.getByRole("button", { name: "显示阅读工具栏", exact: true }).click();
    await page.waitForTimeout(220);
    assert.deepEqual(
      await viewport.boundingBox(),
      before,
      "restoring controls must not repaginate",
    );
    assert.equal(
      await page.getByRole("button", { name: "打开阅读设置", exact: true }).isVisible(),
      true,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "Reader focus PASSED: quiet chapter/progress/clock, accessible recovery, stable mobile and desktop geometry",
  );
} finally {
  await browser.close();
}
