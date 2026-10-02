import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchEphemeralBrowser, collectPageErrors, ensureShots } from "./lib/browser.mjs";
import { createKnowledgeGitHub } from "./fixtures/knowledge-github.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await launchEphemeralBrowser({ headless: true });
const shots = ensureShots(),
  errors = [],
  fixture = createKnowledgeGitHub();
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=",
  "base64",
);
async function device() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-GitHub-Api-Version",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const result = await fixture.handle(
      request.url(),
      request.method(),
      request.postData() ? request.postDataJSON() : undefined,
      request.headers().accept ?? "",
    );
    await route.fulfill({
      status: result.status,
      contentType: result.raw ? "application/octet-stream" : "application/json",
      body: result.raw ?? JSON.stringify(result.json),
      headers,
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  errors.push(collectPageErrors(page));
  await page.goto(`${origin}/knowledge`);
  await page.getByRole("navigation", { name: "笔记列表", exact: true }).waitFor();
  return { context, page };
}
const body = (page) => page.getByLabel("笔记正文", { exact: true });
async function action(page, name) {
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function attach(page, name, mimeType, buffer) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "插入附件", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType, buffer });
  await page.waitForFunction(
    () => !document.querySelector('.knowledge-attachment-status:not([data-error="true"])'),
  );
  assert.equal(await page.locator('.knowledge-attachment-status[data-error="true"]').count(), 0);
}
async function connect(page) {
  await page.locator(".knowledge-status-trigger").click();
  await page.getByRole("button", { name: "同步设置…", exact: true }).click();
  await page.getByLabel("GitHub 仓库地址").fill("alice/notes");
  await page.getByLabel("GitHub Token", { exact: true }).fill("test-token");
  await page.getByRole("button", { name: "连接并同步", exact: true }).click();
  await page.getByText("已与 GitHub 同步", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭同步设置", exact: true }).click();
}
async function animations(page) {
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}
function pdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const content = "BT /F1 18 Tf 20 250 Td (Attachment PDF evidence) Tj ET";
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let data = "%PDF-1.4\n",
    offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(data.length);
    data += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = data.length;
  data +=
    `xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(data);
}
try {
  const a = await device();
  await a.page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await a.page.getByLabel("笔记标题", { exact: true }).fill("附件回归");
  await body(a.page).fill("# 附件研究\n\n正文。\n\n");
  await body(a.page).press("Control+End");
  await attach(a.page, "截图.png", "image/png", png);
  await a.page.getByRole("button", { name: "阅读", exact: true }).click();
  const image = a.page.locator(".knowledge-prose .knowledge-image-preview img");
  await image.waitFor();
  await a.page.waitForFunction(
    () =>
      document.querySelector(".knowledge-prose .knowledge-image-preview img")?.naturalWidth === 1,
  );
  await a.page.getByRole("button", { name: "查看图片：截图.png", exact: true }).click();
  await a.page.getByRole("dialog", { name: "截图.png", exact: true }).waitFor();
  await a.page.keyboard.press("Escape");
  await a.page
    .getByRole("button", { name: "查看图片：截图.png", exact: true })
    .click({ button: "right" });
  await a.page.getByRole("menu", { name: "附件操作", exact: true }).waitFor();
  await a.page.getByRole("menuitem", { name: "移除当前引用", exact: true }).click();
  await a.page.locator(".knowledge-prose .knowledge-image-preview").waitFor({ state: "hidden" });
  assert.equal(await a.page.locator(".knowledge-prose .knowledge-image-preview").count(), 0);
  await a.page.getByRole("button", { name: "编辑", exact: true }).click();
  await body(a.page).press("Control+z");
  await a.page.getByRole("button", { name: "阅读", exact: true }).click();
  await image.waitFor();
  await a.page.getByRole("button", { name: "编辑", exact: true }).click();
  await body(a.page).press("Control+End");
  await attach(
    a.page,
    "研究资料.txt",
    "text/plain",
    Buffer.from("附件原文证据\n本地保存、备份与跨设备恢复。"),
  );
  await attach(a.page, "报告.pdf", "application/pdf", pdf());
  await body(a.page).press("Control+End");
  const captured = await body(a.page).evaluate((element) => {
    const pasted = new DataTransfer();
    pasted.items.add(new File(["粘贴内容"], "粘贴.txt", { type: "text/plain" }));
    const paste = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: pasted,
    });
    element.dispatchEvent(paste);
    const dropped = new DataTransfer();
    dropped.items.add(new File(["拖放内容"], "拖放.txt", { type: "text/plain" }));
    const drop = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dropped });
    element.dispatchEvent(drop);
    return {
      paste: paste.defaultPrevented,
      drop: drop.defaultPrevented,
      files: pasted.files.length,
    };
  });
  assert.deepEqual(captured, { paste: true, drop: true, files: 1 });
  const previousUrl = a.page.url();
  await a.page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await a.page.waitForURL((url) => url.href !== previousUrl);
  await a.page.getByLabel("笔记标题", { exact: true }).fill("切换目标");
  assert(
    !(await body(a.page)
      .innerText()
      .then((text) => text.includes("attachment:"))),
    "uploads must stay in the original note",
  );
  await a.page
    .getByRole("navigation", { name: "笔记列表", exact: true })
    .getByRole("button", { name: "附件回归", exact: true })
    .click();
  await a.page.waitForFunction(
    () => document.querySelector('input[aria-label="笔记标题"]')?.value === "附件回归",
  );
  await body(a.page).press("Control+End");
  const largeImage = await a.page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e9f4f1";
    ctx.fillRect(0, 0, 2400, 720);
    ctx.strokeStyle = "#19685f";
    ctx.lineWidth = 12;
    ctx.beginPath();
    for (let x = 0; x < 2400; x += 20) ctx.lineTo(x, 540 - x / 7 + Math.sin(x / 160) * 65);
    ctx.stroke();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await attach(a.page, "趋势图.png", "image/png", Buffer.from(largeImage, "base64"));
  await a.page.getByRole("button", { name: "阅读", exact: true }).click();
  await a.page
    .getByRole("button", { name: /粘贴\.txt/u })
    .first()
    .waitFor();
  await a.page
    .getByRole("button", { name: /拖放\.txt/u })
    .first()
    .waitFor();
  await a.page.waitForFunction(
    () => document.querySelector('img[alt="趋势图.png"]')?.naturalWidth === 1440,
  );
  assert(
    (await image.first().boundingBox()).height <= 40,
    "small images must not reserve full-width space",
  );
  await a.page
    .getByRole("button", { name: /研究资料\.txt/u })
    .first()
    .click();
  let dialog = a.page.getByRole("dialog", { name: "研究资料.txt", exact: true });
  await dialog.getByRole("button", { name: "提取文本", exact: true }).click();
  await dialog.getByText("附件原文证据", { exact: false }).waitFor();
  await a.page.keyboard.press("Escape");
  await a.page
    .getByRole("button", { name: /报告\.pdf/u })
    .first()
    .click();
  dialog = a.page.getByRole("dialog", { name: "报告.pdf", exact: true });
  await dialog.getByRole("button", { name: "提取文本", exact: true }).click();
  await dialog.getByText("Attachment PDF evidence", { exact: false }).waitFor();
  await a.page.keyboard.press("Escape");
  await animations(a.page);
  const pixels = await a.page.locator('img[alt="趋势图.png"]').evaluate(async (img) => {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, 1, 1);
    return {
      pixel: [...ctx.getImageData(0, 0, 1, 1).data],
      style: {
        display: getComputedStyle(img).display,
        opacity: getComputedStyle(img).opacity,
        width: img.clientWidth,
        height: img.clientHeight,
      },
    };
  });
  assert(
    pixels.pixel[3] > 0 && pixels.style.width > 0 && pixels.style.height > 0,
    "image must paint visible pixels",
  );
  await a.page.screenshot({ path: `${shots}/knowledge-attachments-desktop.png` });
  const download = a.page.waitForEvent("download");
  await action(a.page, "导出知识库");
  const archive = await download;
  const backupPath = "/tmp/bcr-knowledge-attachments.zip";
  await archive.saveAs(backupPath);
  assert((await readFile(backupPath)).length > png.length);
  const b = await device();
  await action(b.page, "恢复 ZIP 备份");
  await b.page.getByLabel("选择知识库备份", { exact: true }).setInputFiles(backupPath);
  await b.page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await b.page
    .getByRole("navigation", { name: "笔记列表", exact: true })
    .getByRole("button", { name: "附件回归", exact: true })
    .click();
  await b.page.getByRole("button", { name: "阅读", exact: true }).click();
  await b.page.locator(".knowledge-prose .knowledge-image-preview img").first().waitFor();
  await connect(a.page);
  const c = await device();
  await connect(c.page);
  await c.page
    .getByRole("navigation", { name: "笔记列表", exact: true })
    .getByRole("button", { name: "附件回归", exact: true })
    .click();
  await c.page.getByRole("button", { name: "阅读", exact: true }).click();
  await c.page.waitForFunction(
    () => document.querySelector('img[alt="趋势图.png"]')?.naturalWidth === 1440,
  );
  await b.page.reload();
  await b.page.getByRole("button", { name: "阅读", exact: true }).click();
  await b.page.locator(".knowledge-prose .knowledge-image-preview img").first().waitFor();
  for (const width of [390, 320]) {
    await b.page.setViewportSize({ width, height: 844 });
    assert(
      await b.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `no overflow at ${width}px`,
    );
    await b.page
      .getByRole("button", { name: /报告\.pdf/u })
      .first()
      .click();
    await b.page.getByRole("dialog", { name: "报告.pdf", exact: true }).waitFor();
    await b.page.locator(".knowledge-pdf-preview img").evaluate(async (img) => {
      await img.decode();
    });
    await b.page.getByRole("button", { name: "下一页", exact: true }).waitFor();
    await animations(b.page);
    await b.page.screenshot({ path: `${shots}/knowledge-attachments-${width}.png` });
    await b.page.keyboard.press("Escape");
  }
  assert.deepEqual(errors.flat(), []);
  console.log(
    "Knowledge attachments: insertion, paste/drop, navigation isolation, Worker previews, context menu, undo, PDF/text extraction, ZIP restore, binary GitHub sync, reload and mobile layouts passed.",
  );
} finally {
  await browser.close();
}
