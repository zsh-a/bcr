import assert from "node:assert/strict";
import { chromium } from "playwright";
import { trackModuleRequests } from "./lib/modules.mjs";
import { libraryTool, openBookMenu, openLibrary } from "./lib/reader-library.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch();
const errors = [];
const files = ["甲册", "乙册"].map((title) => ({
  name: `${title}.txt`,
  mimeType: "text/plain",
  buffer: Buffer.from(`${title}\n\n第一章\n\n${"阅读正文。".repeat(200)}`),
}));
try {
  for (const width of [1440, 812, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      hasTouch: width < 900,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await trackModuleRequests(page);
    await page.goto(`${origin}/pwa/reader/`);
    await page.getByLabel("导入阅读文件", { exact: true }).setInputFiles(files);
    await page.getByText("导入完成", { exact: true }).waitFor();
    await openLibrary(page);
    await page.evaluate(async () => {
      const urls = await window.__bcrTestModuleUrls();
      window.libraryAudit = await import(
        urls.find((url) => new URL(url).pathname.endsWith("/packages/reader-studio/src/store.ts"))
      );
    });
    const active = await page.evaluate(() => window.libraryAudit.getReaderState().activeBookId);
    const row = page.getByRole("button", { name: "甲册", exact: true });
    const menu = page.getByRole("menu", { name: "读物操作", exact: true });
    await openBookMenu(page, "甲册");
    assert.equal(
      await page.evaluate(() => window.libraryAudit.getReaderState().activeBookId),
      active,
      "right-click must preserve the reading session",
    );
    await page.keyboard.press("End");
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "移除读物…");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "打开读物");
    await page.keyboard.press("Escape");
    assert.equal(await menu.count(), 0);
    assert(await row.evaluate((element) => element === document.activeElement));
    await page.getByRole("button", { name: "书库操作", exact: true }).click();
    await page.keyboard.press("Escape");
    assert(await row.isVisible(), "Escape closes the toolbar menu before the library");
    await row.press("Shift+F10");
    await menu.waitFor();
    await page.getByLabel("筛选书名或作者", { exact: true }).click();
    assert.equal(
      await menu.count(),
      0,
      "outside click closes the menu without closing the library",
    );
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await row.evaluate(
        (element, x) =>
          element.dispatchEvent(
            new MouseEvent("contextmenu", {
              clientX: x,
              clientY: 899,
              bubbles: true,
              cancelable: true,
            }),
          ),
        width - 1,
      );
      await menu.waitFor();
      const box = await menu.boundingBox();
      assert(
        box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 900,
        "context menu must stay inside the viewport",
      );
      assert(
        await menu.evaluate((element) => element.matches(":popover-open")),
        "menu must use the top layer even inside the mobile library dialog",
      );
      await page.keyboard.press("Escape");
    }
    await (
      await openBookMenu(page, "甲册")
    )
      .getByRole("menuitem", { name: "收藏读物", exact: true })
      .click();
    await (
      await openBookMenu(page, "甲册")
    )
      .getByRole("menuitem", { name: "取消收藏", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await row.press("F2");
    await page.getByLabel("读物名称", { exact: true }).fill("不保存的草稿");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await row.press("F2");
    assert.equal(
      await page.getByLabel("读物名称", { exact: true }).inputValue(),
      "甲册",
      "a new rename action resets a cancelled draft",
    );
    await page.getByLabel("读物名称", { exact: true }).fill("更新后的甲册");
    await page.getByRole("button", { name: "保存名称", exact: true }).click();
    await page.getByRole("button", { name: "更新后的甲册", exact: true }).waitFor();
    await (
      await openBookMenu(page, "更新后的甲册")
    )
      .getByRole("menuitem", { name: "读物详情", exact: true })
      .click();
    const details = page.getByRole("dialog", { name: "读物详情", exact: true });
    assert.match(await details.innerText(), /甲册\.txt/u);
    await page.keyboard.press("Escape");
    await (
      await openBookMenu(page, "乙册")
    )
      .getByRole("menuitem", { name: "移除读物…", exact: true })
      .click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "乙册", exact: true }).waitFor();
    await (
      await openBookMenu(page, "乙册")
    )
      .getByRole("menuitem", { name: "移除读物…", exact: true })
      .click();
    await page.getByRole("button", { name: "确认移除读物", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "乙册", exact: true }).count(), 0);
    assert(
      await page
        .getByLabel("筛选书名或作者", { exact: true })
        .evaluate((element) => element === document.activeElement),
    );
    if (width < 900) {
      const before = await page.evaluate(() => window.libraryAudit.getReaderState().activeBookId);
      await openBookMenu(page, "更新后的甲册", { touch: true });
      assert.equal(
        await page.evaluate(() => window.libraryAudit.getReaderState().activeBookId),
        before,
        "long press must not open the book",
      );
      assert(await menu.isVisible(), "releasing a long press must preserve the menu");
      const sizes = await menu
        .getByRole("menuitem")
        .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
      assert(
        sizes.every((height) => height >= 44),
        "touch menu targets must remain large enough",
      );
      await page.keyboard.press("Escape");
      const box = await page
        .getByRole("button", { name: "更新后的甲册", exact: true })
        .boundingBox();
      const session = await context.newCDPSession(page);
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...point, y: point.y + 25 }],
      });
      await page.waitForTimeout(650);
      await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await session.detach();
      assert.equal(await menu.count(), 0, "scrolling gesture must cancel long press");
    }
    await libraryTool(page, "管理书库");
    const manager = page.locator(".reader-library-full");
    await manager
      .getByRole("button", { name: "更新后的甲册", exact: true })
      .click({ button: "right" });
    await menu.getByRole("menuitem", { name: "读物详情", exact: true }).click();
    await page.keyboard.press("Escape");
    assert(await manager.isVisible(), "closing child dialog preserves library management");
    await manager.getByRole("button", { name: "关闭书库管理", exact: true }).click();
    await libraryTool(page, "管理当前读物");
    await menu.waitFor();
    await page.keyboard.press("Escape");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.reload();
    await openLibrary(page);
    await page.getByRole("button", { name: "更新后的甲册", exact: true }).waitFor();
    await (
      await openBookMenu(page, "更新后的甲册")
    )
      .getByRole("menuitem", { name: "取消收藏", exact: true })
      .waitFor();
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Reader context menu PASSED: pointer/keyboard/touch, viewport boundaries, focus recovery, favorite/rename persistence, safe removal and nested management",
  );
} finally {
  await browser.close();
}
