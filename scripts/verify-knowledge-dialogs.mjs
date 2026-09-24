import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
try {
  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  const title = page.getByLabel("笔记标题", { exact: true });
  await title.fill("弹窗体验验证");
  await page
    .getByLabel("笔记正文", { exact: true })
    .fill("# 保留写作现场\n\n" + "正文内容\n\n".repeat(80));
  await page
    .locator('.knowledge-editor [role="status"]')
    .filter({ hasText: "已保存到本机" })
    .waitFor();
  await page.locator(".knowledge-content").evaluate((el) => {
    el.scrollTop = 300;
  });
  const before = await page.locator(".knowledge-content").evaluate((el) => el.scrollTop);
  const trigger = page.getByRole("button", { name: "GitHub 同步设置", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "连接设置", exact: true });
  await dialog.waitFor();
  await page.waitForTimeout(220);
  const box = await dialog.boundingBox();
  assert.ok(Math.abs(box.x + box.width / 2 - 720) < 2);
  assert.ok(Math.abs(box.y + box.height / 2 - 500) < 2);
  assert.equal(await page.locator(".knowledge-content").evaluate((el) => el.scrollTop), before);
  await dialog.getByLabel("GitHub 用户或组织").fill("draft-owner");
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.ok(await trigger.evaluate((el) => el === document.activeElement));
  assert.equal(await page.locator(".knowledge-content").evaluate((el) => el.scrollTop), before);
  await trigger.click();
  assert.equal(await dialog.getByLabel("GitHub 用户或组织").inputValue(), "draft-owner");
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({ path: "scripts/shots/knowledge-dialog-desktop.png" });
  await page.mouse.click(8, 8);
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "笔记版本历史", exact: true }).click();
  const history = page.getByRole("dialog", { name: "版本历史", exact: true });
  await history.waitFor();
  await page.screenshot({ path: "scripts/shots/knowledge-dialog-history.png" });
  await history.getByRole("button", { name: "关闭版本历史" }).click();
  await page.getByText("导入、导出与备份", { exact: true }).click();
  await page.getByRole("button", { name: "恢复 ZIP 备份", exact: true }).click();
  await page.getByRole("dialog", { name: "恢复备份" }).waitFor();
  await page.keyboard.press("Escape");
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await trigger.click();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0);
    assert.ok(bounds.x + bounds.width <= viewport.width + 1);
    assert.ok(bounds.y + bounds.height <= viewport.height + 1);
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await dialog.getByLabel("GitHub 分支").fill("main");
    await dialog.getByRole("button", { name: "保存连接" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `scripts/shots/knowledge-dialog-${viewport.width}.png` });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addStyleTag({
    content: ".knowledge-dialog :is(p, label, input, button, span) { font-size: 24px !important; }",
  });
  await trigger.click();
  await dialog.getByRole("button", { name: "保存连接" }).scrollIntoViewIfNeeded();
  assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    "knowledge dialogs PASSED: positioning, focus trap/return, dismissal, draft preservation, scroll, mobile, landscape, reduced motion, large text",
  );
} finally {
  await browser.close();
}
