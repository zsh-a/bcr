import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString());
  const titles = ["第一章 初见", "第二章 风雪", "第三章 重逢", "第四章 归途"];
  const text = titles
    .map((title, chapter) =>
      [
        title,
        ...Array.from(
          { length: 90 },
          (_, paragraph) =>
            `${chapter}-${paragraph} ${"短段落应当连续排版，文字位置不随页面尺寸改变。".repeat(14)}`,
        ),
      ].join("\n\n"),
    )
    .join("\n\n");
  await page
    .getByLabel("导入阅读文件")
    .setInputFiles({ name: "txt-chapters.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await page.getByText("导入完成", { exact: true }).waitFor();
  async function state(action) {
    return page.evaluate(async (action) => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => new URL(url).pathname.endsWith("/apps/reader-studio/src/store.ts"))
        .at(-1);
      const { reader, getReaderState } = await import(url);
      const book = getReaderState().library.find((book) => book.source.name === "txt-chapters.txt");
      if (action === "paged")
        reader.setSettings({ layout: "paged", tocPinned: true, pageSpread: false });
      const viewport = document.querySelector(".reader-page-viewport");
      return {
        toc: book.toc,
        loaded: book.sections.filter((section) => section.text).length,
        locator: getReaderState().progressByBook[book.id]?.locator,
        left: viewport?.scrollLeft,
        width: viewport?.clientWidth,
      };
    }, action);
  }
  assert.deepEqual(
    (await state("paged")).toc.map((item) => item.label),
    titles,
  );
  const viewport = page.getByLabel("分页正文", { exact: true });
  async function settled() {
    await page.waitForFunction(
      () => document.querySelector(".reader-page-viewport")?.getAttribute("aria-busy") === "false",
    );
    await page.waitForTimeout(600);
  }
  await settled();
  assert((await page.locator(".reader-page-content [data-reader-section]").count()) > 1);
  assert((await page.locator(".reader-page-content [data-reader-section]").count()) <= 32);
  const visibleParagraphs = await viewport.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return [...element.querySelectorAll(".reader-prose")].filter((paragraph) =>
      [...paragraph.getClientRects()].some(
        (fragment) =>
          fragment.right > rect.left &&
          fragment.left < rect.right &&
          fragment.bottom > rect.top &&
          fragment.top < rect.bottom,
      ),
    ).length;
  });
  assert(visibleParagraphs > 1, "short paragraphs must share a page");
  await viewport.focus();
  await page.keyboard.press("Space");
  await settled();
  const turned = await state();
  assert(turned.left >= turned.width - 2, "Space must advance one page");
  await page.keyboard.press("Shift+Space");
  await settled();
  assert((await state()).left < 2);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await settled();
  const before = await state();
  await page.reload();
  await settled();
  const after = await state();
  assert.equal(
    after.locator.sectionId,
    before.locator.sectionId,
    "reload must preserve the original paragraph locator",
  );
  assert(
    Math.abs(after.left - before.left) < 2,
    `reload must restore the same page: ${JSON.stringify({ before, after })}`,
  );
  await page.locator('.reader-chapter-rail [data-reader-toc-section="section-183"]').click();
  await settled();
  assert.equal((await state()).locator.sectionId, "section-183");
  assert((await state()).loaded < 100, "distant navigation must keep the content cache bounded");
  await page.setViewportSize({ width: 375, height: 900 });
  await settled();
  const rect = await viewport.boundingBox();
  const mobileBefore = await state();
  await page.mouse.click(rect.x + rect.width * 0.88, rect.y + rect.height * 0.7);
  await settled();
  assert((await state()).left > mobileBefore.left, "right tap zone must advance");
  await page.mouse.click(rect.x + rect.width * 0.12, rect.y + rect.height * 0.7);
  await settled();
  assert(Math.abs((await state()).left - mobileBefore.left) < 2, "left tap zone must go back");
  await page.setViewportSize({ width: 900, height: 375 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await settled();
  assert.deepEqual(errors, []);
  console.log(
    "TXT pagination PASSED: chapter TOC, paragraph flow, bounded loading, keyboard/tap turns, semantic reload and responsive reflow",
  );
} finally {
  await browser.close();
}
