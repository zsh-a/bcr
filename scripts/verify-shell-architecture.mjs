import { openWorkspaceOptions } from "./lib/topbar.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: "networkidle" });
  const open = async (name) => {
    await openWorkspaceOptions(page);
    await page.getByRole("button", { name: "打开命令面板", exact: true }).click();
    await page.getByPlaceholder("输入命令…").fill(name);
    await page
      .getByLabel("命令面板", { exact: true })
      .getByRole("button", { name: new RegExp(`^打开 ${name}(?:\\s|$)`) })
      .click();
  };
  const theme = () =>
    page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const topbar = getComputedStyle(document.querySelector(".studio-topbar"));
      return {
        background: body.backgroundColor,
        font: body.fontFamily,
        accent: topbar.getPropertyValue("--color-accent"),
        color: topbar.color,
      };
    });
  const initial = await theme();
  for (const [name, selector] of [
    ["Media Studio", ".media-studio"],
    ["DocGen Lab", ".docgen-studio"],
  ]) {
    await open(name);
    await page.locator(selector).waitFor();
    assert.deepEqual(await theme(), initial, `${name} must not override the host theme`);
  }
  const before = page.url();
  await open("AI 助手");
  await page.getByRole("dialog", { name: "AI 助手", exact: true }).waitFor();
  assert.equal(page.url(), before, "global panel commands must preserve the active workspace");
  assert.equal(await page.locator(".bcr-chat").count(), 1);
  await page.goto(`${origin}/assistant`, { waitUntil: "networkidle" });
  await page.getByRole("dialog", { name: "AI 助手", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/", "legacy route resolves to the global panel");
  assert.deepEqual(errors, []);
  console.log("Shell architecture verification PASSED");
} finally {
  await browser.close();
}
