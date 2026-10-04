import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch();
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
  await page.goto(new URL("/reader", process.env.BASE_URL ?? "http://127.0.0.1:5199").href);
  await page.getByLabel("导入阅读文件", { exact: true }).setInputFiles({
    name: "pdf-experience.pdf",
    mimeType: "application/pdf",
    buffer: pdfFixture(24),
  });
  await page.locator(".reader-pdf-page").first().locator(".is-ready").waitFor();
  await page.locator(".reader-import-progress").waitFor({ state: "hidden" });
  const zoom = page.getByRole("combobox", { name: "PDF 缩放" });
  const pageInput = page.getByRole("spinbutton", { name: "PDF 页码" });
  const go = async (number) => {
    await pageInput.fill(String(number));
    await pageInput.press("Enter");
    await page.waitForFunction(
      (n) => document.querySelector('[aria-label="PDF 页码"]').value === String(n),
      number,
    );
    await page
      .locator(".reader-pdf-page")
      .nth(number - 1)
      .locator(".is-ready")
      .waitFor();
    await page.waitForTimeout(350);
  };
  await zoom.selectOption("page");
  const fit = async () => {
    await page.waitForFunction(() => {
      const canvas = document
        .querySelector(".reader-pdf-page.is-active .reader-pdf-canvas")
        .getBoundingClientRect();
      const footer = document.querySelector(".reader-mobile-nav").getBoundingClientRect();
      return canvas.width <= innerWidth && canvas.top >= 100 && canvas.bottom <= footer.top + 2;
    });
    assert.equal(await zoom.inputValue(), "page");
  };
  await fit();
  await page.setViewportSize({ width: 812, height: 375 });
  await fit();
  await page.screenshot({ path: "/tmp/bcr-reader-pdf-landscape.png" });
  await page.setViewportSize({ width: 375, height: 812 });
  await fit();
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "阅读设置", exact: true });
  assert.equal(await settings.getByRole("button", { name: "增大字号" }).count(), 0);
  assert.equal(await settings.getByRole("button", { name: "排版", exact: true }).count(), 0);
  await settings
    .getByRole("group", { name: "阅读主题", exact: true })
    .getByRole("button", { name: "夜间", exact: true })
    .click();
  await settings
    .getByRole("group", { name: "PDF 页面颜色", exact: true })
    .getByRole("button", { name: "原色", exact: true })
    .click();
  await page.getByRole("button", { name: "关闭阅读设置", exact: true }).click();
  assert.equal(
    await page
      .locator(".reader-pdf-canvas")
      .first()
      .evaluate((el) => getComputedStyle(el).filter),
    "none",
  );
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  await settings
    .getByRole("group", { name: "PDF 页面颜色", exact: true })
    .getByRole("button", { name: "夜间", exact: true })
    .click();
  await page.getByRole("button", { name: "关闭阅读设置", exact: true }).click();
  await settings.waitFor({ state: "hidden" });
  assert.match(
    await page
      .locator(".reader-pdf-canvas")
      .first()
      .evaluate((el) => getComputedStyle(el).filter),
    /invert/,
  );
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))),
  );
  await page.screenshot({ path: "/tmp/bcr-reader-pdf-night.png" });
  await zoom.selectOption("width");
  await go(1);
  const links = page.locator(".reader-pdf-page").first().locator(".reader-pdf-links a");
  await links.first().waitFor();
  assert.equal(await links.count(), 2);
  assert.equal(await links.first().getAttribute("href"), "https://example.com/reference");
  assert.equal(await links.first().getAttribute("rel"), "noopener noreferrer");
  await links.nth(1).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="PDF 页码"]').value === "4");
  await page.getByRole("button", { name: "返回原处", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="PDF 页码"]').value === "1");
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.getByRole("tab", { name: /页面/ }).click();
  const thumbs = page.locator(".reader-pdf-thumbnail-grid");
  assert.equal(await thumbs.getByRole("button").count(), 18);
  await page.getByRole("button", { name: "下一组 PDF 页面" }).click({ trial: true });
  await page.screenshot({ path: "/tmp/bcr-reader-pdf-pages.png" });
  await page.getByRole("button", { name: "下一组 PDF 页面" }).click();
  assert.equal(await thumbs.getByRole("button").count(), 6);
  await page.getByRole("textbox", { name: "PDF 页面标签或页序" }).fill("ii");
  await page
    .locator(".reader-pdf-browser")
    .getByRole("button", { name: "跳转", exact: true })
    .click();
  await page.waitForFunction(() => document.querySelector('[aria-label="PDF 页码"]').value === "2");
  await go(4);
  await zoom.selectOption("2");
  await page.waitForTimeout(700);
  const scroll = page.locator(".reader-reading-scroll");
  await scroll.evaluate((el) => {
    el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaX: 160 }));
    el.scrollTo({ left: 160, behavior: "instant" });
  });
  await page.waitForTimeout(700);
  assert.equal(await pageInput.inputValue(), "4");
  assert(Math.abs((await scroll.evaluate((el) => el.scrollLeft)) - 160) < 3);
  await page.reload();
  await page.locator(".reader-pdf-page").nth(3).locator(".is-ready").waitFor();
  await page.waitForTimeout(600);
  assert.equal(await pageInput.inputValue(), "4");
  assert.equal(await zoom.inputValue(), "2");
  assert(
    Math.abs((await scroll.evaluate((el) => el.scrollLeft)) - 160) < 3,
    "reload loses horizontal position",
  );
  await zoom.selectOption("1");
  await go(1);
  const cdp = await context.newCDPSession(page);
  const chromeBefore = await page.locator(".reader-studio").getAttribute("class");
  const touches = (distance) => [
    { x: 187 - distance / 2, y: 380, id: 0 },
    { x: 187 + distance / 2, y: 380, id: 1 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touches(80) });
  for (const distance of [100, 120, 140, 160])
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: touches(distance),
    });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(800);
  assert(
    Math.abs(Number(await zoom.inputValue()) - 2) < 0.1,
    "pinch does not change document scale",
  );
  assert.equal(
    await page.evaluate(() => visualViewport.scale),
    1,
    "pinch magnifies the entire application",
  );
  assert.equal(
    await page.locator(".reader-studio").getAttribute("class"),
    chromeBefore,
    "pinch toggles reading chrome",
  );
  for (let tap = 0; tap < 2; tap++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 187, y: 400, id: 0 }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await page.waitForFunction(() => document.querySelector('[aria-label="PDF 缩放"]').value === "1");
  assert.equal(
    await page.locator(".reader-studio").getAttribute("class"),
    chromeBefore,
    "double tap toggles reading chrome",
  );
  await zoom.selectOption("width");
  await go(1);
  await page
    .locator(".reader-pdf-page")
    .first()
    .locator(".reader-pdf-text-layer span")
    .first()
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
  await page.getByRole("button", { name: "写笔记", exact: true }).click();
  const note = page.getByRole("dialog", { name: "把这一刻留下来", exact: true });
  await note.waitFor();
  assert.match(await note.innerText(), /Readable page 1/);
  await page.getByRole("button", { name: "取消添加笔记", exact: true }).click();
  await page.getByLabel("导入阅读文件", { exact: true }).setInputFiles({
    name: "search-continuation.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      `<html><head><title>Search continuation</title></head><body>${"<p>needle reading context</p>".repeat(125)}</body></html>`,
    ),
  });
  await page.getByRole("heading", { name: "Search continuation", exact: true }).waitFor();
  await page.keyboard.press("Control+f");
  await page.getByLabel("在书库中搜索", { exact: true }).fill("needle");
  await page.waitForFunction(
    () => document.querySelectorAll(".reader-search-result").length === 80,
  );
  await page.getByRole("button", { name: "加载更多搜索结果", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".reader-search-result").length === 125,
  );
  assert.equal(
    await page.getByRole("button", { name: "加载更多搜索结果", exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PDF experience PASSED: responsive fit, colors/settings, links/history, thumbnails/page labels, pan restoration, pinch/double tap, selection notes and search continuation",
  );
} finally {
  await browser.close();
}

function pdfFixture(count) {
  const linkId = 4 + count * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 2 << /S /D /St 1 >>] >> >>",
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${count} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < count; i++) {
    const stream = `BT /F1 20 Tf 30 700 Td (Readable page ${i + 1}) Tj 0 -60 Td (Reference website) Tj 0 -50 Td (Jump to page 4) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 750] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R ${i === 0 ? `/Annots [${linkId} 0 R ${linkId + 1} 0 R]` : ""} >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.push(
    "<< /Type /Annot /Subtype /Link /Rect [30 635 220 662] /A << /S /URI /URI (https://example.com/reference) >> >>",
    "<< /Type /Annot /Subtype /Link /Rect [30 585 220 612] /Dest [10 0 R /Fit] >>",
  );
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
