import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(new URL("../apps/reader-studio/package.json", import.meta.url));
const { BlobWriter, TextReader, ZipWriter } = require("@zip.js/zip.js");
const writer = new ZipWriter(new BlobWriter("application/epub+zip"));
const entries = {
  mimetype: "application/epub+zip",
  "META-INF/container.xml":
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  "book.opf":
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Comic precision</dc:title><dc:identifier>comic-precision</dc:identifier></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="art" href="art.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
  "art.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1800"><rect width="600" height="1800" fill="#b6c6d6"/><path d="M0 900H600" stroke="black"/></svg>',
  "chapter.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Comic chapter</title><link rel="stylesheet" href="art.css"/></head><body><p>A caption before the artwork.</p>${Array.from({ length: 7 }, () => '<img class="art" src="art.svg"/>').join("")}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 1800"><image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="art.svg" width="600" height="1800"/></svg><p>A caption after the artwork.</p></body></html>`,
  "art.css":
    ".art { display:block; width:100%; height:auto; } body { background-image: url(https://invalid.example/blocked.png); }",
};
for (const [name, contents] of Object.entries(entries))
  await writer.add(name, new TextReader(contents));
const epub = Buffer.from(await (await writer.close()).arrayBuffer());
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString());
    await page.locator(".reader-reading-scroll").waitFor();
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "comic.epub", mimeType: "application/epub+zip", buffer: epub });
    const images = page.locator(".reader-prose img");
    await images.nth(7).waitFor();
    assert.equal(
      new Set(
        await images.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("src")),
        ),
      ).size,
      1,
      "duplicate archive images were decoded repeatedly",
    );
    assert.match(await images.first().getAttribute("style"), /width: 100%/);
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".reader-prose img")].every(
        (img) => Number(img.getAttribute("width")) > 0,
      ),
    );
    await page.waitForTimeout(2000);
    const scroll = page.locator(".reader-reading-scroll");
    await scroll.evaluate((container) => {
      const rect = container.querySelectorAll(".reader-prose img")[4].getBoundingClientRect();
      container.scrollTo({
        behavior: "instant",
        top:
          container.scrollTop +
          rect.top -
          container.getBoundingClientRect().top +
          rect.height * 0.371 -
          Math.min(140, container.clientHeight * 0.32),
      });
    });
    await page.waitForTimeout(600);
    // Capture through the same lifecycle event used before reload/navigation.
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForTimeout(500);
    const saved = await page.evaluate(() => {
      const session = JSON.parse(localStorage.getItem("bcr.reader.session.v1"));
      return session.progressByBook[session.activeBookId].locator;
    });
    assert.equal(
      saved.imageAnchor?.index,
      4,
      `image probe was replaced by a nearby caption: ${JSON.stringify(saved)} ${JSON.stringify(
        await scroll.evaluate((container) => {
          const rect = container.getBoundingClientRect();
          return {
            top: container.scrollTop,
            hit: document
              .elementFromPoint(
                rect.left + rect.width * 0.5,
                rect.top + Math.min(140, container.clientHeight * 0.32),
              )
              ?.outerHTML.slice(0, 500),
          };
        }),
      )}`,
    );
    assert(Math.abs(saved.imageAnchor.y - 0.371) < 0.002, JSON.stringify(saved));
    assert.equal(saved.textAnchor, undefined);
    const original = await scroll.evaluate((container) => container.scrollTop);
    await page.reload();
    await images.nth(7).waitFor();
    await page.waitForTimeout(2500);
    assert(
      Math.abs((await scroll.evaluate((container) => container.scrollTop)) - original) < 3,
      "reload changed the comic position",
    );
    // Reflow must retain a point within the image, not the old chapter height.
    await page.setViewportSize({ width: width === 375 ? 600 : 1100, height: 900 });
    await page.waitForTimeout(2000);
    const delta = await scroll.evaluate((container) => {
      const rect = container.querySelectorAll(".reader-prose img")[4].getBoundingClientRect();
      return (
        rect.top +
        rect.height * 0.371 -
        container.getBoundingClientRect().top -
        Math.min(140, container.clientHeight * 0.32)
      );
    });
    assert(Math.abs(delta) < 3, `image-relative reflow drift: ${delta}px`);
    // Simulate a late intrinsic-size resolution above the saved destination.
    await images.first().evaluate((image) => {
      image.style.height = `${image.getBoundingClientRect().height + 700}px`;
      image.dispatchEvent(new Event("load"));
    });
    await page.waitForTimeout(2000);
    const loadDelta = await scroll.evaluate((container) => {
      const rect = container.querySelectorAll(".reader-prose img")[4].getBoundingClientRect();
      return (
        rect.top +
        rect.height * 0.371 -
        container.getBoundingClientRect().top -
        Math.min(140, container.clientHeight * 0.32)
      );
    });
    assert(Math.abs(loadDelta) < 3, `late image load drift: ${loadDelta}px`);
    await page.getByRole("button", { name: "切换漫画模式", exact: true }).click();
    await page.locator(".reader-comic-viewport img").waitFor();
    assert.equal(await page.locator(".reader-comic-viewport img").count(), 1);
    await page.getByLabel("漫画阅读方向", { exact: true }).selectOption("rtl");
    await page.getByLabel("漫画画面适配", { exact: true }).selectOption("width");
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    assert.match(await page.locator(".reader-comic-viewport img").getAttribute("alt"), /第 6 页/);
    await page.getByRole("button", { name: "放大漫画", exact: true }).click();
    assert.equal(await page.getByLabel("漫画缩放比例", { exact: true }).textContent(), "150%");
    await page.waitForTimeout(1100);
    await page.reload();
    await page.locator(".reader-comic-viewport img").waitFor();
    assert.match(await page.locator(".reader-comic-viewport img").getAttribute("alt"), /第 6 页/);
    assert.equal(await page.getByLabel("漫画阅读方向", { exact: true }).inputValue(), "rtl");
    assert.equal(await page.getByLabel("漫画画面适配", { exact: true }).inputValue(), "width");
    await page.getByRole("button", { name: "6 / 8 页", exact: true }).click();
    await page.getByRole("button", { name: "前往漫画第 2 页", exact: true }).click();
    assert.match(await page.locator(".reader-comic-viewport img").getAttribute("alt"), /第 2 页/);
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `/tmp/reader-comic-${width}.png` });
    assert.deepEqual(errors, []);
    await context.close();
  }
  const fixedWriter = new ZipWriter(new BlobWriter("application/epub+zip"));
  for (const [name, value] of Object.entries(entries))
    await fixedWriter.add(
      name,
      new TextReader(
        name === "book.opf"
          ? value
              .replace(
                "</metadata>",
                '<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">both</meta></metadata>',
              )
              .replace("<spine>", '<spine page-progression-direction="rtl">')
          : value,
      ),
    );
  const fixed = Buffer.from(await (await fixedWriter.close()).arrayBuffer());
  const fixedContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const fixedPage = await fixedContext.newPage();
  await fixedPage.goto(
    new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString(),
  );
  await fixedPage.locator(".reader-reading-scroll").waitFor();
  await fixedPage
    .locator("input[type=file]")
    .first()
    .setInputFiles({ name: "fixed-comic.epub", mimeType: "application/epub+zip", buffer: fixed });
  await fixedPage.locator(".reader-comic-viewport img").first().waitFor();
  assert.equal(await fixedPage.getByLabel("漫画阅读方向", { exact: true }).inputValue(), "rtl");
  assert.equal(
    await fixedPage.locator(".reader-comic-viewport img").count(),
    2,
    "fixed-layout spread metadata was ignored",
  );
  await fixedContext.close();
  console.log(
    "reader comics verification PASSED: EPUB image anchors, precise reload and responsive reflow on mobile/desktop",
  );
} finally {
  await browser.close();
}
