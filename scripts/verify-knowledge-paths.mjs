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
const location = page.getByLabel("笔记位置", { exact: true });
const saved = () =>
  page.locator('.knowledge-editor [role="status"]').filter({ hasText: "已保存到本机" }).waitFor();
async function create(name) {
  const old = page.url();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.waitForURL((url) => url.href !== old);
  await page.waitForFunction(() => document.querySelector('[aria-label="笔记标题"]')?.value === "");
  await title.fill(name);
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
async function move(path) {
  await page.getByRole("button", { name: "移动笔记", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "移动笔记", exact: true });
  await dialog.getByLabel("目标笔记路径", { exact: true }).fill(path);
  await dialog.getByRole("button", { name: "预览移动", exact: true }).click();
  return dialog;
}
async function confirm(dialog) {
  await dialog.getByRole("button", { name: "确认移动", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
try {
  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  const a = await create("Alpha");
  await confirm(await move("old/Alpha.md"));
  const b = await create("Beta");
  await confirm(await move("old/Beta.md"));
  await body.fill("# Beta\n\n[[./Alpha|相关笔记]]\n\n[来源](./Alpha.md)");
  await saved();
  await tab("Alpha");
  await body.fill("# Alpha\n\n[下一篇](./Beta.md)");
  await saved();
  let dialog = await move("new/Alpha.md");
  await dialog.getByText("将修改 2 篇笔记。", { exact: false }).waitFor();
  await dialog.getByRole("button").filter({ hasText: "Beta" }).click();
  assert.ok((await dialog.locator("pre").last().innerText()).includes(a));
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.ok((await location.innerText()).includes("old/Alpha.md"));
  assert.equal(
    await page
      .getByRole("button", { name: "移动笔记", exact: true })
      .evaluate((el) => document.activeElement === el),
    true,
  );
  dialog = await move("new/Alpha.md");
  await mkdir("scripts/shots", { recursive: true });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1);
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await dialog.getByRole("button", { name: "确认移动", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `scripts/shots/knowledge-move-${viewport.width}.png` });
  }
  await confirm(dialog);
  assert.equal(new URL(page.url()).searchParams.get("note"), a);
  assert.equal(await title.inputValue(), "Alpha");
  assert.ok((await body.innerText()).includes(`${b}.md`));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await tab("Beta");
  assert.ok((await body.innerText()).includes(`[[${a}|相关笔记]]`));
  dialog = await move("new/Alpha.md");
  await dialog.getByRole("alert").filter({ hasText: "路径冲突" }).waitFor();
  assert.equal(
    await dialog.getByRole("button", { name: "确认移动", exact: true }).isDisabled(),
    true,
  );
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "文件夹", exact: true }).click();
  await page.getByRole("button", { name: "移动文件夹 new", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "移动文件夹", exact: true });
  await dialog.getByLabel("目标文件夹路径", { exact: true }).fill("archive/项目");
  await dialog.getByRole("button", { name: "预览移动", exact: true }).click();
  await confirm(dialog);
  await page
    .getByRole("navigation", { name: "笔记列表" })
    .getByRole("button", { name: "Alpha.md", exact: true })
    .click();
  assert.ok((await location.innerText()).includes("archive/项目/Alpha.md"));
  await page.screenshot({ path: "scripts/shots/knowledge-file-tree.png" });
  await page.reload({ waitUntil: "networkidle" });
  assert.ok((await location.innerText()).includes("archive/项目/Alpha.md"));
  await page.getByLabel("搜索个人笔记", { exact: true }).fill("archive/项目");
  const list = page.getByRole("navigation", { name: "笔记列表" });
  await list.getByRole("button").filter({ hasText: "Alpha" }).waitFor();
  assert.equal(await list.getByRole("button").count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    "knowledge paths PASSED: move preview/cancel, inbound/outbound links, collisions, folders, path search, reload and responsive dialogs",
  );
} catch (error) {
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
