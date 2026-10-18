import assert from "node:assert/strict";
import { launchEphemeralBrowser, collectPageErrors, ensureShots } from "./lib/browser.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await launchEphemeralBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15_000);
const errors = collectPageErrors(page),
  shots = ensureShots();
const body = () => page.getByLabel("笔记正文", { exact: true });
const fixture =
  "# 即时排版\n\n普通 **加粗** 文字 *斜体* [链接](https://example.com) 和 `code`\n\n> 引用 **重点** 内容\n> - [ ] 引用任务\n\n```md\n**literal** [[not-a-note]]\n```\n\n[[missing-note|相邻双链]]\n\n结尾。";

async function state() {
  return page.evaluate(() => {
    const { view, undoDepth } = window.__writing;
    return {
      text: view.state.doc.toString(),
      head: view.state.selection.main.head,
      undo: undoDepth(view.state),
    };
  });
}
async function caret(position) {
  await page.evaluate((anchor) => {
    const { view } = window.__writing;
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    view.focus();
  }, position);
}
async function settle() {
  await page.waitForFunction(() => !window.__writing.view.compositionStarted);
  await page.waitForTimeout(160);
}
try {
  await page.goto(`${origin}/knowledge`);
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("笔记标题", { exact: true }).fill("即时排版写作");
  await body().fill(fixture);
  await page.evaluate(async () => {
    const { EditorView } = await import("/node_modules/.vite/deps/@codemirror_view.js");
    // Reuse Vite's versioned URL: a second module instance has different history StateFields.
    const module = await fetch("/src/knowledge/editor/markdownEditor.ts").then((response) =>
      response.text(),
    );
    const commandUrl = module.match(/from "([^"]*\/@codemirror_commands\.js[^"]*)"/u)?.[1];
    if (!commandUrl) throw new Error("CodeMirror commands module was not loaded");
    const { undoDepth, undo, redo } = await import(commandUrl);
    const view = EditorView.findFromDOM(document.querySelector('[aria-label="笔记正文"]'));
    window.__writing = { view, undoDepth, undo, redo };
  });
  const inline = body()
    .locator(".cm-line")
    .filter({ hasText: /^普通/u });
  await caret(fixture.indexOf("普通") + 1);
  assert.equal(await inline.innerText(), "普通 加粗 文字 斜体 链接 和 code");
  const untouched = await state();
  await caret(fixture.indexOf("加粗") + 1);
  assert.equal(await inline.innerText(), "普通 **加粗** 文字 斜体 链接 和 code");
  await body().press("ArrowLeft");
  await body().press("ArrowLeft");
  await body().press("ArrowLeft");
  await body().press("ArrowLeft");
  assert.equal(await inline.innerText(), "普通 加粗 文字 斜体 链接 和 code");
  await caret(fixture.indexOf("斜体") + 1);
  assert.equal(await inline.innerText(), "普通 加粗 文字 *斜体* 链接 和 code");
  assert.equal(
    (await state()).undo,
    untouched.undo,
    "presentation changes do not create undo entries",
  );
  assert.equal((await state()).text, fixture);

  await caret(fixture.indexOf("即时排版") + 2);
  assert.equal(await body().locator(".cm-line").first().innerText(), "即时排版");
  await body().press("Home");
  assert.equal(await body().locator(".cm-line").first().innerText(), "# 即时排版");
  await caret(fixture.indexOf("引用") + 1);
  const quote = body().locator(".knowledge-live-quote").first();
  assert.equal(await quote.innerText(), "引用 重点 内容");
  assert.ok((await quote.evaluate((node) => getComputedStyle(node).borderLeftWidth)) !== "0px");
  assert.equal(
    await body().locator(".knowledge-live-code").filter({ hasText: "**literal**" }).innerText(),
    "**literal** [[not-a-note]]",
  );
  assert.equal(
    await body().locator(".knowledge-inline-link").count(),
    1,
    "code examples do not become wiki widgets",
  );

  await body().getByRole("checkbox", { name: "任务勾选", exact: true }).click();
  assert.ok((await state()).text.includes("> - [x] 引用任务"));
  await page.evaluate(() => window.__writing.undo(window.__writing.view));
  assert.equal((await state()).text, fixture);

  const cdp = await page.context().newCDPSession(page);
  for (const label of ["加粗", "普通", "引用"]) {
    const pos = fixture.indexOf(label) + 1;
    await caret(pos);
    await page.waitForTimeout(600);
    await cdp.send("Input.imeSetComposition", {
      text: "zhong",
      selectionStart: 5,
      selectionEnd: 5,
    });
    await page.evaluate(() => {
      window.__compositionNode = getSelection().anchorNode;
      window.__neighbor = document.querySelector(".knowledge-inline-link");
    });
    await cdp.send("Input.imeSetComposition", { text: "中文", selectionStart: 2, selectionEnd: 2 });
    assert.equal(
      await page.evaluate(
        () =>
          window.__compositionNode.isConnected &&
          window.__compositionNode === getSelection().anchorNode,
      ),
      true,
      "IME text node stays connected",
    );
    assert.equal(
      await page.evaluate(
        () => window.__neighbor === document.querySelector(".knowledge-inline-link"),
      ),
      true,
      "neighbor widget remains stable during composition",
    );
    await cdp.send("Input.insertText", { text: "中文" });
    if (label === "普通") {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      assert.equal(
        await body().locator(".knowledge-inline-link, .knowledge-live-code").count(),
        0,
        "source mode wins over the composition settle guard",
      );
      await page.getByRole("button", { name: "编辑", exact: true }).click();
    }
    await settle();
    const committed = await state();
    assert.equal(committed.text, fixture.slice(0, pos) + "中文" + fixture.slice(pos));
    assert.equal(committed.head, pos + 2);
    await page.evaluate(() => window.__writing.undo(window.__writing.view));
    assert.equal((await state()).text, fixture, "one undo restores text after IME commit");
    await page.evaluate(() => window.__writing.redo(window.__writing.view));
    assert.equal((await state()).text, committed.text);
    await page.evaluate(() => window.__writing.undo(window.__writing.view));
  }
  await caret(fixture.indexOf("普通") + 1);
  await cdp.send("Input.imeSetComposition", { text: "cancel", selectionStart: 6, selectionEnd: 6 });
  await cdp.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
  await settle();
  assert.equal((await state()).text, fixture, "canceled preedit leaves no text");
  await caret(fixture.indexOf("斜体") + 1);
  assert.equal(
    await inline.innerText(),
    "普通 加粗 文字 *斜体* 链接 和 code",
    "preview resumes after composition",
  );

  await page.getByRole("button", { name: "源码", exact: true }).click();
  assert.equal(
    await body()
      .locator(".knowledge-live-quote, .knowledge-inline-link, .knowledge-live-code")
      .count(),
    0,
  );
  assert.equal((await state()).text, fixture);
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page.locator(".knowledge-prose blockquote strong").filter({ hasText: "重点" }).waitFor();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await caret(fixture.length);
  await page.screenshot({
    path: `${shots}/knowledge-live-writing-desktop.png`,
    animations: "disabled",
  });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({
    path: `${shots}/knowledge-live-writing-dark.png`,
    animations: "disabled",
  });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await caret(fixture.indexOf("普通") + 1);
    assert.equal(await inline.innerText(), "普通 加粗 文字 斜体 链接 和 code");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await page.screenshot({
      path: `${shots}/knowledge-live-writing-mobile-${width}.png`,
      animations: "disabled",
    });
  }
  for (const content of ["- > - [ ] 嵌套任务", "- - [ ] 双层任务"]) {
    await body().fill(content);
    await caret(content.length);
    await body().getByRole("checkbox", { name: "任务勾选", exact: true }).click();
    assert.equal((await state()).text, content.replace("[ ]", "[x]"));
    await page.evaluate(() => window.__writing.undo(window.__writing.view));
    assert.equal((await state()).text, content);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "插入附件", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "inline.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.waitForFunction(
    () => !document.querySelector('.knowledge-attachment-status:not([data-error="true"])'),
  );
  const attachment = (await state()).text.match(/attachment:([\w-]+)/u)?.[1];
  assert.ok(attachment);
  const imageNote = `普通 ![内联](attachment:${attachment}) **格式**\n\n![引用图片][image]\n\n[image]: attachment:${attachment}\n\n末尾`;
  await body().fill(imageNote);
  await caret(1);
  await body().locator(".knowledge-image-preview img").nth(1).waitFor();
  await caret(imageNote.indexOf("格式") + 1);
  assert.equal(
    await body().locator(".knowledge-image-preview img").count(),
    2,
    "editing neighboring prose keeps inline and reference image previews",
  );
  await caret(1);
  await cdp.send("Input.imeSetComposition", { text: "zhong", selectionStart: 5, selectionEnd: 5 });
  await cdp.send("Input.insertText", { text: "中" });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  assert.equal(
    await body().locator(".knowledge-image-preview img").count(),
    0,
    "source mode clears attachment widgets during IME settling",
  );
  await settle();
  assert.equal((await state()).text, imageNote.slice(0, 1) + "中" + imageNote.slice(1));
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await caret((await state()).text.length);
  await body().locator(".knowledge-image-preview img").nth(1).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Knowledge live writing PASSED: element reveal, delimiter boundaries, stable blocks, quoted tasks, native Chinese IME commit/cancel, undo/redo, mode fidelity and mobile.",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/knowledge-live-writing-failure.png`, animations: "disabled" })
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
