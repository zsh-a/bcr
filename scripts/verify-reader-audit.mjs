import { openBookMenu } from "./lib/reader-library.mjs";
import assert from "node:assert/strict";
import { chromium, devices } from "playwright";
import { trackModuleRequests } from "./lib/modules.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch();
const errors = [];
async function attachAudit(page) {
  await page.evaluate(async () => {
    const urls = await window.__bcrTestModuleUrls();
    const source = (name) =>
      urls.find((url) => new URL(url).pathname.endsWith(`/packages/reader-studio/src/${name}`));
    window.readerAudit = await import(source("state/store.ts"));
    window.readerAuditContent = await import(source("content/readerContent.ts"));
    window.readerAuditPosition = await import(source("reading/readingPosition.ts"));
    window.readerAuditCapture = await import(source("navigation/readerCapture.ts"));
  });
}
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await trackModuleRequests(page);
  page.on("pageerror", (error) => errors.push(error.message));
  // Exercise the lightweight PWA navigation provider as well as the Reader UI.
  await page.goto(`${origin}/pwa/reader/`);
  await page.getByLabel("导入阅读文件").setInputFiles({
    name: "audit.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      [
        "第一章 开始",
        ...Array.from(
          { length: 80 },
          (_, index) => `${index} needle ${"山间的风吹过安静的阅读空间。".repeat(5)}`,
        ),
        "第二章 结束",
        "最后一段正文。",
      ].join("\n\n"),
    ),
  });
  await page.getByText("导入完成", { exact: true }).waitFor();
  await attachAudit(page);
  await page.evaluate(() => document.fonts.ready);
  assert.match(await page.locator(".reader-intro-kicker").innerText(), /2 章/u);
  assert.equal(
    await page
      .locator(".reader-section-label")
      .first()
      .evaluate((element) => getComputedStyle(element).display),
    "none",
  );
  const scroll = page.getByLabel("滚动正文", { exact: true });
  await scroll.focus();
  await page.keyboard.press("PageDown");
  assert((await scroll.evaluate((element) => element.scrollTop)) > 100);
  await page.keyboard.press("Home");
  assert.equal(await scroll.evaluate((element) => element.scrollTop), 0);

  await page.evaluate(() => {
    const { reader, getReaderState } = window.readerAudit;
    const book = getReaderState().library.at(-1);
    reader.openBook(book.id, book.sections[1].id);
    reader.openBook(book.id, book.sections[10].id);
  });
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => {
    const state = window.readerAudit.getReaderState();
    return state.activeSectionId === state.library.at(-1).sections[1].id;
  });
  const depth = await page.evaluate(() => history.state.bcrReaderPosition.depth);
  await page.reload();
  await page.getByLabel("滚动正文", { exact: true }).waitFor();
  await attachAudit(page);
  await page.getByRole("button", { name: "前进到跳转位置", exact: true }).click();
  await page.waitForFunction(() => {
    const state = window.readerAudit.getReaderState();
    return state.activeSectionId === state.library.at(-1).sections[10].id;
  });
  assert.equal(
    await page.evaluate(() => history.state.bcrReaderPosition.depth),
    depth + 1,
    "forward after reload did not consume browser history",
  );

  await page.keyboard.press("Control+f");
  await page.getByLabel("在书库中搜索", { exact: true }).fill("needle");
  await page.waitForFunction(
    () => document.querySelectorAll(".reader-search-result").length === 80,
  );
  assert.equal(
    await page.getByRole("button", { name: "加载更多搜索结果", exact: true }).count(),
    0,
  );
  assert.equal(await page.locator(".reader-search-result em mark").count(), 80);
  await page.locator(".reader-search-result").first().click();
  await page.locator(".reader-prose mark.is-current").first().waitFor();
  assert(
    (await page.locator(".reader-prose mark").count()) > 1,
    "visible neighboring sections should also highlight matches",
  );
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  await page.evaluate(() => window.readerAudit.reader.setSearchOpen(true));
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "阅读设置", exact: true }).waitFor({ state: "hidden" });
  assert(await page.locator(".reader-search-panel").isVisible(), "Escape closed both layers");
  await page.getByRole("button", { name: "关闭搜索结果", exact: true }).click();
  await page.evaluate(() => {
    const { reader } = window.readerAudit;
    reader.toggleBookmark();
    reader.addAnnotation("待修改的笔记");
    reader.setSearch("", [], null);
  });
  await page.getByRole("button", { name: "打开阅读目录", exact: true }).click();
  await page.getByRole("tab", { name: /书签/u }).click();
  await page.getByRole("button", { name: /^重命名书签 /u }).click();
  await page.getByLabel("书签名称", { exact: true }).fill("稍后重读");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.getByRole("tab", { name: /笔记/u }).click();
  await page.getByRole("button", { name: /^编辑笔记 /u }).click();
  await page.getByLabel("笔记内容", { exact: true }).fill("已经修改的笔记");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.getByRole("button", { name: "关闭阅读导航", exact: true }).click();
  assert(
    await page.evaluate(() =>
      Object.values(window.readerAudit.getReaderState().annotationsByBook)
        .flat()
        .some((note) => note.note === "已经修改的笔记"),
    ),
  );

  const deferred = await page.evaluate(async () => {
    const { getReaderState } = window.readerAudit;
    const book = getReaderState().library.at(-1);
    const section = book.sections[1];
    const prose = document.querySelector(`[data-reader-section="${section.id}"] .reader-prose`);
    const range = document.createRange();
    const node = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT).nextNode();
    range.setStart(node, 2);
    range.setEnd(node, 8);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    const cold = {
      ...book,
      sections: window.readerAuditContent.attachReaderContent(
        [{ ...section, text: "", contentInfo: { textLength: section.text.length } }],
        {
          async read() {
            return { text: section.text };
          },
        },
      ),
    };
    const result = await window.readerAuditPosition.loadReaderSelection(cold, (locator) =>
      window.readerAuditCapture.captureReaderSelection(cold, locator),
    );
    return { error: result.error, exact: result.value?.citation.exact };
  });
  assert(!deferred.error && deferred.exact?.includes("needle"), JSON.stringify(deferred));
  await page.evaluate(() => {
    const prose = [...document.querySelectorAll(".reader-section .reader-prose")];
    const range = document.createRange();
    const first = document.createTreeWalker(prose[1], NodeFilter.SHOW_TEXT).nextNode();
    const last = document.createTreeWalker(prose[2], NodeFilter.SHOW_TEXT).nextNode();
    range.setStart(first, 0);
    range.setEnd(last, 2);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  await page.getByRole("status").filter({ hasText: "暂不支持跨章节选段" }).waitFor();
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.evaluate(() => {
    const { reader, getReaderState } = window.readerAudit;
    const original = getReaderState().library.at(-1);
    reader.addBook({
      ...original,
      id: "missing-pdf",
      title: "缺源 PDF",
      toc: undefined,
      source: { name: "missing.pdf", format: "pdf", mime: "application/pdf", size: 1 },
      sections: [
        { id: "page-1", order: 0, kind: "pdf-page", label: "Page 1", text: "", pageNumber: 1 },
      ],
    });
  });
  await page.getByRole("button", { name: "重新导入 PDF", exact: true }).waitFor();
  assert.equal(await page.getByText("恢复 PDF…", { exact: true }).count(), 0);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["从正文拖入的文件"], "drop-audit.txt", { type: "text/plain" }));
    document
      .querySelector(".reader-reading-scroll")
      .dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
  });
  await page.getByRole("heading", { name: "drop-audit", exact: true }).waitFor();

  const touch = await browser.newContext({ ...devices["iPhone 13"] });
  const mobile = await touch.newPage();
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto(`${origin}/pwa/reader/`);
  await mobile.getByLabel("导入阅读文件").setInputFiles({
    name: "touch-delete.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("触屏删除入口"),
  });
  await mobile.getByText("导入完成", { exact: true }).waitFor();
  const sizes = await mobile
    .locator(".reader-mobile-toolbar-button:visible")
    .evaluateAll((buttons) =>
      buttons.map((button) => ({
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
      })),
    );
  assert(
    sizes.length === 2 && sizes.every((size) => size.width >= 44 && size.height >= 44),
    JSON.stringify(sizes),
  );
  await mobile.getByRole("button", { name: "打开书库", exact: true }).click();
  await (
    await openBookMenu(mobile, "touch-delete", { touch: true })
  )
    .getByRole("menuitem", { name: "移除读物…", exact: true })
    .click();
  await mobile.getByRole("button", { name: "确认移除读物", exact: true }).click();
  assert.equal(await mobile.getByRole("button", { name: "touch-delete", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Reader audit PASSED: PWA browser history, keyboard scrolling, layered Escape, search summaries, deferred/cross-section selections, note/bookmark editing, missing PDF recovery, global file drop and iPhone 13 touch targets/delete",
  );
} finally {
  await browser.close();
}
