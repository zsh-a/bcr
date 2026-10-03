import assert from "node:assert/strict";
import { launchEphemeralBrowser, ensureShots } from "./lib/browser.mjs";
import { openWorkspaceOptions } from "./lib/topbar.mjs";
import { verifyHomeInteractions } from "./lib/home-interactions.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const errors = [];
const primary = [
  ["markets", "Market"],
  ["quant", "Quant Lab"],
  ["reader", "Reader Studio"],
  ["knowledge", "个人知识库"],
  ["diagram", "绘图"],
  ["media", "Media Studio"],
  ["data", "Data Studio"],
];
const auxiliary = [
  ["manga", "Manga Studio", ".manga-header"],
  ["documents", "Document Studio", ".document-header"],
  ["studio", "Studio 工作台", ".studio-dock"],
  ["docgen", "DocGen Lab", ".docgen-header"],
];

async function home(page) {
  await page.keyboard.press("Alt+Digit0");
  await page.waitForURL((url) => url.pathname === "/");
  await page.locator(".home-app-card").first().waitFor();
}

async function fits(page, selector) {
  const measurements = await page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { text: element.textContent, x: rect.x, right: rect.right, height: rect.height };
    }),
  );
  for (const measurement of measurements) {
    assert(measurement.x >= 0 && measurement.right <= page.viewportSize().width + 1);
    assert(measurement.height >= 44, `${measurement.text}: touch target too small`);
  }
  assert(
    await page.locator(".studio-home").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    "home must not scroll horizontally",
  );
}

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const cards = page.locator(".home-app-card");
  await cards.first().waitFor();
  assert.deepEqual(
    await cards.evaluateAll((els) => els.map((el) => el.dataset.appId)),
    primary.map(([id]) => id),
  );
  assert.deepEqual(await page.locator(".home-section h2").allTextContents(), [
    "市场与策略",
    "阅读与创作",
    "数据与媒体",
  ]);
  assert.equal(
    await page
      .locator(".studio-home")
      .getByRole("link", { name: /AI 助手/ })
      .count(),
    0,
  );
  assert.equal(await page.locator(".home-tool-link:visible").count(), 0);
  assert((await cards.last().boundingBox()).y + (await cards.last().boundingBox()).height <= 768);
  await fits(page, ".home-app-card");
  await page.screenshot({ path: `${shots}/home-organized-desktop.png` });
  await verifyHomeInteractions(page);

  // Every displayed shortcut must navigate to the app its card advertises.
  for (let index = 0; index < primary.length; index++) {
    const [id] = primary[index];
    assert.equal(await cards.nth(index).getAttribute("aria-keyshortcuts"), `Alt+${index + 1}`);
    assert.equal(new URL(await cards.nth(index).getAttribute("href"), origin).pathname, `/${id}`);
    await page.keyboard.press(`Alt+Digit${index + 1}`);
    await page.waitForURL((url) => url.pathname === `/${id}`);
    await home(page);
  }

  // Native links support keyboard activation and ordinary browser link actions.
  await page.getByRole("link", { name: "打开 数据表格", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.locator(".data-header").waitFor();
  await home(page);

  // Collapsed tools remain discoverable, keyboard accessible and usable.
  const summary = page.locator(".home-more-tools > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await page.locator(".home-tool-link").first().waitFor();
  assert.equal(await page.locator(".home-tool-link:visible").count(), 4);
  await page.screenshot({ path: `${shots}/home-organized-tools.png` });
  await page.keyboard.press("Space");
  assert.equal(await page.locator(".home-tool-link:visible").count(), 0);

  for (const [id, , selector] of auxiliary) {
    if (!(await page.locator(".home-more-tools").evaluate((el) => el.open))) await summary.click();
    await page.locator(`.home-tool-link[data-app-id="${id}"]`).click();
    await page.waitForURL((url) => url.pathname === `/${id}`);
    await page.locator(selector).waitFor();
    await home(page);
  }

  // The command palette retains every auxiliary route without bogus number hints.
  for (const [id, title, selector] of auxiliary) {
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "命令面板", exact: true });
    await palette.waitFor();
    await palette.getByPlaceholder("输入命令…").fill(`打开 ${title}`);
    const command = palette.locator(`[data-command-id="go-${id}"]`);
    assert.equal(await command.locator("kbd").count(), 0);
    await command.click();
    await page.waitForURL((url) => url.pathname === `/${id}`);
    await page.locator(selector).waitFor();
    await home(page);
  }
  await page.keyboard.press("Control+j");
  await page.getByRole("dialog", { name: "AI 助手", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
  await page.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();

  if (await page.locator(".home-more-tools").evaluate((el) => el.open)) await summary.click();

  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspaceOptions(page);
    await page.getByRole("combobox", { name: "外观主题", exact: true }).selectOption(theme);
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [1366, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await fits(page, ".home-app-card");
      await summary.click();
      await fits(page, ".home-tool-link");
      assert.equal(await page.locator(".home-tool-link:visible").count(), 4);
      await summary.click();
      if (width === 390) {
        await page.locator(".studio-home").evaluate((el) => {
          el.scrollTop = 0;
        });
        await page.screenshot({ path: `${shots}/home-organized-mobile-${theme}.png` });
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: home grouping, shortcuts, keyboard links, auxiliary routes, command palette, themes and mobile layout",
  );
} catch (error) {
  console.error("Uncaught page errors:", errors);
  throw error;
} finally {
  await browser.close();
}
