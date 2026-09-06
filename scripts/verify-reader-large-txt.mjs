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
      if (!section || !scroll || section.getAttribute("data-reader-content-ready") !== "true")
        return false;
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
  async function assertLazyState() {
    const stats = await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => new URL(url).pathname.endsWith("/apps/reader-studio/src/store.ts"))
        .at(-1);
      const { getReaderState } = await import(url);
      const book = getReaderState().library.find((book) => book.source.name === "large-window.txt");
      const snapshot = JSON.parse(localStorage.getItem("bcr.reader.library.v1")).books.find(
        (item) => item.id === book.id,
      );
      return {
        indexed: book.sections.every((section) => section.textRange),
        loaded: book.sections.filter((section) => section.text.length > 0).length,
        snapshotText: snapshot.sections.reduce(
          (length, section) => length + section.text.length + (section.html?.length ?? 0),
          0,
        ),
      };
    });
    assert(stats.indexed, "large TXT must use a source range index");
    assert(
      stats.loaded > 0 && stats.loaded <= 128,
      "full paragraph bodies must not reside in memory",
    );
    assert.equal(
      stats.snapshotText,
      0,
      "durable snapshot must contain indexes, not duplicate prose",
    );
  }
  await assertLazyState();
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
  await page.locator(".reader-reading-scroll").hover();
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(1000);
  const scrolledIndex = await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => new URL(url).pathname.endsWith("/apps/reader-studio/src/store.ts"))
      .at(-1);
    const { getReaderState } = await import(url);
    return Number(getReaderState().activeSectionId.split("-").at(-1));
  });
  assert(
    scrolledIndex > 2501 && scrolledIndex < 2600,
    "wheel scrolling must advance through newly loaded paragraphs",
  );
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
  await assertLazyState();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "打开全局搜索" }).click();
  await page.getByRole("textbox", { name: "全局搜索", exact: true }).fill("3456");
  await page.getByRole("tab", { name: /^阅读器/u }).click();
  await page.getByRole("option").filter({ hasText: "3456" }).first().click();
  await assertVisible(3456);
  await assertLazyState();
  // Remove the explicit citation route before testing saved-position restoration.
  await page.evaluate(() => {
    history.replaceState(null, "", "/reader");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await navigate(4000, { layout: "paged" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-reader-section="section-4001"]')
        ?.getAttribute("data-reader-content-ready") === "true",
  );
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-reader-section="section-4001"]')
        ?.getAttribute("data-reader-content-ready") === "true",
  );
  await assertLazyState();
  console.log(
    "reader large TXT verification PASSED: bounded body/TOC, keyboard End, distant jumps, search, typography, reload, mobile TOC, lazy storage/cache, workspace citations and paged restore",
  );
} finally {
  await browser.close();
}
