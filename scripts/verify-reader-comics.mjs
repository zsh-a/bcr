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
  "chapter.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Comic chapter</title></head><body><p>A caption before the artwork.</p>${Array.from({ length: 8 }, () => '<img src="art.svg" style="display:block;width:100%;height:auto"/>').join("")}<p>A caption after the artwork.</p></body></html>`,
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
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".reader-prose img")].every(
        (img) => img.complete && img.naturalWidth > 0,
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
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "reader comics verification PASSED: EPUB image anchors, precise reload and responsive reflow on mobile/desktop",
  );
} finally {
  await browser.close();
}
