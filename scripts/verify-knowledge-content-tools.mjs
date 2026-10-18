import assert from "node:assert/strict";
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
const body = () => page.getByLabel("笔记正文", { exact: true });
const tools = () => body().getByRole("group", { name: "代码块操作", exact: true });
const popup = () => page.getByRole("dialog", { name: "链接操作", exact: true });
const dialog = () => page.getByRole("dialog", { name: "编辑链接", exact: true });
const fixture =
  '# 内容工具\n\n```js title=demo\nconst total = 42;\n\nconsole.log("中文🙂", total);\n```\n\n> ~~~yaml\n> name: bcr\n> \n> ~~~\n\n[**参考**](<https://example.com/original> "保留标题") 与 [引用][ref]\n\n[ref]: https://reference.test "Reference title"\n\n结尾。';
async function state() {
  return page.evaluate(() => ({
    text: window.__content.view.state.doc.toString(),
    undo: window.__content.undoDepth(window.__content.view.state),
  }));
}
async function caret(pos) {
  await page.evaluate((anchor) => {
    const view = window.__content.view;
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    view.focus();
  }, pos);
}
async function undo() {
  await page.evaluate(() => window.__content.undo(window.__content.view));
}
async function replaceBody(text) {
  // Native contenteditable fill cannot reliably replace syntax hidden from the rendered DOM.
  await body().press("Control+a");
  await page.keyboard.insertText(text);
  assert.equal((await state()).text, text);
}
async function openLink(label) {
  await caret((await state()).text.length);
  await body().locator(".knowledge-inline-chip").filter({ hasText: label }).click();
  await popup().waitFor();
}
try {
  await page.goto(`${origin}/knowledge`);
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("笔记标题", { exact: true }).fill("代码与链接操作");
  await body().fill(fixture);
  await page.evaluate(async () => {
    const source = await fetch("/src/knowledge/editor/markdownEditor.ts").then((response) =>
      response.text(),
    );
    const url = (name) =>
      source.match(new RegExp(`from "([^"]*/@codemirror_${name}\\.js[^"]*)"`, "u"))[1];
    const { EditorView } = await import(url("view"));
    const { undo, undoDepth } = await import(url("commands"));
    const { EditorState, StateEffect, Prec } = await import(url("state"));
    window.__content = {
      view: EditorView.findFromDOM(document.querySelector('[aria-label="笔记正文"]')),
      undo,
      undoDepth,
      EditorState,
      StateEffect,
      Prec,
    };
  });
  await caret(fixture.length);
  assert.equal(await tools().count(), 2);
  await tools().first().getByLabel("代码块语言", { exact: true }).selectOption("typescript");
  assert.equal((await state()).text, fixture.replace("```js", "```typescript"));
  await undo();
  assert.equal((await state()).text, fixture);
  await caret(fixture.indexOf("参考") + 1);
  const keyboardSnapshot = await state();
  await body().press("Alt+Enter");
  await popup().waitFor();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await dialog().waitFor();
  assert.deepEqual(
    await state(),
    keyboardSnapshot,
    "keyboard link tools do not indent the document",
  );
  await page.keyboard.press("Escape");
  await caret(fixture.length);
  await page.evaluate(() => {
    window.__open = window.open;
    window.open = (url) => {
      window.__opened = url;
      return null;
    };
  });
  await body()
    .locator(".knowledge-inline-chip")
    .filter({ hasText: "参考" })
    .click({ modifiers: ["Control"] });
  assert.equal(await page.evaluate(() => window.__opened), "https://example.com/original");
  await page.evaluate(() => {
    window.open = window.__open;
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".knowledge-live-code span")].some(
      (span) =>
        span.textContent === "const" &&
        getComputedStyle(span).color !== getComputedStyle(span.parentElement).color,
    ),
  );
  const beforeCopy = await state();
  await tools().first().getByRole("button", { name: "复制代码", exact: true }).click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    'const total = 42;\n\nconsole.log("中文🙂", total);',
  );
  await tools().nth(1).getByRole("button", { name: "复制代码", exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "name: bcr\n");
  assert.deepEqual(await state(), beforeCopy);
  await tools().first().getByLabel("代码块语言", { exact: true }).selectOption("");
  assert.equal((await state()).text, fixture.replace("```js", "```text"));
  await undo();
  await page.evaluate(() => {
    window.__writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async () => {
      throw new Error("denied");
    };
  });
  await tools().first().getByRole("button", { name: "复制代码", exact: true }).click();
  await tools().first().getByRole("status").filter({ hasText: "复制失败" }).waitFor();
  await page.evaluate(() => {
    navigator.clipboard.writeText = window.__writeText;
  });

  await openLink("参考");
  const untouched = await state();
  await popup().getByRole("button", { name: "编辑", exact: true }).click();
  await dialog().getByLabel("链接目标", { exact: true }).fill("https://next.test/new");
  const cdp = await context.newCDPSession(page);
  await dialog().getByLabel("链接显示文字", { exact: true }).focus();
  await cdp.send("Input.imeSetComposition", { text: "中文", selectionStart: 2, selectionEnd: 2 });
  await dialog()
    .getByLabel("链接显示文字", { exact: true })
    .dispatchEvent("keydown", { key: "Enter", isComposing: true });
  assert.equal(await dialog().isVisible(), true);
  assert.deepEqual(await state(), untouched);
  await cdp.send("Input.insertText", { text: "中文" });
  await dialog().getByLabel("链接显示文字", { exact: true }).fill("参考");
  await dialog().getByRole("button", { name: "保存链接", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(
    (await state()).text,
    fixture.replace("https://example.com/original", "https://next.test/new"),
  );
  await undo();
  assert.equal((await state()).text, fixture);

  await openLink("引用");
  await popup().getByRole("button", { name: "编辑", exact: true }).click();
  await dialog().getByLabel("链接目标", { exact: true }).fill("https://new-reference.test");
  await dialog().getByRole("button", { name: "保存链接", exact: true }).click();
  assert.equal(
    (await state()).text,
    fixture.replace("[引用][ref]", '[引用](https://new-reference.test "Reference title")'),
  );
  await undo();
  await openLink("参考");
  await popup().getByRole("button", { name: "移除链接", exact: true }).click();
  assert.equal(
    (await state()).text,
    fixture.replace('[**参考**](<https://example.com/original> "保留标题")', "**参考**"),
  );
  await undo();
  await openLink("参考");
  await popup().getByRole("button", { name: "编辑", exact: true }).click();
  await dialog().getByLabel("链接目标", { exact: true }).fill("https://stale.test");
  await page.evaluate(() =>
    window.__content.view.dispatch({ changes: { from: 0, insert: "外部更新\n" } }),
  );
  const updated = (await state()).text;
  await dialog().getByRole("button", { name: "保存链接", exact: true }).click();
  await dialog().getByRole("alert").filter({ hasText: "正文或选区已变化" }).waitFor();
  assert.equal(
    await dialog().getByLabel("链接目标", { exact: true }).inputValue(),
    "https://stale.test",
  );
  assert.equal((await state()).text, updated);
  await dialog().getByRole("button", { name: "取消", exact: true }).click();

  await replaceBody("```unknown\n未闭合🙂\n");
  await caret((await state()).text.length);
  await tools().getByRole("button", { name: "复制代码", exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "未闭合🙂\n");
  assert.equal(await tools().getByLabel("代码块语言", { exact: true }).inputValue(), "unknown");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  assert.equal(await tools().count(), 0);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await replaceBody(fixture);
  await caret(fixture.length);
  await page.screenshot({
    path: `${shots}/knowledge-content-tools-desktop.png`,
    animations: "disabled",
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await openLink("参考");
    const box = await popup().boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
    await page.screenshot({
      path: `${shots}/knowledge-content-tools-mobile-${width}.png`,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await caret(30);
  await page.evaluate(() => {
    const { view, EditorState, StateEffect, Prec } = window.__content;
    view.dispatch({
      effects: StateEffect.appendConfig.of(Prec.highest(EditorState.readOnly.of(true))),
    });
  });
  await tools().first().getByLabel("代码块语言", { exact: true }).waitFor();
  assert.equal(await tools().first().getByLabel("代码块语言", { exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(
    "Knowledge content tools PASSED: lazy syntax highlighting, precise language edits/undo, nested and unclosed code copying, link popover/form fidelity, IME confirmation, stale targets, read-only and mobile.",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/knowledge-content-tools-failure.png`, animations: "disabled" })
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
