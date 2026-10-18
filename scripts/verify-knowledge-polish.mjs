import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchEphemeralBrowser, collectPageErrors, ensureShots } from "./lib/browser.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await launchEphemeralBrowser();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = collectPageErrors(page),
  shots = ensureShots();
const tabs = () => page.getByRole("navigation", { name: "打开的笔记", exact: true });
const sidebar = () => page.getByRole("complementary", { name: "知识库导航", exact: true });
const title = () => page.getByLabel("笔记标题", { exact: true });
const contextPanel = () => page.locator("aside.knowledge-context:visible");
const currentId = () => new URL(page.url()).searchParams.get("note");
async function imported(name, path, body = "用于验证标签和定位。") {
  const old = currentId();
  const raw = [
    "---",
    "bcr: 2",
    "id: fixture-polish",
    `title: ${JSON.stringify(name)}`,
    `path: ${JSON.stringify(path)}`,
    "tags: []",
    "collectionId: null",
    "createdAt: 1",
    "updatedAt: 1",
    "---",
    body,
  ].join("\n");
  await page
    .getByLabel("导入 Markdown 笔记", { exact: true })
    .setInputFiles({ name: "fixture.md", mimeType: "text/markdown", buffer: Buffer.from(raw) });
  await page.waitForURL((url) => url.searchParams.get("note") !== old);
  await page.waitForFunction(
    (expected) => document.querySelector('[aria-label="笔记标题"]')?.value === expected,
    name,
  );
  return currentId();
}
async function attach(name, mimeType, text) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "插入附件", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType, buffer: Buffer.from(text) });
  await page.waitForFunction(
    () => !document.querySelector('.knowledge-attachment-status:not([data-error="true"])'),
  );
  assert.equal(await page.locator('.knowledge-attachment-status[data-error="true"]').count(), 0);
}
async function selectTab(id) {
  const picker = page.getByLabel("切换已打开的笔记", { exact: true });
  if (await picker.count()) await picker.selectOption(id);
  else await tabs().locator(`[data-note-tab="${id}"]`).click();
  await page.waitForURL((url) => url.searchParams.get("note") === id);
}
async function activeVisible() {
  await page.waitForFunction(() => {
    const strip = document.querySelector(".knowledge-tabs"),
      active = strip?.querySelector(".knowledge-tab.active");
    if (!active) return false;
    const frame = strip.getBoundingClientRect(),
      box = active.getBoundingClientRect();
    return box.width >= 100 && box.left >= frame.left - 1 && box.right <= frame.right + 1;
  });
}
async function closeActive(expected) {
  const active = tabs().locator(".knowledge-tab.active");
  await active.hover();
  await active.locator(".knowledge-tab-close").click();
  await page.waitForURL((url) => url.searchParams.get("note") === expected);
  await activeVisible();
}
try {
  await page.goto(`${origin}/knowledge`);
  await sidebar().waitFor();
  const clash = await imported("clash", "工具/网络/clash.md", "");
  const yaml = "# 本地配置示例\nlocal-proxy: true\n" + "# 中文🙂跨页预览\n".repeat(4200);
  await attach("config.yaml", "application/yaml", yaml);
  const inline = page.locator(".knowledge-document-file-preview");
  await inline
    .getByLabel("附件正文", { exact: true })
    .filter({ hasText: "local-proxy: true" })
    .waitFor();
  assert.equal(await page.locator(".knowledge-document-stats").innerText(), "1 个附件");
  assert.equal(await page.getByLabel("编辑笔记属性", { exact: true }).innerText(), "添加属性");
  await page.getByRole("button", { name: "查看笔记附件", exact: true }).click();
  await contextPanel().getByRole("button", { name: "添加附件", exact: true }).waitFor();
  const addLayout = await contextPanel()
    .getByRole("button", { name: "添加附件", exact: true })
    .evaluate((button) => {
      const box = button.getBoundingClientRect();
      const range = document.createRange();
      const text = [...button.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
      );
      range.selectNodeContents(text);
      const label = range.getBoundingClientRect();
      return {
        display: getComputedStyle(button).display,
        box: { top: box.top, bottom: box.bottom },
        label: { top: label.top, bottom: label.bottom },
      };
    });
  assert.ok(["flex", "inline-flex"].includes(addLayout.display));
  assert.ok(
    addLayout.label.top >= addLayout.box.top && addLayout.label.bottom <= addLayout.box.bottom,
    "attachment label is never clipped",
  );
  const railBox = await contextPanel().boundingBox(),
    layoutBox = await page.locator(".knowledge-layout").boundingBox();
  assert.ok(
    Math.abs(railBox.y + railBox.height - layoutBox.y - layoutBox.height) <= 3,
    "context background reaches workspace bottom",
  );
  const neutralSize = await contextPanel()
    .locator(".knowledge-attachment-copy small")
    .evaluate((small) => {
      const token = document.createElement("span");
      token.style.color = "var(--color-muted)";
      small.append(token);
      const same = getComputedStyle(small).color === getComputedStyle(token).color;
      token.remove();
      return same;
    });
  assert.equal(neutralSize, true, "ordinary file sizes use a neutral color");
  await contextPanel().getByRole("button", { name: "附件操作：config.yaml", exact: true }).click();
  const menu = page.getByRole("menu", { name: "附件操作", exact: true });
  await menu.waitFor();
  const downloaded = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: "下载原文件", exact: true }).click();
  assert.equal((await readFile(await (await downloaded).path())).toString(), yaml);
  await contextPanel().getByRole("button", { name: "config.yaml", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "config.yaml", exact: true });
  const preview = dialog.getByLabel("附件正文", { exact: true });
  await preview.filter({ hasText: "local-proxy: true" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "提取文本", exact: true }).count(), 0);
  const firstPage = await preview.innerText();
  await dialog.getByRole("button", { name: "复制当前页", exact: true }).click();
  await dialog.getByRole("status").filter({ hasText: "已复制当前页" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), firstPage);
  let reconstructed = firstPage;
  while (await dialog.getByRole("button", { name: "下一页", exact: true }).isEnabled()) {
    const before = await dialog.locator(".knowledge-text-preview-pagination span").innerText();
    await dialog.getByRole("button", { name: "下一页", exact: true }).click();
    await page.waitForFunction((previous) => {
      const section = document.querySelector("dialog[open] .knowledge-text-preview");
      return (
        section?.getAttribute("aria-busy") === "false" &&
        section.querySelector(".knowledge-text-preview-pagination span")?.textContent !== previous
      );
    }, before);
    reconstructed += await preview.innerText();
  }
  assert.equal(reconstructed, yaml, "all pages preserve every Unicode character");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.screenshot({ path: `${shots}/knowledge-polish-desktop.png`, animations: "disabled" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: `${shots}/knowledge-polish-dark.png`, animations: "disabled" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await attach(
    "sample.html",
    "text/html",
    '<script>window.__polishExecuted=true</script><img src="x" onerror="window.__polishExecuted=true">',
  );
  await contextPanel().getByRole("button", { name: "sample.html", exact: true }).click();
  const html = page.getByRole("dialog", { name: "sample.html", exact: true });
  await html.getByLabel("附件正文", { exact: true }).filter({ hasText: "<script>" }).waitFor();
  assert.equal(await html.locator("img,iframe,object").count(), 0);
  assert.equal(await page.evaluate(() => window.__polishExecuted), undefined);
  await page.keyboard.press("Escape");
  await attach("empty.txt", "text/plain", "");
  await contextPanel().getByRole("button", { name: "empty.txt", exact: true }).click();
  await page
    .getByRole("dialog", { name: "empty.txt", exact: true })
    .getByText("文件为空。", { exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "关闭笔记信息", exact: true }).click();
  await imported("工作笔记 00", "工作/文档00.md");
  await tabs()
    .locator(".knowledge-tab")
    .filter({ has: page.locator(`[data-note-tab="${clash}"]`) })
    .hover();
  await tabs().getByRole("button", { name: "关闭标签 clash", exact: true }).click();
  await sidebar()
    .getByRole("button", { name: /^clash/u })
    .click();
  await page.waitForURL((url) => url.searchParams.get("note") === clash);
  assert.equal(await tabs().locator(".knowledge-tab.active").getAttribute("data-preview"), "true");
  assert.ok(
    !JSON.parse(
      await page.evaluate(() => localStorage.getItem("bcr/knowledge-workbench/v1")),
    ).tabs.includes(clash),
  );
  await activeVisible();
  for (let index = 1; index <= 12; index++)
    await imported(
      `工作笔记 ${String(index).padStart(2, "0")}：长标题仍然可以定位当前内容`,
      `工作/文档${index}.md`,
    );
  const ids = await tabs()
    .locator("[data-note-tab]")
    .evaluateAll((buttons) => buttons.map((button) => button.dataset.noteTab));
  assert.ok(await page.getByLabel("切换已打开的笔记", { exact: true }).isVisible());
  await selectTab(ids[Math.floor(ids.length / 2)]);
  await activeVisible();
  await closeActive(ids[Math.floor(ids.length / 2) + 1]);
  const remaining = await tabs()
    .locator("[data-note-tab]")
    .evaluateAll((buttons) => buttons.map((button) => button.dataset.noteTab));
  await selectTab(remaining.at(-1));
  await closeActive(remaining.at(-2));
  const current = currentId();
  await tabs().locator(".knowledge-tab").first().hover();
  await tabs().locator(".knowledge-tab-close").first().click();
  assert.equal(currentId(), current, "closing another tab preserves the current document");
  await activeVisible();
  await page.goto(`${origin}/knowledge?note=${clash}`);
  await title().waitFor();
  await activeVisible();
  const work = sidebar()
    .locator(".knowledge-file-folder > summary")
    .filter({ hasText: /^工作$/u });
  if (await work.evaluate((node) => node.parentElement.open)) await work.click();
  const tools = sidebar()
    .locator(".knowledge-file-folder > summary")
    .filter({ hasText: /^工具$/u });
  if (await tools.evaluate((node) => node.parentElement.open)) await tools.click();
  await page.getByPlaceholder("搜索笔记…", { exact: true }).fill("没有这个结果");
  await page.getByRole("button", { name: "定位当前笔记", exact: true }).click();
  await sidebar().locator('.knowledge-file-note[aria-current="page"]').waitFor();
  assert.equal(await page.getByPlaceholder("搜索笔记…", { exact: true }).inputValue(), "");
  assert.equal(await tools.evaluate((node) => node.parentElement.open), true);
  assert.equal(
    await work.evaluate((node) => node.parentElement.open),
    false,
    "locating preserves unrelated collapsed folders",
  );
  await page.reload();
  assert.equal(await work.evaluate((node) => node.parentElement.open), false);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "定位当前笔记", exact: true }).click();
    const library = page.getByRole("dialog", { name: "笔记库", exact: true });
    await library.locator('.knowledge-file-note[aria-current="page"]').waitFor();
    await page.keyboard.press("Escape");
    await library.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "查看笔记附件", exact: true }).click();
    await contextPanel()
      .getByRole("button", { name: "附件操作：config.yaml", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await page.screenshot({
      path: `${shots}/knowledge-polish-mobile-${width}.png`,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(errors, []);
  console.log(
    "Knowledge polish PASSED: attachment layout/menu, automatic safe text previews, bounded Unicode pages, copy/download, empty files, preview/overflow tabs, adjacent closing, explicit tree location and mobile.",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/knowledge-polish-failure.png`, animations: "disabled" })
    .catch(() => {});
  console.error(
    await page
      .locator("body")
      .innerText()
      .catch(() => "unavailable"),
  );
  throw error;
} finally {
  await browser.close();
}
