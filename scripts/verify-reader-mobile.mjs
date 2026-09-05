import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const base = new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString();
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator(".reader-reading-scroll").waitFor();
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  assert(
    await page.evaluate(() => !!document.activeElement.closest("dialog")),
    "opening a sheet must move focus inside",
  );
  for (let index = 0; index < 45; index++) {
    await page.keyboard.press("Tab");
    assert(
      await page.evaluate(() => !!document.activeElement.closest("dialog")),
      "focus escaped the modal",
    );
  }
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
    "打开阅读设置",
  );

  const paragraphs = Array.from(
    { length: 90 },
    (_, i) =>
      `<p id="paragraph-${i}">段落 ${i}。${"阅读应当流畅而安静，页面应跟随视口，进度应跟随文字。".repeat(8)}</p>`,
  ).join("");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "mobile-long.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        `<html><head><title>移动端长文回归</title></head><body><h1>长文</h1>${paragraphs}</body></html>`,
      ),
    });
  await page.getByRole("heading", { name: "移动端长文回归", exact: true }).waitFor();
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  await page.getByRole("button", { name: "分页阅读", exact: true }).click();
  await page.getByRole("button", { name: "关闭阅读设置", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".reader-page-stops span").length > 10,
  );
  const geometry = () =>
    page.locator(".reader-page-viewport").evaluate((e) => ({
      width: e.clientWidth,
      height: e.clientHeight,
      scrollHeight: e.scrollHeight,
      left: e.scrollLeft,
      sections: e.querySelectorAll("[data-reader-section]").length,
    }));
  let size = await geometry();
  assert.equal(size.width, 375);
  assert.equal(size.sections, 1);
  assert(size.scrollHeight <= size.height + 1, "paged view scrolls vertically");
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.waitForFunction(
      (left) => Math.abs(document.querySelector(".reader-page-viewport").scrollLeft - left) < 2,
      (i + 1) * 375,
    );
    await page.waitForTimeout(220);
  }
  const before = await geometry();
  await page.locator(".reader-page-viewport").tap({ position: { x: 180, y: 200 } });
  await page.waitForTimeout(250);
  assert.deepEqual(await geometry(), before, "hiding chrome changed the reading geometry");
  await page.getByRole("button", { name: "显示阅读工具栏", exact: true }).click();
  await page.waitForTimeout(1200);
  await page.reload();
  await page.locator(".reader-page-viewport").waitFor();
  await page.waitForFunction(
    () => document.querySelector(".reader-page-viewport").scrollLeft > 375,
  );
  size = await geometry();
  assert(Math.abs(size.left - before.left) <= 375, "page restore drifted by more than a page");
  await page.setViewportSize({ width: 812, height: 375 });
  await page.waitForTimeout(400);
  size = await geometry();
  assert(size.height >= 250, "landscape chrome consumes the viewport");
  assert(size.scrollHeight <= size.height + 1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  await page.getByRole("button", { name: "连续滚动", exact: true }).click();
  await page.getByRole("button", { name: "关闭阅读设置", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });

  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "mobile-window.pdf",
      mimeType: "application/pdf",
      buffer: pdfFixture(40),
    });
  await page.locator(".reader-pdf-canvas-shell.is-ready").first().waitFor({ timeout: 30000 });
  const allocation = () =>
    page.locator(".reader-pdf-canvas").evaluateAll((canvases) => ({
      live: canvases.filter((c) => c.width > 0).length,
      bytes: canvases.reduce((n, c) => n + c.width * c.height * 4, 0),
    }));
  for (const index of [10, 20, 30, 39]) {
    await page.locator(".reader-pdf-page").nth(index).scrollIntoViewIfNeeded();
    await page
      .locator(".reader-pdf-page")
      .nth(index)
      .locator(".is-ready")
      .waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    const usage = await allocation();
    assert(usage.live <= 8, `offscreen canvases retained: ${usage.live}`);
    assert(usage.bytes < 32 * 1024 * 1024, `canvas allocation exceeded budget: ${usage.bytes}`);
  }
  assert.equal(
    await page
      .locator(".reader-pdf-canvas")
      .first()
      .evaluate((c) => c.width),
    0,
  );
  await page.locator(".reader-pdf-page").first().scrollIntoViewIfNeeded();
  await page.locator(".reader-pdf-page").first().locator(".is-ready").waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "reader mobile verification PASSED: pagination, restore, stable chrome, modal focus, landscape, PDF eviction",
  );
} finally {
  await browser.close();
}

function pdfFixture(count) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${count} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < count; i++) {
    const stream = `BT /F1 20 Tf 30 700 Td (Mobile page ${i + 1}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 750] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
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
