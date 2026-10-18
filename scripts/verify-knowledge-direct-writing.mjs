import assert from "node:assert/strict";
import { launchEphemeralBrowser, collectPageErrors, ensureShots } from "./lib/browser.mjs";
import { verifyDirectMobile } from "./lib/knowledge-direct-mobile.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await launchEphemeralBrowser();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  permissions: ["clipboard-read", "clipboard-write"],
});
page.setDefaultTimeout(15_000);
const errors = collectPageErrors(page),
  shots = ensureShots();
const body = () => page.getByLabel("笔记正文", { exact: true });
const outline = () => page.getByLabel("笔记大纲", { exact: true });
async function replace(text) {
  await body().press("Control+a");
  await page.keyboard.insertText(text);
  assert.equal(await page.evaluate(() => window.__direct.view.state.doc.toString()), text);
}
async function text() {
  return page.evaluate(() => window.__direct.view.state.doc.toString());
}
async function caret(anchor, head = anchor) {
  await page.evaluate(
    ({ anchor, head }) => {
      const { view } = window.__direct;
      view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
      view.focus();
    },
    { anchor, head },
  );
}
try {
  await page.goto(`${origin}/knowledge`);
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await body().fill("准备。");
  await page.evaluate(async () => {
    const source = await fetch("/src/knowledge/editor/markdownEditor.ts").then((r) => r.text());
    const url = (name) =>
      source.match(new RegExp(`from "([^"]*/@codemirror_${name}\\.js[^"]*)"`, "u"))[1];
    const { EditorView } = await import(url("view"));
    const { undo, redo } = await import(url("commands"));
    const { EditorState, StateEffect, Prec } = await import(url("state"));
    window.__direct = {
      view: EditorView.findFromDOM(document.querySelector('[aria-label="笔记正文"]')),
      undo,
      redo,
      EditorState,
      StateEffect,
      Prec,
    };
  });
  const section = "\n\n" + "正文内容。\n\n".repeat(55);
  const fixture = `# **相同标题**${section}# **相同标题**${section}末节\n====${section}结束。`;
  await replace(fixture);
  await page.getByRole("button", { name: "展开上下文栏", exact: true }).click();
  await outline().getByRole("button").nth(2).waitFor();
  for (const mode of ["编辑", "源码", "阅读"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    for (const index of [0, 1, 2]) {
      await page.evaluate(
        ({ index, fixture, mode }) => {
          const view = window.__direct.view;
          const positions = [0, fixture.indexOf("# **相同标题**", 1), fixture.indexOf("末节")];
          const pos = positions[index];
          let top;
          if (mode === "阅读")
            top = document.querySelector(`#note-heading-${pos}`).getBoundingClientRect().top;
          else top = view.documentTop + view.lineBlockAt(pos).top;
          let scroller =
            mode === "阅读" ? document.querySelector(".knowledge-prose") : view.scrollDOM;
          while (
            scroller &&
            !(
              scroller.scrollHeight > scroller.clientHeight + 2 &&
              /auto|scroll/.test(getComputedStyle(scroller).overflowY)
            )
          )
            scroller = scroller.parentElement;
          scroller ??= document.scrollingElement;
          scroller.scrollTop += top - innerHeight * 0.22;
        },
        { index, fixture, mode },
      );
      await page.waitForFunction((index) => {
        const buttons = [...document.querySelectorAll('[aria-label="笔记大纲"] button')].filter(
          (b) => b.getClientRects().length,
        );
        return buttons[index]?.getAttribute("aria-current") === "location";
      }, index);
    }
  }
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "关闭笔记信息", exact: true }).click();
  const table = "前文。\n\n| 项目 | 内容 |\n| :--- | ---: |\n| A\\|B | 原文 |\n|  |  |\n\n后文。";
  await replace(table);
  assert.equal(await body().locator(".knowledge-live-table-row").count(), 3);
  const tools = () => body().getByRole("group", { name: "表格操作", exact: true });
  await caret(table.indexOf("A\\|B"));
  await body().press("Tab");
  await page.keyboard.insertText("新内容");
  assert.equal(await text(), table.replace("原文", "新内容"));
  await page.evaluate(() => window.__direct.undo(window.__direct.view));
  assert.equal(await text(), table);
  await caret(table.indexOf("原文"), table.indexOf("原文") + 2);
  await page.waitForTimeout(650);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "zhong", selectionStart: 5, selectionEnd: 5 });
  await page.evaluate(() => {
    window.__cellNode = getSelection().anchorNode;
  });
  await cdp.send("Input.imeSetComposition", { text: "中文", selectionStart: 2, selectionEnd: 2 });
  assert.equal(
    await page.evaluate(
      () => window.__cellNode.isConnected && window.__cellNode === getSelection().anchorNode,
    ),
    true,
  );
  await cdp.send("Input.insertText", { text: "中文" });
  await page.waitForTimeout(180);
  assert.equal(await text(), table.replace("原文", "中文"));
  await page.evaluate(() => window.__direct.undo(window.__direct.view));
  assert.equal(await text(), table);
  await caret(table.indexOf("原文"));
  await page.waitForTimeout(650);
  await cdp.send("Input.imeSetComposition", { text: "取消", selectionStart: 2, selectionEnd: 2 });
  await cdp.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
  await page.waitForTimeout(180);
  assert.equal(await text(), table, "cancelled table IME leaves the original source intact");
  await tools().getByLabel("当前列对齐", { exact: true }).selectOption("center");
  assert.equal(await text(), table.replace("---:", ":---:"));
  await page.evaluate(() => window.__direct.undo(window.__direct.view));
  await tools().getByRole("button", { name: "在右侧插入列", exact: true }).click();
  assert.equal(
    await text(),
    table
      .replace("内容 |", "内容 |  |")
      .replace("---: |", "---: | --- |")
      .replace("原文 |", "原文 |  |")
      .replace("|  |  |", "|  |  |  |"),
  );
  await page.evaluate(() => window.__direct.undo(window.__direct.view));
  await caret(table.indexOf("|  |  |") + 5);
  await body().press("Tab");
  assert.equal(await text(), table.replace("\n\n后文", "\n|  |  |\n\n后文"));
  await page.evaluate(() => window.__direct.undo(window.__direct.view));
  await page.screenshot({
    path: `${shots}/knowledge-direct-tables-desktop.png`,
    animations: "disabled",
  });
  await replace("图片前文。\n\n图片后文。");
  await caret((await text()).length);
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#dce8e4";
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = "#24786a";
    ctx.fillRect(60, 60, 520, 240);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "插入附件", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "图片.png", mimeType: "image/png", buffer: Buffer.from(imageData, "base64") });
  await body().getByRole("button", { name: "图片操作", exact: true }).waitFor();
  const imageOriginal = await text();
  async function imageMenu(action) {
    await body().getByRole("button", { name: "图片操作", exact: true }).click();
    await page.getByRole("menuitem", { name: action, exact: true }).click();
  }
  await imageMenu("图片设置");
  const settings = () => page.getByRole("dialog", { name: "图片设置", exact: true });
  await settings().getByLabel("图片说明", { exact: true }).focus();
  await cdp.send("Input.imeSetComposition", { text: "说明", selectionStart: 2, selectionEnd: 2 });
  await settings()
    .getByLabel("图片说明", { exact: true })
    .dispatchEvent("keydown", { key: "Enter", isComposing: true });
  assert.equal(await settings().isVisible(), true);
  assert.equal(await text(), imageOriginal);
  await cdp.send("Input.insertText", { text: "说明" });
  await settings().getByLabel("图片说明", { exact: true }).fill("配置说明");
  await settings().getByLabel("显示宽度", { exact: true }).fill("320");
  await settings().getByRole("button", { name: "保存图片设置", exact: true }).click();
  await settings().waitFor({ state: "hidden" });
  const resized = await text();
  assert.match(resized, /!\[配置说明\]\(attachment:[\w-]+\?width=320\)/u);
  await body().getByText("配置说明", { exact: true }).waitFor();
  assert.equal(
    Math.round((await body().locator(".knowledge-image-preview").boundingBox()).width),
    320,
  );
  await page.evaluate(() => window.__direct.undo(window.__direct.view));
  assert.equal(await text(), imageOriginal);
  await page.evaluate(() => window.__direct.redo(window.__direct.view));
  assert.equal(await text(), resized);
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page.getByRole("article").getByText("配置说明", { exact: true }).waitFor();
  assert.equal(
    Math.round(
      (await page.locator(".knowledge-prose .knowledge-image-preview").boundingBox()).width,
    ),
    320,
  );
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page
    .locator(".knowledge-prose")
    .getByRole("button", { name: "图片操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "在图片前插入段落", exact: true }).click();
  await body().waitFor({ state: "visible" });
  await page.keyboard.insertText("阅读后落笔。");
  assert.ok((await text()).includes("阅读后落笔。\n\n![配置说明]"));
  await page.evaluate(() => {
    const { view, undo } = window.__direct;
    undo(view);
    undo(view);
  });
  assert.equal(await text(), resized);
  await imageMenu("在图片后插入段落");
  assert.equal(await text(), resized.replace(/(!\[配置说明\]\([^\n]+\))/u, "$1\n\n"));
  await page.keyboard.insertText("图片后落笔。");
  assert.ok((await text()).includes("图片后落笔。"));
  await caret(0);
  await imageMenu("图片设置");
  await settings().getByLabel("图片说明", { exact: true }).fill("保留输入");
  await page.evaluate(() =>
    window.__direct.view.dispatch({ changes: { from: 0, insert: "外部变化\n" } }),
  );
  const changed = await text();
  await settings().getByRole("button", { name: "保存图片设置", exact: true }).click();
  await settings().getByRole("alert").waitFor();
  assert.equal(await settings().getByLabel("图片说明", { exact: true }).inputValue(), "保留输入");
  assert.equal(await text(), changed);
  await settings().getByRole("button", { name: "取消", exact: true }).click();
  const navigation = "## 标题\n\n> 引用\n\n普通 **加粗🙂** [链接](https://example.com)";
  await replace(navigation);
  for (const [pos, expected] of [
    [3, navigation.replace("## ", "")],
    [navigation.indexOf("引用"), navigation.replace("> ", "")],
  ]) {
    await caret(pos);
    await body().press("Backspace");
    assert.equal(await text(), expected);
    await page.evaluate(() => window.__direct.undo(window.__direct.view));
    assert.equal(await text(), navigation);
  }
  await caret(navigation.indexOf("🙂") + 2);
  await body().press("Backspace");
  assert.equal(await text(), navigation.replace("🙂", ""));
  await page.evaluate(() => window.__direct.undo(window.__direct.view));
  await caret(navigation.indexOf("普通"), navigation.length);
  await body().press("Control+c");
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    navigation.slice(navigation.indexOf("普通")),
  );
  await body().press("Shift+F10");
  await page.getByRole("menuitem", { name: "复制纯文本", exact: true }).click();
  await page.waitForFunction(
    async () => (await navigator.clipboard.readText()) === "普通 加粗🙂 链接",
  );
  assert.equal(await text(), navigation);
  const selectionFixture = "正文不应保留。\n\n| A | B |\n| --- | --- |\n| x | y |";
  await replace(selectionFixture);
  await body().press("Control+a");
  await body().press("Enter");
  assert.equal(
    await text(),
    "\n",
    "whole-document replacement is not intercepted by table navigation",
  );
  await verifyDirectMobile(browser, origin, imageData, shots);
  await replace(table);
  await page.evaluate(() => {
    const { view, EditorState, StateEffect, Prec } = window.__direct;
    view.dispatch({
      effects: StateEffect.appendConfig.of(Prec.highest(EditorState.readOnly.of(true))),
    });
  });
  for (const button of await tools().getByRole("button").all())
    assert.equal(await button.isDisabled(), true);
  assert.equal(await tools().getByLabel("当前列对齐", { exact: true }).isDisabled(), true);
  assert.equal(await text(), table);
  assert.deepEqual(errors, []);
  console.log(
    "Knowledge direct writing PASSED: outline positions, table edits/IME/undo, image settings and stale guards, source/plain text copy, read-only tools and touch layouts.",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/knowledge-direct-writing-failure.png`, animations: "disabled" })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
