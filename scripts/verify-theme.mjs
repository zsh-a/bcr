import { openWorkspaceOptions } from "./lib/topbar.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({ colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const theme = async (value) =>
  page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, value);
// New knowledge sync UX: the dialog opens from the sync status popover.
const openSyncSettings = async (target) => {
  const trigger = target.locator(".knowledge-status-trigger");
  const popover = target.locator(".knowledge-sync-popover");
  await trigger.click();
  if (!(await popover.evaluate((el) => el.matches(":popover-open")))) await trigger.click();
  await popover.getByRole("button", { name: "同步设置…", exact: true }).click();
  const dialog = target.getByRole("dialog", { name: "同步设置", exact: true });
  await dialog.waitFor();
  return dialog;
};
try {
  await mkdir("scripts/shots", { recursive: true });
  await page.goto(`${origin}/knowledge`);
  const picker = page.getByRole("combobox", { name: "外观主题" });
  await openWorkspaceOptions(page);
  await picker.waitFor();
  await theme("light");
  assert.equal(await picker.inputValue(), "system");
  await page.emulateMedia({ colorScheme: "dark" });
  await theme("dark");
  await openWorkspaceOptions(page);
  await picker.selectOption("light");
  await theme("light");
  await page.reload();
  await openWorkspaceOptions(page);
  await picker.waitFor();
  await theme("light");
  assert.equal(await picker.inputValue(), "light");
  const other = await context.newPage();
  // A same-origin document can change preferences without taking the workspace's OPFS lock.
  await other.goto(`${origin}/icons/reader-icon-192.svg`);
  await other.evaluate(() => localStorage.setItem("bcr/theme", "dark"));
  await theme("dark");
  await other.close();
  for (const mode of ["light", "dark"]) {
    await openWorkspaceOptions(page);
    await picker.selectOption(mode);
    await theme(mode);
    await page.keyboard.press("Escape");
    for (const viewport of [
      { width: 1440, height: 960 },
      { width: 375, height: 812 },
      { width: 812, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      // Viewport media queries can settle one frame after Chromium reports the resize.
      await page.waitForFunction(
        () => {
          const bar = document.querySelector(".studio-topbar");
          return bar && bar.scrollWidth <= bar.clientWidth + 1;
        },
        undefined,
        { timeout: 5000 },
      );
      const dialog = await openSyncSettings(page);
      assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      await page.screenshot({ path: `scripts/shots/theme-${mode}-${viewport.width}.png` });
      if (viewport.width === 375) {
        const largeText = await page.addStyleTag({
          content:
            ".knowledge-dialog :is(p, label, input, button, span) { font-size: 24px !important; }",
        });
        assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
        await largeText.evaluate((element) => element.remove());
      }
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
    await page.getByRole("dialog", { name: "AI 助手", exact: true }).waitFor();
    await page.screenshot({ path: `scripts/shots/theme-agent-${mode}.png` });
    await page.keyboard.press("Control+j");
  }
  await openWorkspaceOptions(page);
  await picker.selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await theme("light");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
  });
  await openWorkspaceOptions(page);
  await picker.selectOption("dark");
  await theme("dark");
  await page.getByRole("status").filter({ hasText: "无法保存" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "theme verification PASSED: system changes, persistence, cross-tab, storage failure, light/dark dialogs and assistant, mobile and landscape",
  );
} finally {
  await browser.close();
}
