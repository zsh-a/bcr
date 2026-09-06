import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
const base = new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(60_000);
  await page.goto(base);
  const text = Array.from(
    { length: 5000 },
    (_, index) => `${index} ${"大文件阅读定位验证正文。".repeat(8)}`,
  ).join("\n\n");
  await page
    .getByLabel("导入阅读文件")
    .setInputFiles({ name: "large-window.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await page.getByText("导入完成", { exact: true }).waitFor();
  async function navigate(index, settings = {}) {
    await page.evaluate(
      async ({ index, settings }) => {
        const url = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => new URL(url).pathname.endsWith("/apps/reader-studio/src/store.ts"))
          .at(-1);
        const { reader, getReaderState } = await import(url);
        const book = getReaderState().library.find(
          (book) => book.source.name === "large-window.txt",
        );
        reader.setSettings({ layout: "scroll", tocPinned: true, ...settings });
        reader.openBook(book.id, book.sections[index].id);
      },
      { index, settings },
    );
  }
  async function assertVisible(index) {
    await page.waitForFunction((id) => {
      const section = document.querySelector(`[data-reader-section="section-${id + 1}"]`);
      const scroll = document.querySelector(".reader-reading-scroll");
      if (!section || !scroll) return false;
      const rect = section.getBoundingClientRect(),
        viewport = scroll.getBoundingClientRect();
      return rect.top < viewport.bottom && rect.bottom > viewport.top;
    }, index);
    await page.waitForTimeout(1000);
    assert(
      (await page.locator("[data-reader-section]").count()) < 60,
      "body DOM must remain bounded",
    );
    assert(
      (await page.locator(".reader-chapter-rail [data-reader-toc-section]").count()) < 40,
      "TOC DOM must remain bounded",
    );
    const rect = await page.locator(`[data-reader-section="section-${index + 1}"]`).boundingBox();
    assert(
      rect && rect.y < 1000 && rect.y + rect.height > 80,
      "target remains visible after layout settles",
    );
  }
  await navigate(0);
  await assertVisible(0);
  const first = page.locator('.reader-chapter-rail [data-reader-toc-section="section-1"]');
  await first.focus();
  await page.keyboard.press("End");
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("data-reader-toc-section") === "section-5000",
  );
  await page.keyboard.press("Enter");
  await assertVisible(4999);
  await navigate(2500);
  await assertVisible(2500);
  await navigate(2500, { fontSize: 28, lineHeight: 2 });
  await assertVisible(2500);
  await page.keyboard.press("Control+f");
  await page.getByLabel("在书库中搜索", { exact: true }).fill("4321");
  await page.locator(".reader-search-result").first().click();
  await assertVisible(4321);
  await page.locator('[data-reader-section="section-4322"] mark').first().waitFor();
  await navigate(25);
  await assertVisible(25);
  await page.setViewportSize({ width: 390, height: 1000 });
  await navigate(4500);
  await assertVisible(4500);
  await navigate(50);
  await assertVisible(50);
  await page.waitForTimeout(1500);
  await page.reload();
  await assertVisible(50);
  await page.locator(".reader-mobile-nav-toc").click();
  await page.getByLabel("筛选章节", { exact: true }).fill("段落 4999");
  await page.locator('.reader-navigation-sheet [data-reader-toc-section="section-4999"]').click();
  await assertVisible(4998);
  console.log(
    "reader large TXT verification PASSED: bounded body/TOC, keyboard End, distant jumps, search, typography, reload and mobile TOC filtering",
  );
} finally {
  await browser.close();
}
