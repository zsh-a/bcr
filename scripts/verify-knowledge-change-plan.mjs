import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const title = page.getByLabel("笔记标题", { exact: true });
const body = page.getByLabel("笔记正文", { exact: true });
const dialog = page.getByRole("dialog", { name: "确认重命名", exact: true });
const saved = () =>
  page.locator('.knowledge-editor [role="status"]').filter({ hasText: "已保存到本机" }).waitFor();
async function create(name, content) {
  const old = page.url();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.waitForURL((url) => url.href !== old);
  await page.waitForFunction(() => document.querySelector('[aria-label="笔记标题"]')?.value === "");
  await title.fill(name);
  await body.fill(content);
  await saved();
  return new URL(page.url()).searchParams.get("note");
}
async function tab(name) {
  await page
    .getByRole("navigation", { name: "打开的笔记" })
    .getByRole("button", { name, exact: true })
    .click();
  await page.waitForFunction(
    (value) => document.querySelector('[aria-label="笔记标题"]')?.value === value,
    name,
  );
}
try {
  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  const id = await create("Alpha", "# 正文\n\n保留原始内容");
  await create(
    "Beta",
    "# 相关资料\n\n[[Alpha|原始名称]]\n\n[来源](Alpha.md)\n\n[引用][ref]\n\n[ref]: Alpha.md",
  );
  await tab("Alpha");
  await title.fill("Renamed Alpha");
  await body.fill("# 正文\n\n正文独立保存，不必等待重命名。");
  await saved();
  await page.getByRole("button", { name: "预览重命名", exact: true }).click();
  await dialog.getByText("将修改 2 篇笔记。", { exact: false }).waitFor();
  await dialog.getByRole("button").filter({ hasText: "Beta" }).click();
  assert.ok((await dialog.locator("pre").last().innerText()).includes(id));
  assert.ok((await dialog.locator("pre").first().innerText()).includes("[[Alpha|原始名称]]"));
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({ path: "scripts/shots/knowledge-rename-desktop.png" });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await title.inputValue(), "Alpha");
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "笔记标题",
  );
  assert.ok((await body.innerText()).includes("正文独立保存"));
  await tab("Beta");
  assert.ok((await body.innerText()).includes("[[Alpha|原始名称]]"));
  await tab("Alpha");
  await title.fill("Renamed Alpha");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await title.inputValue(), "Renamed Alpha");
  assert.ok((await body.innerText()).includes("正文独立保存"));
  await page.getByRole("button", { name: "预览重命名", exact: true }).click();
  await dialog.getByRole("button", { name: "刷新预览", exact: true }).click();
  await dialog.getByRole("button", { name: "确认全部修改", exact: true }).waitFor();
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dialog.getByRole("button").filter({ hasText: "Beta" }).click();
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1);
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await dialog
      .getByRole("button", { name: "确认全部修改", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `scripts/shots/knowledge-rename-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  const large = await page.addStyleTag({
    content:
      ".knowledge-rename-review :is(p, button, pre, span, strong) { font-size: 24px !important; }",
  });
  assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await large.evaluate((el) => el.remove());
  await dialog.getByRole("button", { name: "确认全部修改", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await title.inputValue(), "Renamed Alpha");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await tab("Beta");
  assert.ok((await body.innerText()).includes(`[[${id}|原始名称]]`));
  assert.ok((await body.innerText()).includes(`[来源](${id}.md)`));
  await page.reload({ waitUntil: "networkidle" });
  assert.ok((await body.innerText()).includes(`[引用](${id}.md)`));
  assert.deepEqual(errors, []);
  console.log(
    "knowledge change plans PASSED: review, cancel, independent autosave, draft recovery, confirmation, persistence and responsive diff",
  );
} finally {
  await browser.close();
}
