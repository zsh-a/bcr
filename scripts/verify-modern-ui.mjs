import assert from "node:assert/strict";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const errors = [];
async function visit(page, route, selector) {
  await page.goto(`${origin}/${route}`, { waitUntil: "domcontentloaded" });
  await page.locator(selector).first().waitFor({ timeout: 30_000 });
}
async function modalGeometry(modal) {
  const geometry = await modal.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      drawer: element.classList.contains("ui-dialog-drawer"),
      sheet:
        innerHeight < 500 || (element.classList.contains("ui-dialog-sheet") && innerWidth <= 640),
    };
  });
  const { x, y, width, height, viewportWidth, viewportHeight, drawer, sheet } = geometry;
  const detail = JSON.stringify(geometry);
  assert(x >= -1 && y >= -1, `modal stays inside viewport: ${detail}`);
  assert(x + width <= viewportWidth + 1 && y + height <= viewportHeight + 1, detail);
  if (drawer) {
    assert(Math.abs(x + width - viewportWidth) < 2, `drawer aligns right: ${detail}`);
    assert(Math.abs(y) < 2 && Math.abs(height - viewportHeight) < 2, detail);
  } else {
    assert(
      Math.abs(x + width / 2 - viewportWidth / 2) < 2,
      `modal centers horizontally: ${detail}`,
    );
    if (sheet) {
      assert(Math.abs(y + height - viewportHeight) < 2, `sheet aligns bottom: ${detail}`);
    } else {
      assert(
        Math.abs(y + height / 2 - viewportHeight / 2) < 2,
        `modal centers vertically: ${detail}`,
      );
    }
  }
}
async function modalContract(page, triggerLabel, dialogLabel) {
  const trigger =
    typeof triggerLabel === "string"
      ? page.getByRole("button", { name: triggerLabel, exact: true })
      : triggerLabel;
  await trigger.click();
  const modal = page.getByRole("dialog", { name: dialogLabel, exact: true });
  await modal.waitFor();
  await page.waitForTimeout(200);
  await modalGeometry(modal);
  assert(await modal.evaluate((el) => el.matches(":modal")), `${dialogLabel}: native modality`);
  const controls =
    "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href]";
  await modal.evaluate((el, selector) => {
    const items = [...el.querySelectorAll(selector)].filter((item) => item.checkVisibility());
    items.at(-1).focus();
  }, controls);
  await page.keyboard.press("Tab");
  assert(
    await modal.evaluate(
      (el, selector) =>
        document.activeElement ===
        [...el.querySelectorAll(selector)].find((item) => item.checkVisibility()),
      controls,
    ),
    `${dialogLabel}: forward focus loop`,
  );
  await page.keyboard.press("Shift+Tab");
  assert(
    await modal.evaluate(
      (el, selector) =>
        document.activeElement ===
        [...el.querySelectorAll(selector)].filter((item) => item.checkVisibility()).at(-1),
      controls,
    ),
    `${dialogLabel}: backward focus loop`,
  );
  await page.locator("[data-workspace-trigger]").evaluate((el) => el.focus());
  assert(
    await modal.evaluate((el) => el.contains(document.activeElement)),
    `${dialogLabel}: inert background`,
  );
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden" });
  assert(
    await trigger.evaluate((el) => el === document.activeElement),
    `${dialogLabel}: restores trigger focus`,
  );
}
try {
  const layoutPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  layoutPage.on("pageerror", (error) => errors.push(error.message));
  await visit(layoutPage, "studio", ".studio-dock-shell");
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await layoutPage.setViewportSize(viewport);
    for (const [shortcut, name] of [
      ["Control+k", "命令面板"],
      ["Control+Shift+f", "全局搜索"],
    ]) {
      await layoutPage.keyboard.press(shortcut);
      const modal = layoutPage.getByRole("dialog", { name, exact: true });
      await modal.waitFor();
      await layoutPage.waitForTimeout(220);
      await modalGeometry(modal);
      await layoutPage.keyboard.press("Escape");
      await modal.waitFor({ state: "hidden" });
    }
    console.log(`PASS: modal placement — ${viewport.width}×${viewport.height}`);
  }
  await layoutPage.close();
  for (const width of [390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await visit(page, "studio", ".studio-dock-shell");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "导入文件", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: "modern-workspace.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A usable workspace begins with an obvious action."),
    });
    await page.getByRole("button", { name: "计算校验值", exact: true }).waitFor();
    await modalContract(page, "打开工作区面板", "工作区面板");
    await page.getByRole("button", { name: "打开工作区面板", exact: true }).click();
    const panels = page.getByRole("dialog", { name: "工作区面板", exact: true });
    assert.equal(
      await panels.getByRole("combobox", { name: "面板类型" }).locator("option").count(),
      5,
    );
    await panels.getByRole("combobox", { name: "面板类型" }).selectOption("tasks");
    await page.keyboard.press("Escape");

    await visit(page, "manga", ".manga-header");
    await modalContract(page, "工具", "翻译工具");
    await page.getByRole("button", { name: "更多漫画操作", exact: true }).click();
    await page.getByRole("button", { name: "运行详情", exact: true }).click();
    const diagnostics = page.getByRole("dialog", { name: "运行详情", exact: true });
    await diagnostics.waitFor();
    await page.waitForTimeout(220);
    await modalGeometry(diagnostics);
    await page.keyboard.press("Escape");
    await diagnostics.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "导入漫画", exact: true }).count(), 1);
    assert(!(await page.locator(".manga-footer").innerText()).includes("Worker"));
    await page.screenshot({ path: `${shots}/modern-manga-${width}.png` });

    await visit(page, "knowledge", ".knowledge-tabs-bar");
    const create = page.getByRole("button", { name: "写第一篇笔记", exact: true });
    await create.waitFor();
    assert(
      await create.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 12),
      "empty-state action keeps its label",
    );
    await create.click();
    await page.getByLabel("笔记标题", { exact: true }).waitFor();
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "同步设置", exact: true }).click();
    const sync = page.getByRole("dialog", { name: "同步设置", exact: true });
    await sync.waitFor();
    await page.waitForTimeout(220);
    await modalGeometry(sync);
    await page.keyboard.press("Escape");
    await sync.waitFor({ state: "hidden" });

    await visit(page, "data", ".data-header");
    await page.evaluate(() => {
      const stream = Reflect.get(File.prototype, "stream");
      File.prototype.stream = function () {
        if (this.name === "unreadable.csv") throw new Error("文件无法读取，请重新导入");
        return stream.call(this);
      };
    });
    await page.locator(".data-hidden-input").setInputFiles({
      name: "unreadable.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,value\nalpha,1"),
    });
    const failure = page.getByRole("alert");
    await failure.waitFor();
    assert.equal(await failure.getAttribute("data-tone"), "error");
    assert((await failure.innerText()).includes("文件无法读取"));
    await page.waitForTimeout(5200);
    assert(await failure.isVisible(), "failures stay available for action");
    await failure.getByRole("button", { name: "关闭提示" }).click();
    await page.locator(".data-hidden-input").setInputFiles({
      name: "modern.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,value\nalpha,1\nbeta,2\n"),
    });
    await page.locator(".data-table tbody tr").first().waitFor();
    await page.mouse.move(4, 4);
    const row = await page.locator(".data-table tbody tr").first().boundingBox();
    assert(row.y < 380, `core table starts at ${row.y}`);
    assert.equal(await page.locator(".data-asset-catalog").count(), 0);
    await page.screenshot({ path: `${shots}/modern-data-${width}.png` });
    await page.waitForTimeout(5400);
    assert.equal(
      await page.locator('.ui-toast[data-tone="success"]').count(),
      0,
      "success expires",
    );
    const exported = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载当前表格", exact: true }).click();
    assert((await exported).suggestedFilename().endsWith(".csv"));
    await page.getByRole("button", { name: "更多数据操作", exact: true }).click();
    await page.getByRole("button", { name: "存储管理", exact: true }).click();
    const storage = page.getByRole("dialog", { name: "存储管理", exact: true });
    await storage.waitFor();
    await page.waitForTimeout(220);
    await modalGeometry(storage);
    await page.keyboard.press("Escape");
    await storage.waitFor({ state: "hidden" });

    await visit(page, "documents", ".document-header");
    await page.getByLabel("导入文档或图片文件").setInputFiles({
      name: "modern-document.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A document should put its next useful action first."),
    });
    const read = page.getByRole("button", { name: /打开 Reader/ });
    await read.waitFor();
    assert((await read.boundingBox()).y < 450, "reading handoff appears before stages");
    assert.equal(await page.locator(".document-process-disclosure").getAttribute("open"), null);
    assert.equal(await page.locator(".document-inbox-disclosure").getAttribute("open"), null);
    await page.screenshot({ path: `${shots}/modern-documents-${width}.png` });
    await page.locator(".document-process-disclosure > summary").click();
    await modalContract(page, page.locator(".document-stage-card").first(), "处理详情");
    await page.locator(".document-process-disclosure > summary").click();

    await visit(page, "reader", ".reader-toolbar");
    await page.getByRole("button", { name: "导入读物", exact: true }).waitFor();
    await page.screenshot({ path: `${shots}/modern-reader-${width}.png` });

    await visit(page, "docgen", ".docgen-header");
    await page.getByRole("button", { name: "随机地址", exact: true }).click();
    await page.getByRole("button", { name: "生成预览", exact: true }).click();
    await page.locator(".docgen-preview-image").waitFor({ timeout: 30_000 });
    for (const [tab, extension] of [
      ["账单 PNG", ".png"],
      ["实拍 JPG", ".jpg"],
    ]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "下载", exact: true }).click();
      assert((await download).suggestedFilename().endsWith(extension));
    }
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "preview controls fit phone",
    );
    await page.screenshot({ path: `${shots}/modern-docgen-${width}.png` });
    await context.close();
    console.log(
      `PASS: ${width}px — actionable empty states, modal focus, notification severity/lifetime and direct exports`,
    );
  }
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await visit(page, "documents", ".document-header");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    const contrast = await page.locator(".document-header-button").evaluate((button) => {
      const style = getComputedStyle(button);
      const luminance = (color) =>
        color
          .match(/\d+(?:\.\d+)?/g)
          .slice(0, 3)
          .map((n) => {
            const v = Number(n) / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const fg = luminance(style.color),
        bg = luminance(style.backgroundColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    assert(contrast >= 4.5, `${theme}: primary-button contrast ${contrast}`);
  }
  assert.deepEqual(errors, [], "uncaught app errors");
  console.log("PASS: primary-button contrast in both themes");
} finally {
  await browser.close();
}
