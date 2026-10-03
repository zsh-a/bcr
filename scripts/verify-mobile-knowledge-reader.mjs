import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const button = (name) => page.getByRole("button", { name, exact: true });
const shots = new URL("./shots/", import.meta.url);
await mkdir(shots, { recursive: true });

async function modalFocus(dialog, typing = false) {
  assert(await dialog.evaluate((element) => element.matches(":modal")));
  assert(await dialog.evaluate((element) => element.contains(document.activeElement)));
  if (!typing)
    assert(
      await page.evaluate(() => !document.activeElement.matches("input, textarea")),
      "opening navigation must not summon the keyboard",
    );
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    assert(
      await dialog.evaluate((element) => element.contains(document.activeElement)),
      "focus escaped the modal",
    );
  }
}
async function noOverflow() {
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "page overflows horizontally",
  );
  for (const dialog of await page.locator("dialog[open]").all()) {
    const bounds = await dialog.boundingBox();
    assert(
      bounds.x >= -1 && bounds.x + bounds.width <= page.viewportSize().width + 1,
      "dialog exceeds the viewport",
    );
  }
}
async function touchTarget(control) {
  const box = await control.boundingBox();
  assert(
    box && box.width >= 44 && box.height >= 44,
    `small touch target: ${await control.getAttribute("aria-label")}`,
  );
}
// Exercise visual-viewport events independently from layout resizing. This models
// keyboard occlusion; device keyboard behavior still needs a physical-device check.
async function keyboardViewport(height) {
  await page.evaluate((value) => {
    Object.defineProperty(visualViewport, "height", { configurable: true, get: () => value });
    visualViewport.dispatchEvent(new Event("resize"));
  }, height);
}
async function fitsKeyboard(surface, height) {
  await keyboardViewport(height);
  const box = await surface.boundingBox();
  assert(box.y >= 0 && box.y + box.height <= height + 1, "modal controls sit behind the keyboard");
  await keyboardViewport(page.viewportSize().height);
}

try {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${origin}/knowledge`);
  await button("写第一篇笔记").click();
  await page.getByLabel("笔记标题", { exact: true }).fill("移动端阅读与写作体验");
  await page
    .getByLabel("笔记正文", { exact: true })
    .fill("# 灵感\n\n把阅读变成思考，再把思考留在笔记里。\n\n## 行动\n\n明天继续。");
  const modes = page.getByRole("group", { name: "视图模式", exact: true });
  await modes.getByRole("button", { name: "阅读", exact: true }).click();
  await page
    .locator(".knowledge-prose")
    .getByRole("heading", { name: "灵感", exact: true })
    .waitFor();
  await modes.getByRole("button", { name: "源码", exact: true }).click();
  assert.match(await page.getByLabel("笔记正文", { exact: true }).innerText(), /# 灵感/);

  await page.locator(".knowledge-status-trigger").click();
  const sync = page.locator(".knowledge-sync-popover");
  await sync.waitFor();
  await sync.getByRole("button", { name: "立即同步", exact: true }).click({ trial: true });
  for (const control of await sync.locator("button, .knowledge-checkbox").all())
    await touchTarget(control);
  await keyboardViewport(220);
  await page.waitForFunction(() => {
    const box = document.querySelector(".knowledge-sync-popover").getBoundingClientRect();
    return box.top >= 0 && box.bottom <= visualViewport.height;
  });
  await page.keyboard.press("Escape");
  await sync.waitFor({ state: "hidden" });
  await keyboardViewport(page.viewportSize().height);

  await button("切换笔记列表").click();
  const library = page.getByRole("dialog", { name: "笔记库", exact: true });
  await modalFocus(library);
  await fitsKeyboard(library, 420);
  await library
    .getByRole("button", { name: "笔记操作：移动端阅读与写作体验", exact: true })
    .click();
  const noteMenu = page.getByRole("menu", { name: "目录树操作", exact: true });
  await noteMenu.getByRole("menuitem", { name: "收藏", exact: true }).click();
  await noteMenu.waitFor({ state: "hidden" });
  await library.getByRole("button", { name: "收藏", exact: true }).click();
  assert.equal(await library.locator(".knowledge-result").count(), 1);
  await page.keyboard.press("Escape");
  await library.waitFor({ state: "hidden" });
  assert(await button("切换笔记列表").evaluate((element) => element === document.activeElement));

  await button("展开上下文栏").click();
  const info = page.getByRole("dialog", { name: "笔记信息", exact: true });
  await info.getByRole("button", { name: "行动", exact: true }).click();
  await info.waitFor({ state: "hidden" });
  await button("编辑笔记属性").click();
  await info.getByRole("button", { name: "添加标签", exact: true }).click();
  await info.getByLabel("笔记标签", { exact: true }).fill("移动体验");
  await info.getByLabel("笔记标签", { exact: true }).press("Enter");
  await fitsKeyboard(info, 420);
  await info.getByRole("button", { name: "关闭", exact: true }).click();

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow();
    const toolbar = await page.locator(".knowledge-toolbar").boundingBox();
    const editor = await page.locator(".knowledge-editor").boundingBox();
    assert(editor.y >= toolbar.y + toolbar.height - 1, "toolbar overlaps the document");
    for (const name of [
      "切换笔记列表",
      "搜索与切换笔记",
      "展开上下文栏",
      "更多操作",
      "更多写作工具",
    ])
      await touchTarget(button(name));
    await touchTarget(modes.getByRole("button", { name: "阅读", exact: true }));
    await page.screenshot({ path: new URL(`mobile-knowledge-${width}.png`, shots).pathname });
  }
  await page.reload();
  assert.equal(
    await page.getByLabel("笔记标题", { exact: true }).inputValue(),
    "移动端阅读与写作体验",
  );
  assert.match(await page.getByLabel("笔记正文", { exact: true }).innerText(), /明天继续/);

  await page.goto(`${origin}/reader`);
  await page.locator(".reader-reading-scroll").waitFor();
  await button("打开阅读设置").click();
  const settings = page.getByRole("dialog", { name: "阅读设置", exact: true });
  await modalFocus(settings);
  const increment = button("增大字号");
  const sizeBox = await increment.boundingBox();
  const settingsBox = await settings.locator(".reader-settings-sheet").boundingBox();
  assert(
    sizeBox.y + sizeBox.height <= settingsBox.y + settingsBox.height,
    "font size requires scrolling past advanced settings",
  );
  await increment.click();
  await button("工具").click();
  await button("标记当前位置").click();
  await button("移除当前位置书签").waitFor();
  await button("添加阅读笔记").click();
  const composer = page.getByRole("dialog", { name: "把这一刻留下来", exact: true });
  await composer.getByLabel("笔记内容", { exact: true }).fill("从移动端记录一段阅读想法。");
  await fitsKeyboard(composer.locator(".reader-note-sheet"), 420);
  await button("保存笔记").click();
  await composer.waitFor({ state: "hidden" });

  await button("在当前读物中搜索").click();
  const search = page.getByRole("dialog", { name: "搜索原文", exact: true });
  const query = search.getByRole("combobox");
  await query.fill("阅读");
  await search.getByRole("option").first().waitFor();
  await query.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  assert(await search.isVisible(), "IME confirmation must not navigate");
  await fitsKeyboard(search.locator(".reader-search-panel"), 420);
  await modalFocus(search, true);
  await search.getByRole("option").first().click();
  await search.waitFor({ state: "hidden" });
  await page.locator('[data-reader-search-match="true"]').first().waitFor({ state: "attached" });

  await button("打开书库").click();
  const books = page.getByRole("dialog", { name: "书库", exact: false });
  await books.locator(".reader-library-panel").waitFor();
  await page
    .getByRole("button", { name: /^读物操作：/u })
    .first()
    .click();
  await page.getByRole("menuitem", { name: /^重命名/u }).waitFor();
  await page.keyboard.press("Escape");
  assert(await books.isVisible());
  await books.getByRole("button", { name: "收起书库", exact: true }).click();
  await button("退出搜索导航").click();
  await button("目录").click();
  await page.getByRole("tab", { name: /^笔记/u }).click();
  await page.getByText("从移动端记录一段阅读想法。", { exact: true }).waitFor();
  await page.keyboard.press("Escape");

  for (const viewport of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await noOverflow();
    for (const name of ["打开书库", "在当前读物中搜索", "打开阅读设置", "更多阅读操作"])
      await touchTarget(button(name));
    await button("打开阅读设置").click();
    await button("排版").click();
    await page.getByRole("button", { name: "应用舒适屏幕排版", exact: true }).waitFor();
    await noOverflow();
    await page.screenshot({
      path: new URL(`mobile-reader-settings-${viewport.width}.png`, shots).pathname,
    });
    await button("关闭阅读设置").click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await button("打开阅读设置").click();
  await page
    .getByRole("group", { name: "阅读主题", exact: true })
    .getByRole("button", { name: "夜间", exact: true })
    .click();
  await button("关闭阅读设置").click();
  await page.screenshot({ path: new URL("mobile-reader-night.png", shots).pathname });
  assert.deepEqual(errors, []);
  console.log(
    "mobile knowledge + reader PASSED: editing, save/restore, touch targets, modal focus, quick actions, IME search, notes, narrow screens, landscape and keyboard viewport bounds",
  );
} catch (error) {
  await page
    .screenshot({ path: new URL("mobile-knowledge-reader-failure.png", shots).pathname })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
