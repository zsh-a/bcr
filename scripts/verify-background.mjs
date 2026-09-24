import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await mkdir("scripts/shots", { recursive: true });
  await page.goto(origin);
  const trigger = page.getByRole("button", { name: "自定义背景", exact: true });
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "背景设置", exact: true });
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1600;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 2400, 1600);
    gradient.addColorStop(0, "#b0d7bd");
    gradient.addColorStop(0.5, "#305772");
    gradient.addColorStop(1, "#d6a772");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2400, 1600);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await panel.getByLabel("背景图片", { exact: true }).setInputFiles({
    name: "landscape.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  });
  await panel.getByRole("status").filter({ hasText: "背景已保存" }).waitFor();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("bcr/background")));
  assert.ok(saved.image.startsWith("data:image/webp;base64,"));
  assert.equal(
    await page
      .locator(".studio-home")
      .evaluate((el) => getComputedStyle(el).backgroundImage.includes("data:image/")),
    true,
  );
  const range = panel.getByRole("slider", { name: "背景遮罩强度" });
  await range.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem("bcr/background")).shade),
    70,
  );
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
  await page.reload();
  await trigger.waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.hasAttribute("data-background")),
    true,
  );
  const other = await context.newPage();
  await other.goto(`${origin}/icons/reader-icon-192.svg`);
  await other.evaluate(() => {
    const value = JSON.parse(localStorage.getItem("bcr/background"));
    localStorage.setItem("bcr/background", JSON.stringify({ ...value, shade: 75 }));
  });
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--workspace-shade") === "75%",
  );
  await other.close();
  await trigger.click();
  await panel
    .getByLabel("背景图片", { exact: true })
    .setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("broken") });
  await panel.getByRole("alert").filter({ hasText: "无法读取" }).waitFor();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem("bcr/background")).name),
    "landscape.png",
  );
  await page.keyboard.press("Escape");
  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "外观主题" }).selectOption(theme);
    for (const width of [1440, 375, 812]) {
      await page.setViewportSize({ width, height: width === 812 ? 375 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await trigger.click();
      const box = await panel.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      assert.ok(box.y >= 0 && box.y + box.height <= (width === 812 ? 375 : 900));
      assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      assert.ok(
        await page.locator(".studio-topbar").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page.screenshot({ path: `scripts/shots/background-${theme}-${width}.png` });
      if (width === 375) {
        const largeText = await page.addStyleTag({
          content:
            ".studio-background-settings :is(p, label, input, button, span, small) { font-size: 24px !important; }",
        });
        assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
        await panel.getByRole("button", { name: "恢复默认背景" }).scrollIntoViewIfNeeded();
        await largeText.evaluate((el) => el.remove());
      }
      await page.keyboard.press("Escape");
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${origin}/knowledge`);
  await trigger.waitFor();
  assert.equal(
    await page
      .locator(".knowledge-app")
      .evaluate((el) => getComputedStyle(el).backgroundImage.includes("data:image/")),
    true,
  );
  await page.screenshot({ path: "scripts/shots/background-knowledge.png" });
  await page.getByRole("button", { name: "写第一篇笔记", exact: true }).click();
  await page.getByLabel("笔记正文", { exact: true }).fill("背景不会影响正文阅读。");
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const editor = page.getByRole("region", { name: "笔记编辑器", exact: true });
    assert.ok(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    assert.notEqual(
      await editor.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
  }
  await trigger.click();
  await page.evaluate(() => {
    const remove = Object.getOwnPropertyDescriptor(Storage.prototype, "removeItem").value;
    Storage.prototype.removeItem = function (key) {
      if (key === "bcr/background") throw Error("blocked");
      return remove.call(this, key);
    };
  });
  await panel.getByRole("button", { name: "恢复默认背景" }).click();
  await panel.getByRole("alert").filter({ hasText: "原设置已保留" }).waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.hasAttribute("data-background")),
    true,
  );
  await page.reload();
  await trigger.click();
  await panel.getByRole("button", { name: "恢复默认背景" }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem("bcr/background")), null);
  assert.equal(
    await page.evaluate(() => document.documentElement.hasAttribute("data-background")),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "background verification PASSED: local image normalization, persistence, shade, failed decoding/storage, reset, theme and mobile layouts",
  );
} finally {
  await browser.close();
}
