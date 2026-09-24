import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const body = () => page.getByLabel("笔记正文", { exact: true });
const title = () => page.getByLabel("笔记标题", { exact: true });
const saved = () =>
  page.locator('.knowledge-editor [role="status"]').filter({ hasText: "已保存到本机" }).waitFor();
async function create(name, content) {
  const previous = new URL(page.url()).searchParams.get("note");
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("note") !== previous);
  await page.waitForFunction(() => document.querySelector('[aria-label="笔记标题"]')?.value === "");
  await title().fill(name);
  await body().fill(content);
  await saved();
  return new URL(page.url()).searchParams.get("note");
}
async function tab(name) {
  await page
    .getByRole("navigation", { name: "打开的笔记", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
  await page.waitForFunction(
    (expected) => document.querySelector('[aria-label="笔记标题"]')?.value === expected,
    name,
  );
}
try {
  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  const alpha = await create("Alpha", "# First\n\nOriginal note.");
  // Separate user typing from the initial paste into distinct CodeMirror undo groups.
  await page.waitForTimeout(600);
  await body().press("Control+End");
  await body().pressSequentially(" Extra sentence.");
  await saved();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await body().press("Control+z");
  assert.match(await body().innerText(), /Original note\./);
  assert.ok(!(await body().innerText()).includes("Extra sentence."), "reading mode preserves undo");
  await body().press("Control+y");
  assert.match(await body().innerText(), /Extra sentence\./);
  await saved();
  await create(
    "Beta",
    "# Links\n\n[[Alpha#First|Go to Alpha]]\n\n- [x] Complete\n\n| Name | Value |\n| --- | --- |\n| A | B |",
  );
  await tab("Alpha");
  await body().focus();
  await body().press("Control+z");
  assert.ok(
    !(await body().innerText()).includes("Extra sentence."),
    "switching notes preserves undo",
  );
  await saved();
  await page.getByRole("button", { name: "收藏当前笔记", exact: true }).click();
  await page.getByRole("button", { name: "收藏", exact: true }).click();
  assert.equal(await page.locator(".knowledge-note-card").count(), 1);
  await page.getByRole("button", { name: "大纲与链接", exact: true }).click();
  const context = page.getByRole("complementary", { name: "笔记上下文" });
  await context.getByRole("button", { name: "First", exact: true }).click();
  await context.getByRole("button", { name: "Beta", exact: true }).click();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  assert.equal(await page.locator(".knowledge-prose table").count(), 1);
  assert.equal(await page.locator('.knowledge-prose input[type="checkbox"]').count(), 1);
  await page
    .locator(".knowledge-prose")
    .getByRole("link", { name: "Go to Alpha", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="笔记标题"]')?.value === "Alpha",
  );
  await page.getByRole("button", { name: "上一条笔记", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="笔记标题"]')?.value === "Beta",
  );
  await page.getByRole("button", { name: "下一条笔记", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="笔记标题"]')?.value === "Alpha",
  );
  await page.keyboard.press("Control+o");
  const picker = page.getByRole("dialog", { name: "快速打开笔记" });
  await picker.getByLabel("查找或创建笔记").fill("New from switcher");
  await picker
    .getByLabel("查找或创建笔记")
    .dispatchEvent("keydown", { key: "Enter", isComposing: true });
  assert.ok(await picker.isVisible(), "IME confirmation must not create a note");
  await picker.getByLabel("查找或创建笔记").press("Enter");
  await picker.waitFor({ state: "hidden" });
  assert.equal(await title().inputValue(), "New from switcher");
  await create("My template", "# {{title}}\n\nDate: {{date}}\n\n## Notes\n");
  await page.getByLabel("笔记标签", { exact: true }).fill("模板");
  await saved();
  await tab("New from switcher");
  await page.getByLabel("插入笔记模板").selectOption({ label: "My template" });
  await saved();
  assert.match(await body().innerText(), /# New from switcher/);
  assert.ok(!(await body().innerText()).includes("{{date}}"));
  await page.getByRole("button", { name: "今日日记", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("note")?.startsWith("daily-"));
  const daily = new URL(page.url()).searchParams.get("note");
  assert.ok(daily.startsWith("daily-"));
  await body().fill("My daily record");
  await saved();
  await tab("Alpha");
  await page.getByRole("button", { name: "今日日记", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("note") === daily);
  assert.equal(new URL(page.url()).searchParams.get("note"), daily);
  assert.equal((await body().innerText()).trim(), "My daily record");
  await page.reload({ waitUntil: "networkidle" });
  await tab("Alpha");
  assert.equal(
    await page.getByRole("button", { name: "收藏当前笔记" }).getAttribute("aria-pressed"),
    "true",
  );
  await title().fill("Alpha renamed");
  await saved();
  await tab("Beta");
  assert.ok((await body().innerText()).includes(`[[${alpha}#First|Go to Alpha]]`));
  await tab("Alpha renamed");
  await title().fill("Alpha");
  await saved();
  await body().fill("[[Al");
  await page.getByRole("option").filter({ hasText: "Alpha" }).first().waitFor();
  await body().press("Enter");
  assert.match(await body().innerText(), new RegExp(alpha));
  await saved();
  const originalLink = await body().innerText();
  await page.getByRole("button", { name: "实时预览", exact: true }).click();
  await page.locator(".knowledge-inline-link").filter({ hasText: "Alpha" }).waitFor();
  assert.ok(
    !(await body().innerText()).includes(alpha),
    "live preview hides stable IDs without rewriting Markdown",
  );
  await page.getByRole("button", { name: "源码模式", exact: true }).click();
  assert.equal(await body().innerText(), originalLink);
  await body().fill(
    "# 把零散想法连成知识\n\n记录只是开始，让笔记之间建立联系。\n\n## 下一步\n\n- [ ] 回顾今天的想法\n- [ ] 整理资料与来源\n\n## 关联阅读\n\n[[Beta|链接与引用示例]]\n\n**保留原始 Markdown，让知识可以随时带走。**",
  );
  await saved();
  await page.getByRole("button", { name: "实时预览", exact: true }).click();
  await page.getByRole("button", { name: "大纲与链接", exact: true }).click();
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({ path: "scripts/shots/knowledge-workbench-desktop.png" });
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    );
    if (viewport.width === 375) {
      await page.getByRole("button", { name: "打开笔记列表", exact: true }).click();
      await page.getByRole("button", { name: "快速切换笔记", exact: true }).click();
      await picker.getByLabel("查找或创建笔记").fill("Alpha");
      await picker.getByLabel("查找或创建笔记").press("Escape");
      await picker.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "收起列表", exact: true }).click();
    }
    await page.screenshot({ path: `scripts/shots/knowledge-workbench-${viewport.width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log(
    "knowledge workbench PASSED: undo, navigation, backlinks, GFM, switcher, templates, daily notes, favorites, completion and mobile",
  );
} catch (error) {
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({ path: "scripts/shots/knowledge-workbench-failure.png" });
  console.error(await page.locator(".knowledge-tabs").textContent(), await title().inputValue());
  throw error;
} finally {
  await browser.close();
}
