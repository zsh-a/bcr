import assert from "node:assert/strict";
import { launchEphemeralBrowser, ensureShots } from "./lib/browser.mjs";
import { openActionMenu, openStudioPanel } from "./lib/app-controls.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const errors = [];
const apps = [
  ["quant?strategy=jsg", ".research-header"],
  ["quant?strategy=sma", ".ql-strategy-toolbar"],
  ["documents", ".document-header"],
  ["media", ".media-header"],
  ["data", ".data-header"],
  ["manga", ".manga-header"],
  ["reader", ".reader-toolbar"],
  ["docgen", ".docgen-header"],
  ["markets", ".ma-header"],
  ["knowledge", ".knowledge-tabs-bar"],
  ["studio", ".studio-workspace-controls"],
];
async function visit(page, route, selector) {
  await page.goto(`${origin}/${route}`, { waitUntil: "domcontentloaded" });
  await page.locator(selector).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(180);
}
async function menuFits(page, label) {
  const menu = await openActionMenu(page, label);
  await page.waitForTimeout(180);
  const bounds = await menu.boundingBox();
  const viewport = page.viewportSize();
  assert(
    bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1,
    `${label}: ${JSON.stringify(bounds)}`,
  );
  assert(
    bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1,
    `${label}: vertical overflow`,
  );
  return menu;
}
try {
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 844 },
    { width: 812, height: 375 },
  ]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width <= 390 });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [route, selector] of apps) {
      await visit(page, route, selector);
      const measurement = await page
        .locator(selector)
        .first()
        .evaluate((header) => {
          const visible = (el) =>
            el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
          const controls = [...header.querySelectorAll("button, input, select, summary")].filter(
            (el) => visible(el) && !el.disabled,
          );
          const triggers = [...document.querySelectorAll("[data-workspace-trigger]")].filter(
            visible,
          );
          return {
            width: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            header: header.getBoundingClientRect().toJSON(),
            triggers: triggers.map((el) => el.getBoundingClientRect().toJSON()),
            blocked: controls
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return [0.25, 0.5].some((fraction) => {
                  const hit = document.elementFromPoint(
                    r.x + r.width / 2,
                    r.y + r.height * fraction,
                  );
                  return !hit || !el.contains(hit);
                });
              })
              .map((el) => el.getAttribute("aria-label") || el.textContent.trim()),
          };
        });
      assert(measurement.documentWidth <= viewport.width + 1, `${route}: page overflow`);
      assert(
        measurement.header.height <= (route === "markets" ? 112 : 57),
        `${route}: header too tall`,
      );
      assert.equal(
        measurement.triggers.length,
        1,
        `${route}: navigation must have one visible entry`,
      );
      assert(
        measurement.triggers[0].width >= 44 && measurement.triggers[0].height >= 44,
        `${route}: small navigation target`,
      );
      assert.deepEqual(
        measurement.blocked,
        [],
        `${route} at ${viewport.width}: intercepted controls`,
      );
      await page.getByRole("button", { name: "展开工作区导航", exact: true }).click();
      await page.locator(".studio-topbar").waitFor();
      await page.keyboard.press("Escape");
      await page.locator(".studio-topbar").waitFor({ state: "hidden" });
      if (route === "markets") {
        const hero = await page.locator(".ma-hero-grid").boundingBox();
        assert(hero.y <= 250, `Markets: core content starts at ${hero.y}`);
      }
      if (route === "media") {
        await menuFits(page, "字幕设置");
        await page.keyboard.press("Escape");
      }
      if (route === "manga") {
        if (viewport.width <= 390) {
          const canvas = await page.locator(".manga-main").boundingBox();
          assert(
            canvas.y < 160 && canvas.width >= viewport.width - 1,
            "Manga canvas is displaced by project panels",
          );
          const project = page.locator(".manga-project-disclosure");
          assert.equal(await project.getAttribute("open"), null);
          await project.locator("summary").click();
          await page.getByRole("button", { name: /^选择第 1 页/ }).waitFor();
          await project.locator("summary").click();
        }
        await menuFits(page, "更多漫画操作");
        await page.keyboard.press("Escape");
      }
      if (route === "reader") {
        await menuFits(page, "更多阅读操作");
        await page.keyboard.press("Escape");
      }
    }
    console.log(
      `PASS: ${viewport.width}×${viewport.height} — 11 layouts, control hit targets and navigation`,
    );
    await context.close();
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.on("pageerror", (error) => errors.push(error.message));
  await visit(page, "docgen", ".docgen-header");
  await page.getByLabel("客户姓名", { exact: true }).fill("Layout Sample");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  assert(await page.locator(".docgen-main").isVisible());
  assert.equal(await page.locator(".docgen-form").isVisible(), false);
  await page.getByRole("button", { name: "填写", exact: true }).click();
  assert.equal(await page.getByLabel("客户姓名", { exact: true }).inputValue(), "Layout Sample");
  await page.getByRole("button", { name: "随机地址", exact: true }).click();
  await page.getByRole("button", { name: "生成预览", exact: true }).click();
  await page.getByAltText("账单预览").waitFor({ timeout: 60_000 });
  assert.equal(await page.locator(".docgen-form").isVisible(), false);
  await menuFits(page, "更多预览操作");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${shots}/app-layout-docgen-mobile.png` });

  await visit(page, "data", ".data-header");
  await page.locator(".data-hidden-input").setInputFiles({
    name: "layout.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,value\nalpha,1\nbeta,2\n"),
  });
  await page.locator(".data-table tbody tr").first().waitFor();
  const row = await page.locator(".data-table tbody tr").first().boundingBox();
  assert(row.y < 500, `Data: first row starts at ${row.y}`);
  assert.equal(await page.locator(".data-asset-catalog").getAttribute("open"), null);
  assert.equal(await page.locator(".data-schema-strip").getAttribute("open"), null);
  await page.screenshot({ path: `${shots}/app-layout-data-mobile.png` });
  const dataMenu = await menuFits(page, "更多数据操作");
  await dataMenu.getByRole("button", { name: "存储管理", exact: true }).click();
  await page.getByRole("dialog", { name: "存储管理", exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  await visit(page, "reader", ".reader-toolbar");
  await page.keyboard.press("Control+f");
  await page.getByLabel("在书库中搜索", { exact: true }).fill("阅读");
  await page.locator(".reader-search-result").first().waitFor();
  const searchBounds = await page.locator(".reader-search-panel").boundingBox();
  const readingToolbar = await page.locator(".reader-toolbar").boundingBox();
  assert(
    searchBounds.y >= readingToolbar.y + readingToolbar.height,
    "Reader search covers the toolbar",
  );
  await page.locator(".reader-search-result").first().click();
  await page.keyboard.press("Control+f");
  await page.getByLabel("在书库中搜索", { exact: true }).fill("阅读");
  await page.locator(".reader-search-result").first().click();
  await page.locator(".reader-search-panel").waitFor({ state: "hidden" });
  await page.screenshot({ path: `${shots}/app-layout-reader-mobile.png` });

  await page.setViewportSize({ width: 1366, height: 768 });
  await visit(page, "studio", ".studio-workspace-controls");
  assert(
    (await page.getByRole("tab", { name: "任务", exact: true }).count()) > 0,
    "Completed imports should reveal task history",
  );
  const studioPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  studioPage.on("pageerror", (error) => errors.push(error.message));
  await visit(studioPage, "studio", ".studio-workspace-controls");
  assert.equal(await studioPage.getByRole("tab", { name: "任务", exact: true }).count(), 0);
  assert.equal(await studioPage.getByRole("tab", { name: "详情", exact: true }).count(), 0);
  await studioPage.screenshot({ path: `${shots}/app-layout-studio-empty.png` });
  await openStudioPanel(studioPage, "存储");
  await studioPage.getByText("Storage Plane", { exact: true }).waitFor();
  await openStudioPanel(studioPage, "控制台");
  assert.equal(
    await studioPage.getByRole("button", { name: "展开工作区导航", exact: true }).count(),
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: DocGen view switching/generation, Data first-screen table/storage, Reader search, Studio optional panels",
  );
} finally {
  await browser.close();
}
