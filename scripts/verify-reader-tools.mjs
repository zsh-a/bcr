import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const base = new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString();
const directory = await mkdtemp(join(tmpdir(), "bcr-reader-backup-test-"));
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator(".reader-reading-scroll").waitFor();
  const paragraphs = Array.from(
    { length: 40 },
    (_, i) =>
      `<p>${i % 10 === 0 ? "needle " : ""}Paragraph ${i}. ${"Quiet reading with stable positions. ".repeat(12)}</p>`,
  ).join("");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "search-journey.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        `<html><head><title>Search Journey</title></head><body>${paragraphs}</body></html>`,
      ),
    });
  await page.getByRole("heading", { name: "Search Journey", exact: true }).waitFor();
  await page.waitForTimeout(1000);
  const scroll = page.locator(".reader-reading-scroll");
  await scroll.evaluate((element) => {
    element.scrollTop = 500;
  });
  await page.waitForTimeout(300);
  const before = await scroll.evaluate((element) => element.scrollTop);
  await page.keyboard.press("Control+f");
  await page.getByLabel("在书库中搜索", { exact: true }).fill("needle");
  await page.waitForFunction(() => document.querySelectorAll(".reader-search-result").length === 4);
  await page.locator(".reader-search-result").last().click();
  await page.waitForTimeout(500);
  assert(
    (await scroll.evaluate((element) => element.scrollTop)) > before + 1000,
    "last occurrence landed on first occurrence",
  );
  await page.getByRole("button", { name: "返回原处", exact: true }).click();
  await page.waitForTimeout(400);
  assert(
    Math.abs((await scroll.evaluate((element) => element.scrollTop)) - before) < 180,
    "jump history lost reading position",
  );
  await page.getByRole("button", { name: "前进到跳转位置", exact: true }).click();
  await page.waitForTimeout(400);
  assert((await scroll.evaluate((element) => element.scrollTop)) > before + 1000);

  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({ name: "selectable.pdf", mimeType: "application/pdf", buffer: pdfFixture(12) });
  await page.locator(".reader-pdf-canvas-shell.is-ready").first().waitFor();
  const first = page.locator(".reader-pdf-page").first();
  assert.match(await first.locator(".reader-pdf-text-layer").innerText(), /Readable page 1/);
  const selected = await first.locator(".reader-pdf-text-layer").evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  assert.match(selected, /Readable page 1/);
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.getByRole("spinbutton", { name: "PDF 页码" }).fill("8");
  await page.getByRole("spinbutton", { name: "PDF 页码" }).press("Enter");
  await page.waitForTimeout(500);
  await page.locator(".reader-pdf-page").nth(7).locator(".is-ready").waitFor();
  const widthBefore = await page
    .locator(".reader-pdf-page")
    .nth(7)
    .evaluate((element) => element.clientWidth);
  await page.getByRole("combobox", { name: "PDF 缩放" }).selectOption("2");
  await page.locator(".reader-pdf-page").nth(7).locator(".is-ready").waitFor();
  await page.waitForTimeout(300);
  const widthAfter = await page
    .locator(".reader-pdf-page")
    .nth(7)
    .evaluate((element) => element.clientWidth);
  assert(widthAfter > widthBefore * 1.9, "PDF zoom did not enlarge the page");
  await scroll.evaluate((element) => {
    element.scrollLeft = 120;
  });
  await page.waitForTimeout(150);
  const pannedTools = await page.locator(".reader-pdf-tools").boundingBox();
  assert(
    pannedTools && pannedTools.x >= 0 && pannedTools.x < 32,
    "horizontal pan hid PDF controls",
  );
  assert.equal(
    await page.getByRole("spinbutton", { name: "PDF 页码" }).inputValue(),
    "8",
    "zoom changed current page",
  );
  await page.getByRole("combobox", { name: "PDF 缩放" }).selectOption("1");
  await page.getByRole("spinbutton", { name: "PDF 页码" }).fill("12");
  await page.getByRole("spinbutton", { name: "PDF 页码" }).press("Enter");
  const rotated = page.locator(".reader-pdf-page").nth(11);
  await rotated.locator(".is-ready").waitFor();
  const rotationBounds = await rotated.evaluate((element) => {
    const canvas = element.querySelector("canvas").getBoundingClientRect();
    const text = element.querySelector(".reader-pdf-text-layer").getBoundingClientRect();
    return {
      dx: Math.abs(canvas.x - text.x),
      dy: Math.abs(canvas.y - text.y),
      dw: Math.abs(canvas.width - text.width),
      dh: Math.abs(canvas.height - text.height),
    };
  });
  assert(
    Object.values(rotationBounds).every((delta) => delta < 2),
    "rotated PDF text layer is misaligned",
  );
  await page.getByRole("spinbutton", { name: "PDF 页码" }).fill("6");
  await page.getByRole("spinbutton", { name: "PDF 页码" }).press("Enter");
  await page.locator(".reader-pdf-page").nth(5).locator(".is-ready").waitFor();
  await page.keyboard.press("Control+f");
  await page.getByLabel("在书库中搜索", { exact: true }).fill("Readable page 8");
  await page.waitForFunction(() => document.querySelectorAll(".reader-search-result").length === 1);
  await page.locator(".reader-search-result").click();
  await page.locator(".reader-pdf-text-layer mark.is-current").waitFor();
  assert.equal(
    await page.locator(".reader-pdf-text-layer mark.is-current").textContent(),
    "Readable page 8",
  );
  await page.locator(".reader-import-progress").waitFor({ state: "hidden" });
  await page.screenshot({ path: join(directory, "pdf-mobile.png") });
  const toolbar = await page.locator(".reader-pdf-tools").boundingBox();
  assert(
    toolbar !== null && toolbar.y >= 56 && toolbar.y < 120,
    "PDF toolbar must stay reachable below mobile chrome",
  );

  await page.getByRole("button", { name: "返回原处", exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(
    await page.getByRole("spinbutton", { name: "PDF 页码" }).inputValue(),
    "6",
    "PDF history was overridden by the old search match",
  );
  await page.getByRole("button", { name: "前进到跳转位置", exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole("spinbutton", { name: "PDF 页码" }).inputValue(), "8");
  await page.getByRole("button", { name: "打开书库", exact: true }).click();
  await page.getByRole("button", { name: "备份与恢复", exact: true }).click();
  await page.getByRole("button", { name: "生成完整备份", exact: true }).click();
  const link = page.locator(".reader-data-download");
  await link.waitFor();
  const downloadPromise = page.waitForEvent("download");
  await link.click();
  const download = await downloadPromise;
  const archive = join(directory, "backup.zip");
  await download.saveAs(archive);
  await page.getByLabel("选择 Reader 备份", { exact: true }).setInputFiles(archive);
  await page.getByRole("heading", { name: "新增 0 本 · 跳过 3 本", exact: true }).waitFor();
  await page.screenshot({ path: join(directory, "backup-mobile.png") });
  assert(await page.getByRole("button", { name: "确认合并恢复", exact: true }).isDisabled());

  const restoredContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
  });
  const restored = await restoredContext.newPage();
  restored.on("pageerror", (error) => errors.push(error.message));
  await restored.goto(base);
  await restored.locator(".reader-reading-scroll").waitFor();
  await restored.getByRole("button", { name: "打开书库", exact: true }).click();
  await restored.getByRole("button", { name: "备份与恢复", exact: true }).click();
  await restored.getByLabel("选择 Reader 备份", { exact: true }).setInputFiles(archive);
  await restored.getByRole("heading", { name: "新增 2 本 · 跳过 1 本", exact: true }).waitFor();
  await restored.getByRole("button", { name: "确认合并恢复", exact: true }).click();
  await restored
    .getByText("恢复完成，已新增 2 本读物。现有书籍未被覆盖。", { exact: true })
    .waitFor();
  await restored.getByRole("button", { name: "关闭备份与恢复", exact: true }).click();
  await restored.locator(".reader-book-card").filter({ hasText: "selectable" }).click();
  await restored.locator(".reader-pdf-canvas-shell.is-ready").first().waitFor();
  await restored.reload();
  await restored.locator(".reader-pdf-canvas-shell.is-ready").first().waitFor();
  assert.match(
    await restored
      .locator(".reader-pdf-text-layer")
      .allTextContents()
      .then((parts) => parts.join("")),
    /Readable page/,
  );
  await restored.setViewportSize({ width: 812, height: 375 });
  await restored.emulateMedia({ reducedMotion: "reduce" });
  await restored.getByRole("combobox", { name: "PDF 缩放" }).selectOption("page");
  await restored.getByRole("combobox", { name: "PDF 缩放" }).selectOption("1.5");
  await restored.waitForTimeout(1100);
  await restored.reload();
  await restored.getByRole("combobox", { name: "PDF 缩放" }).waitFor();
  assert.equal(
    await restored.getByRole("combobox", { name: "PDF 缩放" }).inputValue(),
    "1.5",
    "per-book PDF zoom did not survive reload",
  );
  assert.deepEqual(errors, []);
  console.log(
    "reader tools verification PASSED: occurrence search, return/forward, PDF text selection and zoom, verified ZIP backup, deduplication, independent restore and reload",
  );
} finally {
  await browser.close();
  if (process.env.KEEP_READER_SCREENSHOTS === "1") console.log(`Reader screenshots: ${directory}`);
  else await rm(directory, { recursive: true, force: true });
}

function pdfFixture(count) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${count} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < count; i++) {
    const stream = `BT /F1 20 Tf 30 700 Td (Readable page ${i + 1}) Tj 0 -300 Td (A second line for selection) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 750] ${i === count - 1 ? "/Rotate 90" : ""} /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
