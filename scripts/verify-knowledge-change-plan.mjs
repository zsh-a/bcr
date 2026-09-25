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
const toast = page.locator(".knowledge-undo-toast");
const saved = () =>
  page
    .locator('[data-testid="knowledge-status"] .knowledge-status-line')
    .filter({ hasText: /^(已保存|已同步)/u })
    .waitFor();
const bodyText = () =>
  body.evaluate((el) =>
    [...el.querySelectorAll(".cm-line")].map((line) => line.textContent).join("\n"),
  );
// Live preview hides link syntax behind widgets; 源码 mode exposes the raw Markdown.
// Only call this while no modal dialog is open (toggling needs an interactive page).
async function rawBody() {
  const source = page.getByRole("button", { name: "源码", exact: true });
  if ((await source.getAttribute("aria-pressed")) !== "true") await source.click();
  return bodyText();
}
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
// Reconstruct the reviewed before/after bodies from the rendered del/ins spans.
async function diffTexts(scope) {
  const flow = scope.locator(".knowledge-review-diff .knowledge-diff-flow");
  await flow.waitFor();
  const toggle = scope.getByRole("button", { name: "查看完整正文" });
  if (await toggle.count()) await toggle.click();
  return flow.evaluate((element) => {
    let before = "",
      after = "";
    for (const node of element.children) {
      const text = node.textContent ?? "";
      if (node.tagName === "DEL") before += text;
      else if (node.tagName === "INS") after += text;
      else {
        before += text;
        after += text;
      }
    }
    return { before, after };
  });
}
const mentions = async (locator, text) => assert.ok((await locator.innerText()).includes(text));
try {
  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  const id = await create("Alpha", "# 正文\n\n保留原始内容");
  await create(
    "Beta",
    "# 相关资料\n\n[[Alpha|原始名称]]\n\n[来源](Alpha.md)\n\n[引用][ref]\n\n[ref]: Alpha.md",
  );
  const betaOriginal = await rawBody();
  assert.ok(betaOriginal.includes("[[Alpha|原始名称]]"));
  assert.ok(betaOriginal.includes("[来源](Alpha.md)"));
  assert.ok(betaOriginal.includes("[引用][ref]"));
  assert.ok(betaOriginal.includes("[ref]: Alpha.md"));

  // ---- Unambiguous live rename: typing the title rewrites links on its own ----
  await tab("Alpha");
  await title.fill("Renamed Alpha");
  await toast.waitFor();
  assert.ok(await dialog.isHidden(), "无歧义重命名不应弹出确认对话框");
  assert.equal(
    (await toast.locator(".knowledge-undo-toast-message").innerText()).trim(),
    "已重命名并更新 3 处链接",
  );
  assert.equal(await title.inputValue(), "Renamed Alpha");
  assert.equal(await page.getByRole("button", { name: "预览重命名", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "刷新预览", exact: true }).count(), 0);
  await tab("Beta");
  assert.ok((await rawBody()).includes(`[[${id}|原始名称]]`));
  assert.ok((await bodyText()).includes(`[来源](${id}.md)`));
  assert.ok((await bodyText()).includes(`[引用](${id}.md)`));
  assert.ok((await bodyText()).includes("[ref]: Alpha.md"));
  // 撤销 reverts the title AND the rewritten links.
  await tab("Renamed Alpha");
  await toast.getByRole("button", { name: "撤销", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="笔记标题"]')?.value === "Alpha",
  );
  await tab("Beta");
  const betaRestored = await rawBody();
  assert.ok(betaRestored.includes("[[Alpha|原始名称]]"));
  assert.ok(betaRestored.includes("[来源](Alpha.md)"));
  assert.ok(betaRestored.includes("[引用][ref]"));

  // ---- Ambiguous same-name case: rename collides with an existing note title ----
  await create("Gamma", "[[同名资料|歧义引用]]");
  await create("同名资料", "同名目标，不改写。");
  await tab("Alpha");
  await title.fill("同名资料");
  await body.fill("# 正文\n\n正文独立保存，不必等待重命名。");
  await saved();
  await dialog.waitFor();
  await mentions(
    dialog.locator("section.knowledge-rename-review > p").first(),
    "将修改 2 篇笔记，标题及引用一次性保存；取消不会修改任何关联笔记。",
  );
  await mentions(
    dialog.locator('.knowledge-rename-ambiguous[aria-label="同名歧义引用"]').locator("li").first(),
    "Gamma 中的 [[同名资料]] 保持不变（同名笔记多于一篇）",
  );
  assert.equal(await dialog.getByRole("button", { name: "关闭确认重命名" }).count(), 1);
  assert.equal(await dialog.getByRole("button", { name: "取消重命名", exact: true }).count(), 1);
  assert.equal(await dialog.getByRole("button", { name: "确认全部修改", exact: true }).count(), 1);

  // Review of affected notes: per-note buttons + rendered before/after diff.
  const review = dialog.locator('.knowledge-review-notes[aria-label="受影响的笔记"]');
  const reviewAlpha = review.getByRole("button").filter({ hasText: "Alpha" });
  const reviewBeta = review.getByRole("button").filter({ hasText: "Beta" });
  assert.equal(await review.getByRole("button").count(), 2);
  assert.equal(await reviewAlpha.getAttribute("aria-pressed"), "true");
  await reviewBeta.click();
  assert.equal(await reviewBeta.getAttribute("aria-pressed"), "true");
  const diff = await diffTexts(dialog);
  assert.ok(diff.before.includes("[[Alpha|原始名称]]"));
  assert.ok(diff.after.includes(`[[${id}|原始名称]]`));
  assert.ok(diff.before.includes("[来源](Alpha.md)"));
  assert.ok(diff.after.includes(`[来源](${id}.md)`));
  assert.ok(diff.before.includes("[引用][ref]"));
  assert.ok(diff.after.includes(`[引用](${id}.md)`));
  assert.ok(diff.before.includes("[ref]: Alpha.md"), "引用式定义应保持不变");
  assert.ok(diff.after.includes("[ref]: Alpha.md"), "引用式定义应保持不变");
  await reviewAlpha.click();
  await mentions(dialog.locator(".knowledge-review-meta").first(), "原标题：Alpha");
  await mentions(dialog.locator(".knowledge-review-meta").first(), "新标题：同名资料");
  // Body autosave is independent of the pending rename.
  assert.ok((await bodyText()).includes("正文独立保存，不必等待重命名。"));
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({ path: "scripts/shots/knowledge-rename-desktop.png" });

  // 取消重命名 keeps title + links untouched and hands focus back to the title input.
  await dialog.getByRole("button", { name: "取消重命名", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await title.inputValue(), "Alpha");
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "笔记标题",
  );
  assert.ok((await bodyText()).includes("正文独立保存，不必等待重命名。"));
  await tab("Beta");
  const betaAfterCancel = await rawBody();
  assert.ok(betaAfterCancel.includes("[[Alpha|原始名称]]"));
  assert.ok(betaAfterCancel.includes("[来源](Alpha.md)"));
  assert.ok(betaAfterCancel.includes("[引用][ref]"));
  await tab("Gamma");
  assert.ok((await rawBody()).includes("[[同名资料|歧义引用]]"));

  // ---- Draft recovery across reload: pending rename survives and re-arms ----
  await tab("Alpha");
  await title.fill("同名资料");
  await dialog.waitFor();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await title.inputValue(), "同名资料");
  assert.ok((await bodyText()).includes("正文独立保存，不必等待重命名。"));
  await dialog.waitFor();

  // ---- Responsive diff: both mobile orientations + large text, no overflow ----
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await review.getByRole("button").filter({ hasText: "Beta" }).click();
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1);
    assert.ok(box.y + box.height <= viewport.height + 1);
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await dialog
      .getByRole("button", { name: "确认全部修改", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `scripts/shots/knowledge-rename-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  const large = await page.addStyleTag({
    content:
      ".knowledge-rename-review :is(p, button, li, span, strong, del, ins, small) { font-size: 24px !important; }",
  });
  assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await large.evaluate((el) => el.remove());

  // ---- 确认全部修改 lands title + rewrites; ambiguous link stays untouched ----
  await dialog.getByRole("button", { name: "确认全部修改", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await title.inputValue(), "同名资料");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await toast.waitFor();
  assert.equal(
    (await toast.locator(".knowledge-undo-toast-message").innerText()).trim(),
    "已重命名并更新 3 处链接",
  );
  await tab("Beta");
  const betaConfirmed = await rawBody();
  assert.ok(betaConfirmed.includes(`[[${id}|原始名称]]`));
  assert.ok(betaConfirmed.includes(`[来源](${id}.md)`));
  assert.ok(betaConfirmed.includes(`[引用](${id}.md)`));
  assert.ok(betaConfirmed.includes("[ref]: Alpha.md"));
  await tab("Gamma");
  assert.ok((await rawBody()).includes("[[同名资料|歧义引用]]"));

  // ---- Persistence after reload ----
  await page.reload({ waitUntil: "networkidle" });
  await tab("Beta");
  const betaPersisted = await rawBody();
  assert.ok(betaPersisted.includes(`[[${id}|原始名称]]`));
  assert.ok(betaPersisted.includes(`[来源](${id}.md)`));
  assert.ok(betaPersisted.includes(`[引用](${id}.md)`));
  await tab("Gamma");
  assert.ok((await rawBody()).includes("[[同名资料|歧义引用]]"));
  await page.goto(`${origin}/knowledge?note=${id}`, { waitUntil: "networkidle" });
  assert.equal(await title.inputValue(), "同名资料");

  // ---- Before-side ambiguity: the note already shares its name with a twin ----
  await title.fill("最终名称");
  await dialog.waitFor();
  await mentions(
    dialog.locator("section.knowledge-rename-review > p").first(),
    "将修改 1 篇笔记，标题及引用一次性保存；取消不会修改任何关联笔记。",
  );
  await mentions(
    dialog.locator('.knowledge-rename-ambiguous[aria-label="同名歧义引用"]').locator("li").first(),
    "Gamma 中的 [[同名资料]] 保持不变（同名笔记多于一篇）",
  );
  assert.equal(await review.getByRole("button").count(), 1);
  await dialog.getByRole("button", { name: "确认全部修改", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await title.inputValue(), "最终名称");
  await toast.waitFor();
  assert.equal(
    (await toast.locator(".knowledge-undo-toast-message").innerText()).trim(),
    "已重命名",
  );
  await tab("Gamma");
  assert.ok((await rawBody()).includes("[[同名资料|歧义引用]]"));
  assert.deepEqual(errors, []);
  console.log(
    "knowledge change plans PASSED: live rename + undo toast, both-sided ambiguity review, cancel with focus return, independent autosave, draft recovery, confirmed rewrites to stable ids and responsive diff",
  );
} finally {
  await browser.close();
}
