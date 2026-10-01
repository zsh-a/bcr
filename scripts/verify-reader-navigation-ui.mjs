import assert from "node:assert/strict";
import { launchEphemeralBrowser, collectPageErrors, ensureShots } from "./lib/browser.mjs";
import { requireFrom } from "./lib/paths.mjs";

const { BlobWriter, TextReader, ZipWriter } = requireFrom("reader")("@zip.js/zip.js");
async function publication() {
  const writer = new ZipWriter(new BlobWriter("application/epub+zip"));
  await writer.add("mimetype", new TextReader("application/epub+zip"));
  await writer.add(
    "META-INF/container.xml",
    new TextReader(
      '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
    ),
  );
  await writer.add(
    "book.opf",
    new TextReader(
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>层级导航验证</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
    ),
  );
  const entries = Array.from(
    { length: 180 },
    (_, i) =>
      `<li><a href="${i === 179 ? "two.xhtml" : `one.xhtml#part-${i + 1}`}">分节 ${String(i + 1).padStart(3, "0")}</a></li>`,
  ).join("");
  await writer.add(
    "nav.xhtml",
    new TextReader(
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml">第一卷</a><ol>${entries}</ol></li></ol></nav></body></html>`,
    ),
  );
  const body = Array.from(
    { length: 179 },
    (_, i) =>
      `<p id="part-${i + 1}">分节 ${String(i + 1).padStart(3, "0")}。${"在书页间停留，保持阅读的位置与节奏。".repeat(12)}</p>`,
  ).join("");
  await writer.add(
    "one.xhtml",
    new TextReader(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一卷</title></head><body><h1>第一卷</h1>${body}</body></html>`,
    ),
  );
  await writer.add(
    "two.xhtml",
    new TextReader(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>最后一节</title></head><body><h1>最后一节</h1><p>层级导航的终点。</p></body></html>',
    ),
  );
  return Buffer.from(await (await writer.close()).arrayBuffer());
}

const browser = await launchEphemeralBrowser({ headless: true });
const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const shots = ensureShots();
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const errors = collectPageErrors(page);
  await page.goto(`${origin}/reader`);
  await page.locator(".reader-toolbar").waitFor();
  assert.equal(await page.locator(".reader-progress-panel").isVisible(), false);
  await page.getByRole("button", { name: "打开书库", exact: true }).click();
  const quick = page.locator(".reader-library-quick");
  await quick.locator(".reader-book-card").first().waitFor();
  const card = await quick.locator(".reader-book-card").first().boundingBox();
  assert(card.y < 160, "books should be available directly below the compact header and search");
  assert.equal(await quick.locator(".reader-dropzone").count(), 0);
  assert.doesNotMatch(await quick.innerText(), /OPFS|FTS5|PARSER|LOCAL ONLY/u);
  await page.screenshot({ path: `${shots}/reader-quick-library.png` });
  await quick.getByRole("button", { name: "管理书库", exact: true }).click();
  const full = page.locator(".reader-library-full");
  await full.getByLabel("阅读状态筛选", { exact: true }).selectOption("unread");
  await full.getByLabel("书库排序", { exact: true }).selectOption("title");
  await full.getByRole("button", { name: "批量管理", exact: true }).click();
  await full.getByRole("button", { name: "选择当前列表", exact: true }).click();
  assert.match(await full.getByRole("status").innerText(), /已选择 1 本/u);
  await full.getByRole("button", { name: "取消选择", exact: true }).click();
  await full.getByRole("button", { name: "关闭书库管理", exact: true }).click();
  await quick.getByRole("button", { name: "收起书库", exact: true }).click();

  await page.getByRole("button", { name: "打开阅读目录", exact: true }).click();
  const drawer = page.locator(".reader-navigation-layer[open]");
  assert.equal(
    await drawer.evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  const row = drawer.locator(".reader-mobile-section-list button").first();
  const geometry = await row.evaluate((element) => ({
    display: getComputedStyle(element).display,
    align: getComputedStyle(element).textAlign,
    number: element.querySelector("span").getBoundingClientRect().right,
    title: element.querySelector("strong").getBoundingClientRect().left,
  }));
  assert.equal(geometry.display, "grid");
  assert.equal(geometry.align, "left");
  assert(geometry.number < geometry.title);
  await drawer.getByLabel("筛选章节", { exact: true }).fill("第二章");
  await drawer.getByRole("button", { name: "固定目录侧栏", exact: true }).click();
  const rail = page.locator(".reader-chapter-rail");
  await rail.waitFor();
  assert.equal(await rail.getByLabel("筛选章节", { exact: true }).inputValue(), "第二章");
  await rail.getByRole("tab", { name: /书签/u }).click();
  await rail.getByRole("button", { name: "取消固定目录", exact: true }).click();
  assert.equal(
    await drawer.getByRole("tab", { name: /书签/u }).getAttribute("aria-selected"),
    "true",
  );
  await drawer.getByRole("tab", { name: /目录/u }).click();
  assert.equal(await drawer.getByLabel("筛选章节", { exact: true }).inputValue(), "第二章");
  await drawer.getByRole("tab", { name: /目录/u }).press("ArrowRight");
  assert.equal(
    await drawer.getByRole("tab", { name: /书签/u }).getAttribute("aria-selected"),
    "true",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "打开阅读目录", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "打开阅读目录", exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );

  await page.getByLabel("导入阅读文件", { exact: true }).setInputFiles({
    name: "hierarchy.epub",
    mimeType: "application/epub+zip",
    buffer: await publication(),
  });
  await page.getByRole("heading", { name: "层级导航验证", exact: true }).waitFor();
  await page.locator(".reader-import-progress").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "打开阅读目录", exact: true }).click();
  await drawer.getByRole("button", { name: "展开 第一卷", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".reader-toc-tree.is-virtual [data-toc-index]"),
  );
  const tree = drawer.locator(".reader-toc-tree");
  assert(
    (await tree.locator("[data-toc-index]").count()) < 45,
    "hierarchical TOC should render a bounded window",
  );
  await tree.getByRole("button", { name: "第一卷", exact: true }).press("End");
  await page.waitForFunction(() => document.activeElement?.textContent?.includes("分节 180"));
  await drawer.getByLabel("筛选章节", { exact: true }).fill("分节 150");
  await tree.getByRole("button", { name: "分节 150", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("bcr-reader-fonts-ready")));
  await page.waitForFunction(() => {
    const target = document.getElementById("part-150");
    const scroll = document.querySelector(".reader-reading-scroll");
    if (!target || !scroll) return false;
    const a = target.getBoundingClientRect(),
      b = scroll.getBoundingClientRect();
    return a.top < b.bottom && a.bottom > b.top;
  });
  await page.getByRole("button", { name: "打开阅读目录", exact: true }).click();
  await drawer.getByLabel("筛选章节", { exact: true }).fill("分节 180");
  await tree.getByRole("button", { name: "分节 180", exact: true }).click();
  await page.getByRole("heading", { name: "最后一节", exact: true }).first().waitFor();
  await page.getByRole("button", { name: "打开阅读目录", exact: true }).click();
  await drawer.getByLabel("筛选章节", { exact: true }).fill("");
  await drawer.getByRole("button", { name: "固定目录侧栏", exact: true }).click();
  const handle = rail.getByRole("separator", { name: "调整阅读侧栏宽度", exact: true });
  await handle.focus();
  await handle.press("ArrowLeft");
  assert.equal(await handle.getAttribute("aria-valuenow"), "320");
  await page.waitForTimeout(450);
  await handle.blur();
  await page.screenshot({ path: `${shots}/reader-unified-navigation.png` });
  await page.reload();
  await rail.waitFor();
  assert.equal(await rail.getByRole("separator").getAttribute("aria-valuenow"), "320");
  await rail.getByRole("button", { name: "关闭阅读导航", exact: true }).click();

  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const mobileToc = page.getByRole("button", { name: "目录", exact: true });
    if (!(await mobileToc.isVisible()))
      await page.getByRole("button", { name: "显示阅读工具栏", exact: true }).click();
    await mobileToc.click();
    await drawer.waitFor();
    const box = await drawer.locator(".reader-navigation-sheet").boundingBox();
    assert(box.x >= 0 && box.x + box.width <= viewport.width + 1);
    assert(box.y >= 0 && box.y + box.height <= viewport.height + 1);
    await drawer.getByRole("button", { name: "关闭阅读导航", exact: true }).click();
    await page.getByRole("button", { name: "调整阅读进度", exact: true }).click();
    const panel = page.locator(".reader-progress-panel");
    await panel.waitFor();
    const panelBox = await panel.boundingBox();
    assert(panelBox.x >= 0 && panelBox.x + panelBox.width <= viewport.width + 1);
    assert(panelBox.y >= 0);
    await page.getByLabel("调整进度", { exact: true }).focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.getByLabel("调整进度", { exact: true }).getAttribute("aria-valuenow"),
      "0",
    );
    await page.keyboard.press("Escape");
    assert.equal(await panel.isVisible(), false);
    await page.getByRole("button", { name: "打开书库", exact: true }).click();
    const library = page.locator(".reader-library-sheet");
    await library.getByRole("button", { name: "管理书库", exact: true }).waitFor();
    await page.waitForTimeout(450);
    const actions = await library.locator(".reader-book-actions").first().boundingBox();
    assert(actions.width >= 44 && actions.height >= 44);
    await page.screenshot({ path: `${shots}/reader-mobile-library-${viewport.width}.png` });
    await library.getByRole("button", { name: "收起书库", exact: true }).click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
  console.log(
    "Reader navigation UI PASSED: compact library, transparent modal, shared navigation state, keyboard tabs, EPUB anchors, virtual tree, persisted rail width, mobile layout and seeking",
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${shots}/reader-navigation-failure.png` });
    console.error(
      await page.evaluate(() => ({
        section: document.querySelector(".reader-toolbar-title")?.textContent,
        anchor: document.getElementById("part-150")?.getBoundingClientRect().toJSON(),
        scroll: document.querySelector(".reader-reading-scroll")?.scrollTop,
        scrollBounds: document
          .querySelector(".reader-reading-scroll")
          ?.getBoundingClientRect()
          .toJSON(),
        targetIds: [...document.querySelectorAll('[id*="part-"]')]
          .slice(145, 151)
          .map((element) => element.id),
      })),
    );
  }
  throw error;
} finally {
  await browser.close();
}
