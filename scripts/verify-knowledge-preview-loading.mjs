import assert from "node:assert/strict";
import { collectPageErrors, launchEphemeralBrowser } from "./lib/browser.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await launchEphemeralBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20_000);
const errors = collectPageErrors(page);
const body = () => page.getByLabel("笔记正文", { exact: true });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=",
  "base64",
);

try {
  await page.goto(`${origin}/knowledge`);
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  const choose = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "插入附件", exact: true }).click();
  await (await choose).setFiles({ name: "预览.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => !document.querySelector(".knowledge-attachment-status"));
  await page.getByRole("button", { name: "源码", exact: true }).click();

  const reference = await page.evaluate(async () => {
    const source = await fetch("/src/knowledge/editor/markdownEditor.ts").then((r) => r.text());
    const url = source.match(/from "([^"]*\/@codemirror_view\.js[^"]*)"/u)[1];
    const { EditorView } = await import(url);
    const editor = EditorView.findFromDOM(document.querySelector('[aria-label="笔记正文"]'));
    return editor.state.doc.toString().match(/attachment:[a-z\d-]+/u)[0];
  });
  const fixture = Array.from(
    { length: 8 },
    (_, index) =>
      `## 第 ${index + 1} 张图\n\n![预览 ${index + 1}](${reference})\n\n` +
      "图片之间的正文。\n\n".repeat(70),
  ).join("\n\n");
  await body().fill(fixture);
  await body().press("Control+Home");
  // Separate fixture setup from the save notification that publishes its body.
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const { KnowledgeAttachments } = await import("/src/knowledge/attachments/attachments.ts");
    const original = KnowledgeAttachments.prototype.preview;
    window.__previewReads = 0;
    KnowledgeAttachments.prototype.preview = function (...args) {
      window.__previewReads++;
      return original.apply(this, args);
    };
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    window.__previewUrls = new Set();
    URL.createObjectURL = function (blob) {
      const url = create(blob);
      window.__previewUrls.add(url);
      return url;
    };
    URL.revokeObjectURL = function (url) {
      window.__previewUrls.delete(url);
      return revoke(url);
    };
  });

  await page.getByRole("button", { name: "阅读", exact: true }).click();
  const images = page.locator(".knowledge-prose .knowledge-image-preview");
  await page.waitForFunction(
    () => document.querySelectorAll(".knowledge-prose .knowledge-image-preview").length === 8,
  );
  await images.first().locator("img").waitFor();
  await page.waitForTimeout(200);
  assert.equal(await images.locator("img").count(), 1, "offscreen previews have no Blob URL");
  assert.equal(await page.evaluate(() => window.__previewReads), 1, "offscreen images do no I/O");

  const firstUrl = await images.first().locator("img").getAttribute("src");
  await images.last().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const images = document.querySelectorAll(".knowledge-prose .knowledge-image-preview");
    return images[7]?.querySelector("img")?.naturalWidth === 1;
  });
  assert.equal(await images.locator("img").count(), 2, "only the visited images read storage");
  const reads = await page.evaluate(() => window.__previewReads);
  await images.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  assert.equal(await images.first().locator("img").getAttribute("src"), firstUrl);
  assert.equal(
    await page.evaluate(() => window.__previewReads),
    reads,
    "scrolling reuses previews",
  );

  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.waitForFunction(() => window.__previewUrls.size === 0);
  assert.deepEqual(errors, []);
  console.log("PASS: offscreen image I/O, nearby loading, scroll reuse and Blob URL cleanup");
} finally {
  await browser.close();
}
