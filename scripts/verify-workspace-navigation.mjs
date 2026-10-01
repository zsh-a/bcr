import assert from "node:assert/strict";
import { launchEphemeralBrowser, ensureShots } from "./lib/browser.mjs";
import { openTopBar, openWorkspaceOptions } from "./lib/topbar.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const surface = () => page.locator(".studio-navigation-surface");
const entrance = () => page.getByRole("button", { name: "展开工作区导航", exact: true });
const hidden = () => surface().waitFor({ state: "hidden" });
const focused = (name) =>
  page.waitForFunction(
    (label) => document.activeElement?.getAttribute("aria-label") === label,
    name,
  );
const geometry = () => page.locator(".research-header").boundingBox();
const close = async () => {
  await page.getByRole("button", { name: "收起工作区导航", exact: true }).click();
  await hidden();
};
const command = async (name) => {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "命令面板", exact: true });
  await dialog.getByPlaceholder("输入命令…").fill(name);
  await dialog.getByRole("button", { name: new RegExp(`^打开 ${name}(?:\\s|$)`) }).click();
};
try {
  await page.goto(origin, { waitUntil: "networkidle" });
  assert(await page.locator(".studio-topbar").isVisible());
  assert.equal(await entrance().count(), 0);
  await page.goto(`${origin}/quant?strategy=jsg`, { waitUntil: "networkidle" });
  await page.locator(".research-header").waitFor();
  await entrance().waitFor();
  assert.equal(await page.locator(".studio-topbar").isVisible(), false);
  const before = await geometry();
  assert.equal(before.y, 0);
  assert.equal(await page.getByRole("button", { name: "打开全局搜索", exact: true }).count(), 0);
  await page.screenshot({ path: `${shots}/workspace-navigation-hidden.png` });

  // Hover reveals without stealing app focus; leaving releases all vertical space.
  const run = page.getByRole("button", { name: "运行回测", exact: true });
  await page.waitForFunction(() => !document.querySelector(".research-run-button")?.disabled);
  await run.focus();
  await entrance().hover();
  await surface().waitFor();
  assert(await run.evaluate((el) => el === document.activeElement));
  assert.deepEqual(await geometry(), before);
  await page.screenshot({ path: `${shots}/workspace-navigation-open.png` });
  await page.mouse.move(400, 500);
  await hidden();

  // Keyboard entry, focus recovery and the shortcut have the same behavior.
  await entrance().focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "返回工作区主页", exact: true }).waitFor();
  await focused("返回工作区主页");
  await page.keyboard.press("Escape");
  await hidden();
  await focused("展开工作区导航");
  await page.keyboard.press("Alt+Backquote");
  await surface().waitFor();
  await page.keyboard.press("Alt+Backquote");
  await hidden();
  await page.keyboard.press("Control+Shift+f");
  await page.getByRole("dialog", { name: "全局搜索", exact: true }).waitFor();
  assert.equal(await surface().isVisible(), false);
  await page.keyboard.press("Escape");
  assert.deepEqual(await geometry(), before);

  // Native nested menus stay open, and Escape closes one surface at a time.
  const options = await openWorkspaceOptions(page);
  await options.getByRole("button", { name: "自定义背景", exact: true }).click();
  const background = page.getByRole("dialog", { name: "背景设置", exact: true });
  await background.waitFor();
  await page.mouse.move(400, 500);
  await page.waitForTimeout(800);
  assert(await surface().isVisible());
  await page.keyboard.press("Escape");
  await background.waitFor({ state: "hidden" });
  assert(await options.isVisible());
  assert(await surface().isVisible());
  await page.keyboard.press("Escape");
  await options.waitFor({ state: "hidden" });
  assert(await surface().isVisible());
  await page.keyboard.press("Escape");
  await hidden();

  await openTopBar(page);
  await page.getByRole("button", { name: "打开全局搜索", exact: true }).click();
  await page.getByRole("dialog", { name: "全局搜索", exact: true }).waitFor();
  await page.mouse.move(400, 500);
  await page.waitForTimeout(800);
  assert(await surface().isVisible());
  await page.keyboard.press("Escape");
  assert(
    await page
      .getByRole("button", { name: "打开全局搜索", exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await close();

  // A completed app session survives navigation; the shell never remounts the app.
  await run.click();
  await page.locator(".research-run-result").waitFor();
  const runId = await page.locator(".research-run-result").getAttribute("data-run-id");
  await command("Media Studio");
  await page.locator(".media-header").waitFor();
  assert.equal((await page.locator(".media-header").boundingBox()).y, 0);
  assert.equal(await surface().isVisible(), false);
  await command("Quant Lab");
  await page.locator(".research-header").waitFor();
  assert.equal(await page.locator(".research-run-result").getAttribute("data-run-id"), runId);

  for (const [route, selector] of [
    ["/documents", ".document-header"],
    ["/data", ".data-header"],
    ["/manga", ".manga-header"],
    ["/reader", ".reader-toolbar"],
    ["/docgen", ".docgen-header"],
    ["/markets", ".ma-header"],
    ["/knowledge", ".knowledge-app"],
    ["/studio", ".studio-dock"],
  ]) {
    await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
    const app = page.locator(selector);
    await app.waitFor({ timeout: 30_000 });
    assert.equal((await app.boundingBox()).y, 0, route);
    assert.equal(await surface().isVisible(), false, route);
    await openTopBar(page);
    assert.equal((await app.boundingBox()).y, 0, route);
    await close();
  }

  await page.goto(`${origin}/reader`, { waitUntil: "networkidle" });
  await page.locator(".reader-main").waitFor();
  const reading = await page.locator(".reader-main").boundingBox();
  await openTopBar(page);
  assert.deepEqual(await page.locator(".reader-main").boundingBox(), reading);
  await close();
  assert.deepEqual(await page.locator(".reader-main").boundingBox(), reading);
  await page.goto(`${origin}/quant?strategy=jsg`, { waitUntil: "networkidle" });
  await page.locator(".research-header").waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"]) {
    await openWorkspaceOptions(page);
    await page.getByRole("combobox", { name: "外观主题", exact: true }).selectOption(theme);
    await page.keyboard.press("Escape");
    await close();
    for (const [width, height] of [
      [768, 844],
      [390, 844],
      [320, 256],
      [812, 375],
    ]) {
      await page.setViewportSize({ width, height });
      await page.mouse.move(20, height - 20);
      const appBounds = await geometry();
      await openTopBar(page);
      assert.deepEqual(await geometry(), appBounds);
      assert(
        await page.locator(".studio-topbar").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${shots}/workspace-navigation-${theme}-${width}.png` });
      await close();
    }
  }
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await touch.newPage();
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto(`${origin}/quant?strategy=jsg`, { waitUntil: "networkidle" });
  const mobileEntrance = mobile.getByRole("button", { name: "展开工作区导航", exact: true });
  await mobileEntrance.waitFor();
  assert((await mobileEntrance.boundingBox()).height >= 44);
  await mobileEntrance.tap();
  await mobile.getByRole("button", { name: "打开全局搜索", exact: true }).waitFor();
  await mobile.getByRole("button", { name: "收起工作区导航", exact: true }).tap();
  await mobileEntrance.waitFor();
  await touch.close();
  assert.deepEqual(errors, []);
  console.log(
    "Workspace navigation PASSED: all app viewports, hover, touch, keyboard, nested menus, search, focus recovery, keep-alive, reading geometry, light/dark, mobile and landscape",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/workspace-navigation-failure.png` })
    .catch(() => undefined);
  throw error;
} finally {
  await browser.close();
}
