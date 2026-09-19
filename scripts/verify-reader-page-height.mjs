import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString());
  await page.getByLabel("导入阅读文件").setInputFiles({
    name: "page-height.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      Array.from(
        { length: 90 },
        (_, i) => `${i} ${"山间的风轻轻吹过，读书的人翻开下一页。".repeat(1 + (i % 9))}`,
      ).join("\n\n"),
    ),
  });
  await page.getByText("导入完成", { exact: true }).waitFor();
  const settings = async (patch) =>
    page.evaluate(async (patch) => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => new URL(url).pathname.endsWith("/packages/reader-studio/src/store.ts"))
        .at(-1);
      const { reader } = await import(url);
      reader.setSettings(patch);
    }, patch);
  const settled = async () => {
    await page.waitForFunction(
      () => document.querySelector(".reader-page-viewport")?.getAttribute("aria-busy") === "false",
    );
    await page.waitForTimeout(300);
  };
  await settings({ layout: "paged", tocPinned: false, pageSpread: false, pageAnimation: "none" });
  const measure = () =>
    page.evaluate(() => {
      const viewport = document.querySelector(".reader-page-viewport");
      const content = viewport.querySelector(".reader-page-content");
      const bounds = content.getBoundingClientRect();
      const prose = content.querySelector(".reader-prose");
      const pages = [...content.querySelectorAll(".reader-txt-page")];
      const columns = pages.length;
      const bottoms = [];
      const tops = [];
      // Measure actual visible glyphs rather than source paragraph boxes.
      for (const [column, physicalPage] of pages.entries()) {
        const pageBounds = physicalPage.getBoundingClientRect();
        for (const paragraph of physicalPage.querySelectorAll(".reader-prose")) {
          const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
              if (!rect.width || !rect.height) continue;
              bottoms[column] = Math.max(bottoms[column] ?? 0, rect.bottom - pageBounds.top);
              tops[column] = Math.min(tops[column] ?? Infinity, rect.top - pageBounds.top);
            }
          }
        }
      }
      return {
        height: bounds.height,
        columns,
        bottoms,
        tops,
        lineHeight: parseFloat(getComputedStyle(prose).lineHeight),
        sections: content.querySelectorAll(".reader-section").length,
      };
    });
  const results = [];
  for (const scenario of [
    { width: 375, height: 900, fontSize: 20, lineHeight: 1.7 },
    { width: 1440, height: 1000, fontSize: 20, lineHeight: 1.7 },
    { width: 1920, height: 1000, fontSize: 20, lineHeight: 1.7 },
    { width: 900, height: 430, fontSize: 21, lineHeight: 1.75 },
  ]) {
    await page.setViewportSize(scenario);
    await settings({
      fontSize: scenario.fontSize,
      lineHeight: scenario.lineHeight,
      pageSpread: true,
    });
    await settled();
    const result = await measure();
    const ordinary = [...result.bottoms];
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await settled();
      ordinary.push(...(await measure()).bottoms);
    }
    assert(ordinary.length > 1, "fixture must include multiple complete pages");
    const spread = Math.max(...ordinary) - Math.min(...ordinary);
    assert(spread < 1, `ordinary pages must share their final baseline: ${JSON.stringify(result)}`);
    assert(
      result.bottoms.every((bottom) => bottom <= result.height + 1),
      "no clipped final line",
    );
    assert(
      result.tops.every((top) => top >= -1),
      "no clipped first line",
    );
    assert(result.sections <= 32, "height consistency must not require loading the full book");
    if (scenario.width === 1920) assert.equal(result.columns, 2);
    results.push({ width: scenario.width, baselineSpread: spread });
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  await page.locator("details.reader-advanced-typography").locator("summary").first().click();
  await page.getByLabel("TXT 分页段落", { exact: true }).selectOption("spaced");
  await page.getByLabel("关闭阅读设置", { exact: true }).click();
  await settled();
  assert(
    await page
      .locator(".reader-txt-page .reader-section")
      .evaluateAll((sections) =>
        sections.some((section) => parseFloat(getComputedStyle(section).paddingTop) > 0),
      ),
  );
  await page.reload();
  await settled();
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  await page.locator("details.reader-advanced-typography").locator("summary").first().click();
  assert.equal(await page.getByLabel("TXT 分页段落", { exact: true }).inputValue(), "spaced");
  assert.deepEqual(errors, []);
  console.log(
    "TXT page height PASSED: consistent text baselines, complete lines, mobile/desktop/spread/landscape, bounded content and persisted paragraph preference",
    results,
  );
} finally {
  await browser.close();
}
