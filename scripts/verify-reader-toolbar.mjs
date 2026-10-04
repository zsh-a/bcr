import assert from "node:assert/strict";
import { chromium } from "playwright";
import { openActionMenu } from "./lib/app-controls.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch();
const errors = [];
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 844 },
    { width: 812, height: 375 },
  ]) {
    const touch = viewport.width < 900;
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/reader`);
    const toolbar = page.locator(".reader-toolbar");
    await toolbar.waitFor();
    const trigger = page.getByRole("button", { name: "更多阅读操作", exact: true });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const menu = await openActionMenu(page, "更多阅读操作");
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector('[role="menu"][aria-label="更多阅读操作"]'))
            .opacity === "1",
      );
      const box = await menu.boundingBox();
      assert(
        box.width <= 240 && box.height <= (touch ? 360 : 225),
        "Reader overflow uses command density instead of large form buttons",
      );
      assert(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= viewport.width + 1 &&
          box.y + box.height <= viewport.height + 1,
        "menu remains in the viewport",
      );
      const rows = await menu.locator("button").evaluateAll((items) =>
        items.map((item) => ({
          text: item.textContent.trim(),
          height: item.getBoundingClientRect().height,
          direction: getComputedStyle(item).flexDirection,
        })),
      );
      assert(
        rows.every((row) => row.text && row.direction === "row" && row.height >= (touch ? 44 : 32)),
        "commands have visible text and appropriate touch targets",
      );
      assert.equal(
        await menu.locator(".ui-btn-primary, .ui-icon-btn").count(),
        0,
        "command rows must not inherit primary or icon-only button styles",
      );
      assert.equal(
        await menu.getByRole("menuitem", { name: "导入读物", exact: true }).count(),
        touch ? 1 : 0,
        "mobile import lives in the menu; desktop demo keeps its toolbar shortcut",
      );
      await page.keyboard.press("End");
      assert.equal(
        await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
        "返回工作区主页",
      );
      await page.keyboard.press("ArrowDown");
      assert.equal(
        await page.evaluate(() =>
          document.activeElement.textContent.replace(/Ctrl\+F|⌘F/gu, "").trim(),
        ),
        "搜索书库",
      );
      await page.keyboard.press("Escape");
      assert(
        await trigger.evaluate((element) => element === document.activeElement),
        "Escape returns focus to the overflow trigger",
      );
    }
    await trigger.press("ArrowUp");
    assert.equal(
      await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
      "返回工作区主页",
      "ArrowUp opens at the final menu item",
    );
    await page.keyboard.press("Escape");
    if (!touch) {
      await (
        await openActionMenu(page, "更多阅读操作")
      )
        .getByRole("menuitem", { name: "阅读快捷键帮助", exact: true })
        .click();
      await page.getByRole("dialog", { name: "阅读快捷键", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      assert(
        await trigger.evaluate((element) => element === document.activeElement),
        "help modal restores the overflow trigger",
      );
    } else {
      const helpMenu = await openActionMenu(page, "更多阅读操作");
      assert.equal(
        await helpMenu.getByRole("menuitem", { name: "阅读快捷键帮助", exact: true }).count(),
        0,
      );
      await page.keyboard.press("Escape");
    }
    const modeMenu = await openActionMenu(page, "更多阅读操作");
    assert.equal(
      await modeMenu
        .getByRole("menuitemcheckbox", { name: "漫画模式", exact: true })
        .getAttribute("aria-checked"),
      "false",
    );
    await modeMenu.getByRole("menuitemcheckbox", { name: "漫画模式", exact: true }).click();
    const selectedMode = (await openActionMenu(page, "更多阅读操作")).getByRole(
      "menuitemcheckbox",
      { name: "漫画模式", exact: true },
    );
    assert.equal(
      await selectedMode.getAttribute("aria-checked"),
      "true",
      "comic mode remains available from the command menu",
    );
    await selectedMode.click();
    await (
      await openActionMenu(page, "更多阅读操作")
    )
      .getByRole("menuitem", { name: "搜索书库", exact: true })
      .click();
    await page.getByLabel("在书库中搜索", { exact: true }).waitFor();
    await page.getByRole("button", { name: "关闭搜索结果", exact: true }).click();
    await page.getByLabel("导入阅读文件", { exact: true }).setInputFiles({
      name: "清晰的工具栏.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("第一章\n\n这是本地导入的读物。".repeat(20)),
    });
    await page.getByText("导入完成", { exact: true }).waitFor();
    assert.equal(
      await toolbar.getByRole("button", { name: "导入读物", exact: true }).count(),
      0,
      "regular books keep import in the overflow menu",
    );
    const menu = await openActionMenu(page, "更多阅读操作");
    const chooserPromise = page.waitForEvent("filechooser");
    await menu.getByRole("menuitem", { name: "导入读物", exact: true }).click();
    await chooserPromise;
    assert(
      !(await menu.evaluate((element) => element.matches(":popover-open"))),
      "import closes the command menu",
    );
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "toolbar does not cause page overflow",
    );
    const iconButtons = await toolbar
      .locator(".reader-toolbar-actions-desktop > .ui-icon-btn:visible")
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
          text: button.textContent.trim(),
        })),
      );
    assert(
      iconButtons.every((button) => button.width >= 44 && button.height >= 44 && !button.text),
      "reading controls share the same icon button size",
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Reader toolbar PASSED: compact command menus, clear labels, keyboard/focus, touch sizes, theme variants and one import entry at four viewports",
  );
} finally {
  await browser.close();
}
