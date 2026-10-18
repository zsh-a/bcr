import assert from "node:assert/strict";
import { collectPageErrors } from "./browser.mjs";

export async function verifyDirectMobile(browser, origin, imageData, shots) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage(),
      errors = collectPageErrors(page);
    page.setDefaultTimeout(15_000);
    await page.goto(`${origin}/knowledge`);
    await page.getByRole("button", { name: "写第一篇笔记", exact: true }).click();
    const body = page.getByLabel("笔记正文", { exact: true });
    const table =
      "| 项目 | 内容 |\n| --- | --- |\n| 中文🙂 | 比较长的单元格内容，可以自动换行 |\n| 空行 ||\n\n";
    await body.fill(table);
    await page.evaluate(async () => {
      const source = await fetch("/src/knowledge/editor/markdownEditor.ts").then((r) => r.text());
      const url = source.match(/from "([^"]*\/@codemirror_view\.js[^"]*)"/u)[1];
      const { EditorView } = await import(url);
      window.__mobileView = EditorView.findFromDOM(
        document.querySelector('[aria-label="笔记正文"]'),
      );
    });
    // Keep fixture initialization separate from the user's subsequent typing history.
    await page.waitForTimeout(650);
    await body
      .locator(".knowledge-live-table-row")
      .nth(1)
      .locator(".knowledge-table-cell")
      .first()
      .tap();
    await page.keyboard.insertText("触屏输入");
    const edited = await page.evaluate(() => window.__mobileView.state.doc.toString());
    assert.match(edited.split("\n")[2], /触屏输入/u);
    assert.equal(edited.split("\n")[3], "| 空行 ||");
    await body.press("Control+z");
    assert.equal(await page.evaluate(() => window.__mobileView.state.doc.toString()), table);
    await body.getByLabel("空单元格", { exact: true }).tap();
    await page.keyboard.insertText("空格输入");
    assert.match(
      await page.evaluate(() => window.__mobileView.state.doc.toString()),
      /\| 空行 \|空格输入\|/u,
    );
    await body.press("Control+z");
    assert.equal(await page.evaluate(() => window.__mobileView.state.doc.toString()), table);
    await page.evaluate((data) => {
      const view = window.__mobileView;
      view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
      view.focus();
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "手机图片.png", { type: "image/png" }));
      view.contentDOM.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
      );
    }, imageData);
    const options = body.getByRole("button", { name: "图片操作", exact: true });
    await options.waitFor();
    assert.equal(await options.evaluate((el) => getComputedStyle(el).opacity), "1");
    assert.ok((await options.boundingBox()).height >= 44);
    await options.tap();
    await page.getByRole("menuitem", { name: "图片设置", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "图片设置", exact: true });
    await dialog.getByLabel("图片说明", { exact: true }).fill("手机说明");
    await dialog.getByLabel("显示宽度", { exact: true }).fill("640");
    await dialog.getByRole("button", { name: "保存图片设置", exact: true }).tap();
    await dialog.waitFor({ state: "hidden" });
    await body.getByText("手机说明", { exact: true }).waitFor();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => {
        const view = window.__mobileView;
        view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
        view.focus();
      });
      const bounds = await body.locator(".knowledge-live-table-row").first().boundingBox();
      await page.screenshot({
        path: `${shots}/knowledge-direct-mobile-${width}.png`,
        animations: "disabled",
      });
      assert.ok(
        bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
        JSON.stringify({
          width,
          bounds,
          metrics: await page.evaluate(() => ({
            innerWidth,
            scrollX,
            viewport: visualViewport.width,
            body: document
              .querySelector('[aria-label="笔记正文"]')
              .getBoundingClientRect()
              .toJSON(),
            content: document.querySelector(".cm-content").getBoundingClientRect().toJSON(),
          })),
        }),
      );
      const controls = await body
        .getByRole("group", { name: "表格操作", exact: true })
        .boundingBox();
      assert.ok(controls.x >= 0 && controls.x + controls.width <= width + 1);
      for (const control of await body
        .locator(".knowledge-table-tools button, .knowledge-table-tools select")
        .all()) {
        const box = await control.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, "table controls retain touch target sizes");
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true,
      );
      await page.screenshot({
        path: `${shots}/knowledge-direct-mobile-${width}.png`,
        animations: "disabled",
      });
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
