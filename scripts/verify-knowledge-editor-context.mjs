import assert from "node:assert/strict";
import { launchEphemeralBrowser, collectPageErrors, ensureShots } from "./lib/browser.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = collectPageErrors(page),
  shots = ensureShots();
const body = () => page.getByLabel("笔记正文", { exact: true });
const menu = () => page.getByRole("menu", { name: "正文操作", exact: true });
const item = (label) => menu().getByRole("menuitem", { name: label, exact: true });
// Inspect CM's state in the test harness, without adding product-side testing globals.
const read = () =>
  body().evaluate((el) => {
    const state = el.cmTile.root.view.state;
    return {
      text: state.doc.toString(),
      from: state.selection.main.from,
      to: state.selection.main.to,
    };
  });
async function select(from, to = from) {
  await body().evaluate(
    (el, range) => {
      const view = el.cmTile.root.view;
      view.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true });
      view.focus();
    },
    { from, to },
  );
}
async function right(pos, modifiers = []) {
  const point = await body().evaluate((el, offset) => {
    const coords = el.cmTile.root.view.coordsAtPos(offset);
    return { x: coords.left + 2, y: (coords.top + coords.bottom) / 2 };
  }, pos);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(point.x, point.y, { button: "right" });
  for (const key of modifiers.reverse()) await page.keyboard.up(key);
}
async function create(title, text) {
  const previous = new URL(page.url()).searchParams.get("note");
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("note") !== previous);
  await page.waitForFunction(() => document.querySelector('[aria-label="笔记标题"]')?.value === "");
  await page.getByLabel("笔记标题", { exact: true }).fill(title);
  await body().fill(text);
}
async function closeNotice() {
  await page.locator(".ui-toast").getByRole("button", { name: "关闭提示", exact: true }).click();
}
try {
  await page.goto(`${origin}/knowledge`);
  await page.getByRole("navigation", { name: "笔记列表", exact: true }).waitFor();
  await create("正文右键验证", "普通文字与链接。");

  await select(2, 4);
  await right(3);
  await menu().waitFor();
  await page.screenshot({ path: `${shots}/knowledge-editor-context.png` });
  assert.deepEqual(
    Object.values(await read()).slice(1),
    [2, 4],
    "right click inside a selection keeps it",
  );
  assert.equal(await menu().getByRole("menuitem").count(), 8);
  await item("复制").click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "文字");
  await right(3);
  await item("格式").focus();
  await page.keyboard.press("ArrowRight");
  await item("加粗").waitFor();
  await page.screenshot({ path: `${shots}/knowledge-editor-context-format.png` });
  await item("加粗").click();
  assert.equal((await read()).text, "普通**文字**与链接。");
  assert.deepEqual([(await read()).from, (await read()).to], [4, 6]);
  await body().press("Control+z");
  assert.equal((await read()).text, "普通文字与链接。");
  await body().press("Control+b");
  assert.equal(
    (await read()).text,
    "普通**文字**与链接。",
    "body shortcut formats instead of toggling the sidebar",
  );
  await body().press("Control+z");

  await select(2, 4);
  await right(8);
  assert.equal(
    (await read()).from,
    (await read()).to,
    "clicking outside the selection moves the caret",
  );
  await page.keyboard.press("Escape");
  await select(2, 4);
  await right(3, ["Shift"]);
  assert.equal(await menu().count(), 0, "Shift+right-click keeps the native menu");
  await page.keyboard.press("Escape");
  await select(2, 4);
  await body().press("Shift+F10");
  await item("格式").click();
  await item("加粗").waitFor();
  await page.keyboard.press("ArrowLeft");
  await item("剪切").waitFor();
  await item("剪切").click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="笔记正文"]').cmTile.root.view.state.doc.toString() ===
      "普通与链接。",
  );
  await body().press("Control+z");
  assert.equal((await read()).text, "普通文字与链接。");

  await select(2, 4);
  await page.evaluate(() => navigator.clipboard.writeText("替换内容"));
  await body().press("Shift+F10");
  await item("粘贴").click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="笔记正文"]').cmTile.root.view.state.doc.toString() ===
      "普通替换内容与链接。",
  );
  await body().press("Control+z");

  // Permission denial must retain text and provide a useful native shortcut.
  await page.evaluate(() => {
    window.savedClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
        writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
      },
    });
  });
  await select(2, 4);
  await body().press("Shift+F10");
  await item("剪切").click();
  await page.getByRole("status").filter({ hasText: "浏览器无法写入剪贴板" }).waitFor();
  assert.equal((await read()).text, "普通文字与链接。");
  await closeNotice();
  await body().press("Shift+F10");
  await item("粘贴").click();
  await page.getByRole("status").filter({ hasText: "浏览器无法读取剪贴板" }).waitFor();
  await closeNotice();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: window.savedClipboard,
    }),
  );

  // A pending cut cannot delete from the previous note after navigation.
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise((resolve) => {
            window.resolveCut = resolve;
          }),
      },
    }),
  );
  await select(2, 4);
  await body().press("Shift+F10");
  await item("剪切").click();
  await create("异步剪切导航", "新笔记内容");
  await page.evaluate(() => window.resolveCut());
  assert.equal((await read()).text, "新笔记内容");
  await page
    .getByRole("navigation", { name: "打开的笔记", exact: true })
    .getByRole("button", { name: "正文右键验证", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="笔记标题"]')?.value === "正文右键验证",
  );
  assert.equal((await read()).text, "普通文字与链接。");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: window.savedClipboard,
    }),
  );

  // A pending paste cannot replace a newer caret/document.
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: () =>
          new Promise((resolve) => {
            window.resolvePaste = resolve;
          }),
      },
    }),
  );
  await select(2, 4);
  await body().press("Shift+F10");
  await item("粘贴").click();
  await select(0);
  await page.evaluate(() => window.resolvePaste("迟到内容"));
  await page.getByRole("status").filter({ hasText: "正文或选区已变化" }).waitFor();
  assert.equal((await read()).text, "普通文字与链接。");
  await closeNotice();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: window.savedClipboard,
    }),
  );

  await select(2, 4);
  await body().press("Shift+F10");
  await item("插入").click();
  await item("链接…").click();
  const dialog = page.getByRole("dialog", { name: "插入链接", exact: true });
  await dialog.getByLabel("链接目标", { exact: true }).fill("https://example.com");
  await dialog.getByRole("button", { name: "插入链接", exact: true }).click();
  assert.equal((await read()).text, "普通[文字](https://example.com)与链接。");
  await right(4);
  await item("编辑链接…").click();
  const edit = page.getByRole("dialog", { name: "编辑链接", exact: true });
  await edit.getByLabel("链接目标", { exact: true }).fill("javascript:alert(1)");
  await edit.getByRole("button", { name: "保存链接", exact: true }).click();
  await edit.getByRole("alert").waitFor();
  await edit.getByLabel("链接目标", { exact: true }).fill("https://example.org");
  await edit.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(
    (await read()).text,
    "普通[文字](https://example.com)与链接。",
    "cancel never submits the form",
  );
  await right(4);
  await item("移除链接").click();
  assert.equal((await read()).text, "普通文字与链接。");
  await body().press("Control+z");

  await body().fill('[**参考**][r]\n\n[r]: https://example.com "提示"');
  await right(4);
  await item("编辑链接…").click();
  await edit.getByLabel("链接目标", { exact: true }).fill("https://next.test");
  await edit.getByRole("button", { name: "保存链接", exact: true }).click();
  assert.equal(
    (await read()).text,
    '[**参考**](https://next.test "提示")\n\n[r]: https://example.com "提示"',
  );

  const id = new URL(page.url()).searchParams.get("note");
  await create("关联正文", `[[${id}|参考笔记]]\n\n尾行。`);
  await select((await read()).text.length);
  const wiki = page.getByRole("button", { name: "打开关联笔记：正文右键验证", exact: true });
  await wiki.click({ button: "right" });
  await item("复制链接地址").click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    id,
    "wiki widget uses the same context actions",
  );
  await select((await read()).text.length);
  await body().press("Shift+F10");
  await item("插入").click();
  const chooser = page.waitForEvent("filechooser");
  await item("附件…").click();
  await (
    await chooser
  ).setFiles({ name: "右键附件.txt", mimeType: "text/plain", buffer: Buffer.from("上下文附件") });
  const attachment = page.locator(".knowledge-file-link").filter({ hasText: "右键附件.txt" });
  await attachment.waitFor();
  await attachment.click({ button: "right" });
  await page.getByRole("menu", { name: "附件操作", exact: true }).waitFor();
  assert.equal(await menu().count(), 0, "attachment menu takes precedence");
  await page.keyboard.press("Escape");
  await attachment.click({ button: "right", modifiers: ["Shift"] });
  assert.equal(await page.getByRole("menu", { name: "附件操作", exact: true }).count(), 0);
  await page.keyboard.press("Escape");

  await select((await read()).text.length);
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    canvas.getContext("2d").fillRect(0, 0, 2, 2);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
  await body().press("Shift+F10");
  await item("粘贴").click();
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="笔记正文"]')
      .cmTile.root.view.state.doc.toString()
      .includes("![剪贴板图片.png](attachment:"),
  );
  assert.equal(
    (await read()).from,
    (await read()).text.length,
    "the caret follows the attachment into the next line",
  );
  await page.getByRole("button", { name: "查看图片：剪贴板图片.png", exact: true }).waitFor();
  assert.match((await read()).text, /!\[剪贴板图片\.png\]\(attachment:/u);

  await body().fill("```js\nconst value = 1;\n```\n\n正文");
  await select(10);
  await body().press("Shift+F10");
  assert.equal(await item("格式").isDisabled(), true);
  await page.keyboard.press("Escape");
  await select(0, 3);
  let modelCalls = 0;
  page.on("request", (request) => {
    if (/chat\/completions|\/responses/u.test(request.url())) modelCalls++;
  });
  await body().press("Shift+F10");
  await item("询问 AI").click();
  const assistant = page.getByRole("dialog", { name: "AI 助手", exact: true });
  await assistant.waitFor();
  await assistant.getByRole("button", { name: "当前内容 ✓", exact: true }).waitFor();
  assert.equal(
    modelCalls,
    0,
    "asking AI opens the existing assistant without submitting a model request",
  );
  assert.deepEqual([(await read()).from, (await read()).to], [0, 3]);
  await assistant.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();

  // Read-only state retains only non-mutating context actions.
  await body().evaluate(async (el) => {
    const { Prec, EditorState, StateEffect } =
      await import("/node_modules/.vite/deps/@codemirror_state.js");
    const view = el.cmTile.root.view;
    view.dispatch({
      effects: StateEffect.appendConfig.of(Prec.highest(EditorState.readOnly.of(true))),
    });
  });
  await select(0, 3);
  await body().press("Shift+F10");
  assert.deepEqual(await menu().getByRole("menuitem").allTextContents(), [
    "复制Ctrl+C",
    "查找正文Ctrl+F",
  ]);
  const box = await menu().boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1440 && box.y + box.height <= 900);
  await page.screenshot({ path: `${shots}/knowledge-editor-context-readonly.png` });
  await page.keyboard.press("Escape");

  // Touch text selection keeps the platform menu. Keyboard users still have Shift+F10.
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  const mobileErrors = collectPageErrors(mobile);
  await mobile.goto(`${origin}/knowledge`);
  await mobile.getByRole("button", { name: "切换笔记列表", exact: true }).click();
  await mobile
    .getByRole("dialog", { name: "笔记库", exact: true })
    .getByRole("button", { name: "新建笔记", exact: true })
    .click();
  const mobileBody = mobile.getByLabel("笔记正文", { exact: true });
  await mobileBody.fill("移动端原生选区");
  const prevented = await mobileBody.evaluate((el) => {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 150,
      clientY: 250,
    });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(prevented, false);
  assert.equal(await mobile.getByRole("menu", { name: "正文操作", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(mobileErrors, []);
  await mobileContext.close();
  console.log(
    "PASS: knowledge editor context — selection, keyboard, clipboard, links, attachments, AI, read-only, touch",
  );
} finally {
  await context.close();
  await browser.close();
}
