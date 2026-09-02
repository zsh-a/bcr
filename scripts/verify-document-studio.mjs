/* Document Studio：导入 → 阶段边界 → 本地状态 → Reader handoff。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

const base = new URL(process.env.BASE_URL ?? "http://localhost:5199/studio");
base.pathname = "/documents";
base.search = "";
const dir = new URL("./shots/", import.meta.url).pathname;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const browser = await launchVerifyBrowser("studio");
const page = browser.pages()[0] ?? (await browser.newPage());
page.on("pageerror", (error) => fail(`pageerror: ${error.message}`));

await page.goto(base.toString(), { waitUntil: "domcontentloaded" });
await page.locator(".document-studio").waitFor({ timeout: 20_000 });
await page.locator(".document-stage-card").first().waitFor({ timeout: 20_000 });

const initialText = await page.locator("body").innerText();
if (!initialText.includes("Document Studio") || !initialText.includes("LOCAL-FIRST")) {
  fail("Document Studio 主界面未渲染");
}
if ((await page.locator(".document-stage-card").count()) !== 7) fail("文档阶段数量不完整");
if ((await page.locator(".document-job-card").count()) < 1) fail("文档队列未加载");
if ((await page.locator(".document-stage-card.is-done").count()) < 2) {
  fail("Ingest / Normalize 就绪状态未建立");
}
if ((await page.locator(".document-stage-card.is-blocked").count()) < 3) {
  fail("尚未接入的 OCR / 翻译阶段没有显式阻塞");
}

const input = page.locator(".document-visually-hidden");
await input.setInputFiles({
  name: "field-notes.md",
  mimeType: "text/markdown",
  buffer: Buffer.from(
    "# Field notes\n\nA local-first document pipeline keeps artifacts inspectable.",
  ),
});
await page
  .locator(".document-job-copy strong", { hasText: "field-notes.md" })
  .last()
  .waitFor({ timeout: 10_000 });
if (!(await page.locator(".document-preview-card").innerText()).includes("Field notes")) {
  fail("导入后的源文本预览未更新");
}

await page.getByRole("button", { name: /OCR/ }).click();
if (!(await page.locator(".document-stage-inspector").innerText()).includes("等待能力接入")) {
  fail("规划阶段 Inspector 没有说明阻塞原因");
}

await page.screenshot({ path: `${dir}/document-studio.png`, fullPage: true });
await page.getByRole("button", { name: /打开 Reader/ }).click();
await page.locator(".reader-studio").waitFor({ timeout: 20_000 });
if (!new URL(page.url()).pathname.endsWith("/reader")) fail("Reader handoff 没有更新路由");
await page
  .locator(".reader-book-card", { hasText: "Field notes" })
  .first()
  .waitFor({ timeout: 20_000 });

// The same artifact boundary also feeds a page-image handoff into Manga.
await page.goto(base.toString(), { waitUntil: "domcontentloaded" });
await page.locator(".document-studio").waitFor({ timeout: 20_000 });
await page.locator(".document-visually-hidden").setInputFiles({
  name: "page.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
});
await page
  .locator(".document-job-card", { hasText: "page.png" })
  .last()
  .waitFor({ timeout: 10_000 });
await page.getByRole("button", { name: /打开 Manga/ }).click();
await page.locator(".manga-studio").waitFor({ timeout: 20_000 });
await page
  .locator(".manga-page-card", { hasText: "page.png" })
  .first()
  .waitFor({ timeout: 20_000 });

await browser.close();
console.log(
  process.exitCode ? "document studio verification FAILED" : "document studio verification PASSED",
);
