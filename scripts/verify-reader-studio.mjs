/* Reader Studio：书库 → 全文搜索 → Locator 进度 → 主题切换 → 刷新恢复。 */
import { createRequire } from "node:module";
import { launchVerifyBrowser } from "./verify-browser.mjs";

const require = createRequire(new URL("../apps/reader-studio/package.json", import.meta.url));
const { BlobWriter, TextReader, ZipWriter } = require("@zip.js/zip.js");

async function docxFixture() {
  const writer = new ZipWriter(
    new BlobWriter("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  );
  await writer.add(
    "word/document.xml",
    new TextReader(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>DOCX 自动化验证</w:t></w:r></w:p><w:p><w:r><w:t>来自 Word 的段落可以进入统一阅读模型。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`,
    ),
  );
  await writer.add(
    "docProps/core.xml",
    new TextReader(
      `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>DOCX 自动化验证</dc:title><dc:creator>Reader QA</dc:creator></cp:coreProperties>`,
    ),
  );
  const blob = await writer.close();
  return Buffer.from(await blob.arrayBuffer());
}

async function epubFixture() {
  const writer = new ZipWriter(new BlobWriter("application/epub+zip"));
  await writer.add("mimetype", new TextReader("application/epub+zip"));
  await writer.add(
    "META-INF/container.xml",
    new TextReader(
      `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
  );
  await writer.add(
    "EPUB/package.opf",
    new TextReader(
      `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">reader-epub-qa</dc:identifier><dc:title>EPUB 导航验证</dc:title><dc:creator>Reader QA</dc:creator><dc:language>zh-CN</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/><item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine></package>`,
    ),
  );
  await writer.add(
    "EPUB/nav.xhtml",
    new TextReader(
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapter-1.xhtml">第一章 · 入口</a><ol><li><a href="chapter-1.xhtml#idea">章内重点</a></li></ol></li><li><a href="chapter-2.xhtml">第二章 · 继续</a></li></ol></nav></body></html>`,
    ),
  );
  await writer.add(
    "EPUB/chapter-1.xhtml",
    new TextReader(
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章 · 入口</title></head><body><h1>第一章 · 入口</h1><p id="idea" style="font-weight:700;color:#234;position:fixed;font-size:11px;font-family:serif">EPUB 的章节内容可以通过出版物导航定位。</p><p><a href="chapter-2.xhtml#linked-note">跳转到第二章重点</a></p></body></html>`,
    ),
  );
  await writer.add(
    "EPUB/chapter-2.xhtml",
    new TextReader(
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章 · 继续</title></head><body><h1>第二章 · 继续</h1><p>目录和 Locator 保持同一条语义链路。</p><p id="linked-note">正文内部链接也应定位到对应章节和锚点。</p></body></html>`,
    ),
  );
  const blob = await writer.close();
  return Buffer.from(await blob.arrayBuffer());
}

function pdfFixture() {
  const contents = [
    "BT /F1 20 Tf 50 350 Td (Continuous page one) Tj ET",
    "BT /F1 20 Tf 50 350 Td (Continuous page two) Tj ET",
    "BT /F1 20 Tf 50 350 Td (Continuous page three) Tj ET",
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 6 0 R >> >> /Contents 8 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 6 0 R >> >> /Contents 9 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${contents[0].length} >>\nstream\n${contents[0]}\nendstream`,
    `<< /Length ${contents[1].length} >>\nstream\n${contents[1]}\nendstream`,
    `<< /Length ${contents[2].length} >>\nstream\n${contents[2]}\nendstream`,
    "<< /Type /Outlines /First 11 0 R /Last 12 0 R /Count 2 >>",
    "<< /Title (Page two) /Parent 10 0 R /Dest [4 0 R /Fit] /Next 12 0 R >>",
    "<< /Title (Page three) /Parent 10 0 R /Prev 11 0 R /Dest [5 0 R /Fit] >>",
  ];
  let raw = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(raw, "binary"));
    raw += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(raw, "binary");
  raw += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) raw += `${String(offset).padStart(10, "0")} 00000 n \n`;
  raw += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(raw, "binary");
}

function documentExportFixture() {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      content: {
        version: 1,
        id: "reader-export-browser-content",
        format: "markdown",
        sourceName: "reader-export-browser.md",
        metadata: { title: "Reader Export Bundle 验证" },
        blocks: [
          {
            id: "reader-export-browser-block",
            order: 0,
            kind: "heading",
            label: "Bundle 章节",
            text: "JSON Bundle 可以直接恢复为可搜索章节。",
          },
        ],
        provenance: {
          adapter: "browser.fixture",
          createdAt: 1,
          sourceHash: "reader-export-browser-hash",
        },
      },
    }),
  );
}

function preciseProgressFixture() {
  const paragraphs = Array.from(
    { length: 80 },
    (_, index) =>
      `<p id="progress-anchor-${index + 1}">精确进度验证第 ${String(index + 1).padStart(2, "0")} 段：文字锚点应在字体和视口发生变化后仍回到这里。</p>`,
  ).join("");
  return Buffer.from(
    `<!doctype html><html><head><title>精确进度恢复验证</title></head><body><h1>精确进度恢复验证</h1>${paragraphs}</body></html>`,
  );
}

const base = new URL(process.env.BASE_URL ?? "http://localhost:5199/studio");
base.pathname = "/reader";
base.search = "";
const dir = new URL("./shots/", import.meta.url).pathname;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const browser = await launchVerifyBrowser("studio");
const page = browser.pages()[0] ?? (await browser.newPage());
const cpuSlowdown = Number(process.env.BCR_VERIFY_CPU_SLOWDOWN ?? 1);
const cdp = await browser.newCDPSession(page);
if (cpuSlowdown > 1) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });
}
page.on("pageerror", (error) => fail(`pageerror: ${error.message}`));

await page.goto(base.toString(), { waitUntil: "domcontentloaded" });
await page.locator(".reader-studio").waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "打开书库", exact: true }).click();
await page.locator(".reader-book-card").first().waitFor({ timeout: 20_000 });
const demoCard = page.locator(".reader-book-card", { hasText: "把时间还给阅读" });
if ((await demoCard.count()) > 0) {
  await demoCard.first().click();
  await page.locator(".reader-reading-intro h1", { hasText: "把时间还给阅读" }).waitFor({
    timeout: 10_000,
  });
}
const body = await page.locator("body").innerText();
if (!body.includes("Reader Studio") || !body.includes("把时间还给阅读")) fail("阅读器主界面未渲染");
if ((await page.locator(".reader-book-card").count()) < 1) fail("书库未加载");
if ((await page.locator(".reader-section").count()) < 3) fail("演示出版物章节未加载");
if (
  await page
    .locator(".reader-section")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return style.contentVisibility !== "auto";
    })
) {
  fail("连续阅读没有启用原生 content-visibility 优化");
}
if (!(await page.locator(".reader-sidebar-footer").innerText()).includes("OPFS"))
  fail("本地持久化状态未展示");

const workspace = page.locator(".reader-workspace");
if (await workspace.evaluate((element) => element.classList.contains("sidebar-visible"))) {
  await page.getByRole("button", { name: "收起书库" }).first().click();
}
const openSidebar = page.getByRole("button", { name: "打开书库" });
await openSidebar.waitFor({ state: "visible", timeout: 5_000 });
await openSidebar.click();
await workspace.waitFor({ state: "attached" });
if (!(await workspace.evaluate((element) => element.classList.contains("sidebar-visible")))) {
  fail("书库收起后没有可用的打开按钮");
}

const fullscreenButton = page.getByRole("button", { name: "进入全屏" });
await fullscreenButton.waitFor({ state: "visible", timeout: 5_000 });
if (!(await fullscreenButton.isEnabled())) fail("阅读器全屏按钮在支持的浏览器中不可用");
await fullscreenButton.click();
await page.waitForFunction(
  () => document.fullscreenElement?.classList.contains("reader-main"),
  null,
  {
    timeout: 5_000,
  },
);
if ((await page.getByRole("button", { name: "退出全屏" }).count()) !== 1) {
  fail("进入全屏后没有切换为退出全屏操作");
}
await page.keyboard.press("Escape");
await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 5_000 });

// Mobile used to override the chosen size with a fixed 17px rule. Exercise the
// real settings sheet and computed EPUB/text styles so both CSS and state are covered.
await page.setViewportSize({ width: 390, height: 844 });
const closeMobileLibrary = page.getByRole("button", { name: "收起书库", exact: true }).first();
if (await closeMobileLibrary.isVisible()) {
  await closeMobileLibrary.click();
}
await page.getByRole("button", { name: "打开阅读设置" }).click();
const decreaseFontSize = page.getByRole("button", { name: "减小字号" });
for (let index = 0; index < 12 && (await decreaseFontSize.isEnabled()); index += 1) {
  await decreaseFontSize.click();
}
const minimumFontSize = Number.parseFloat(
  await page
    .locator(".reader-prose")
    .first()
    .evaluate((element) => getComputedStyle(element).fontSize),
);
await page.getByRole("button", { name: "增大字号" }).click();
await page.waitForFunction(
  (previous) =>
    Number.parseFloat(getComputedStyle(document.querySelector(".reader-prose")).fontSize) >
    previous,
  minimumFontSize,
);
await page.getByRole("button", { name: /Noto 宋体/ }).click();
const selectedFontFamily = await page
  .locator(".reader-prose")
  .first()
  .evaluate((element) => getComputedStyle(element).fontFamily);
if (!/(?:Georgia|Serif|Songti|STSong|SimSun)/iu.test(selectedFontFamily)) {
  fail("移动端正文字体选择没有应用到阅读内容");
}
await page.getByRole("button", { name: "Georgia" }).click();
const selectedLatinFontFamily = await page
  .locator(".reader-prose")
  .first()
  .evaluate((element) => getComputedStyle(element).fontFamily);
if (!selectedLatinFontFamily.startsWith("Georgia")) {
  fail("移动端英文字体选择没有应用到阅读内容");
}
await page.getByRole("button", { name: /Noto 黑体/ }).click();
await page.getByRole("button", { name: "Plex Sans" }).click();
await page.getByRole("button", { name: "增大字号" }).click();
await page.getByRole("button", { name: "增大字号" }).click();
await page.getByRole("button", { name: "关闭阅读设置" }).click();
await page.setViewportSize({ width: 1440, height: 900 });

// A long, single-section publication catches the old behavior that only
// restored a section start or a layout-dependent percentage. Capture a text
// quote, reflow it with a font change, then verify it again after reload.
await page.locator("input[type=file]").first().setInputFiles({
  name: "precise-progress.html",
  mimeType: "text/html",
  buffer: preciseProgressFixture(),
});
await page.locator(".reader-reading-intro h1", { hasText: "精确进度恢复验证" }).waitFor({
  timeout: 20_000,
});
const preciseAnchor = page.locator("#progress-anchor-55");
await page.waitForTimeout(800);
await preciseAnchor.evaluate((target) => {
  const container = target.closest(".reader-reading-scroll");
  if (!(container instanceof HTMLElement)) throw new Error("阅读滚动容器不存在");
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  container.scrollTo({
    top:
      container.scrollTop +
      targetRect.top -
      containerRect.top -
      Math.min(140, container.clientHeight * 0.32),
    behavior: "instant",
  });
  container.dispatchEvent(new Event("scroll"));
});
await page.waitForTimeout(1_100);
const persistedTextAnchor = await page.evaluate(() => {
  const raw = localStorage.getItem("bcr.reader.session.v1");
  if (raw === null) return null;
  const session = JSON.parse(raw);
  return session.progressByBook?.[session.activeBookId]?.locator?.textAnchor?.exact ?? null;
});
if (typeof persistedTextAnchor !== "string" || persistedTextAnchor.length === 0) {
  fail("自动阅读进度没有生成文字锚点");
}
await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
await page.getByRole("button", { name: "增大字号", exact: true }).click();
await page.getByRole("button", { name: "增大字号", exact: true }).click();
await page.getByRole("button", { name: "关闭阅读设置", exact: true }).click();
await page.waitForTimeout(800);
const preciseAnchorAfterReflow = await preciseAnchor.evaluate((target) => {
  const container = target.closest(".reader-reading-scroll");
  if (!(container instanceof HTMLElement)) return false;
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  return targetRect.bottom > containerRect.top && targetRect.top < containerRect.top + 320;
});
if (!preciseAnchorAfterReflow) fail("字号变化后没有通过文字锚点校准阅读位置");
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".reader-reading-intro h1", { hasText: "精确进度恢复验证" }).waitFor({
  timeout: 20_000,
});
await page.waitForTimeout(800);
const preciseAnchorAfterReload = await page.locator("#progress-anchor-55").evaluate((target) => {
  const container = target.closest(".reader-reading-scroll");
  if (!(container instanceof HTMLElement)) return false;
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  return targetRect.bottom > containerRect.top && targetRect.top < containerRect.top + 320;
});
if (!preciseAnchorAfterReload) fail("刷新后没有恢复到保存的精确文字位置");

// Reader can consume the canonical Document JSON bundle directly, without
// invoking a format parser. Keep this on the real file input so the same path
// is covered as a user dropping an exported package into the library.
await page.locator("input[type=file]").first().setInputFiles({
  name: "reader-export-browser.json",
  mimeType: "application/json",
  buffer: documentExportFixture(),
});
await page
  .locator(".reader-reading-intro h1", { hasText: "Reader Export Bundle 验证" })
  .waitFor({ timeout: 20_000 });
// Reload as soon as the book becomes visible. This covers mobile termination
// before the normal debounced snapshot has had 900 ms to run.
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".reader-studio").waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "打开书库", exact: true }).click();
await page
  .locator(".reader-book-card", { hasText: "Reader Export Bundle 验证" })
  .waitFor({ timeout: 20_000 });
await page
  .locator(".reader-reading-intro h1", { hasText: "Reader Export Bundle 验证" })
  .waitFor({ timeout: 20_000 });
if (!(await page.locator(".reader-reading-column").innerText()).includes("直接恢复为可搜索章节")) {
  fail("Reader 新增图书后立即重启没有恢复章节内容");
}
await page.locator(".reader-book-card", { hasText: "把时间还给阅读" }).first().click();
await page.locator(".reader-reading-intro h1", { hasText: "把时间还给阅读" }).waitFor({
  timeout: 10_000,
});
const searchClose = page.getByRole("button", { name: "关闭搜索结果" });
if ((await searchClose.count()) > 0) await searchClose.click();
await page.getByRole("button", { name: "打开阅读目录", exact: true }).click();
await page.getByRole("button", { name: "固定目录侧栏", exact: true }).click();
const bookmarkButton = page.getByRole("button", { name: /标记当前位置|移除当前位置书签/ });
if ((await bookmarkButton.getAttribute("aria-label")) === "标记当前位置") {
  await bookmarkButton.click();
}
await page.locator(".reader-bookmark-list").waitFor({ timeout: 5_000 });
if ((await page.locator(".reader-bookmark-item").count()) < 1) fail("书签没有写入当前阅读会话");
if ((await page.locator(".reader-annotation-item").count()) === 0) {
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  await page.getByRole("button", { name: "添加阅读笔记" }).click();
  await page.getByLabel("笔记内容").fill("验证阅读会话恢复");
  await page.getByRole("button", { name: "保存笔记" }).click();
}
await page.locator(".reader-annotation-list").waitFor({ timeout: 5_000 });
if ((await page.locator(".reader-annotation-item").count()) < 1) fail("阅读笔记没有写入当前会话");
await page
  .locator(".reader-prose")
  .first()
  .evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    if (text === null) throw new Error("正文没有可选择文本");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(12, text.textContent?.length ?? 1));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
await page.getByRole("button", { name: "添加阅读笔记" }).click();
if (!(await page.locator(".reader-annotation-composer").innerText()).includes("已锚定选段")) {
  fail("选中文本后新增笔记没有保存语义锚点");
}
await page.getByLabel("笔记内容").fill("验证选区锚点");
await page.getByRole("button", { name: "保存笔记" }).click();
await page
  .locator(".reader-annotation-list")
  .getByText("验证选区锚点")
  .first()
  .waitFor({ timeout: 5_000 });

const search = page.getByLabel("在书库中搜索");
await search.fill("Locator");
await page.locator(".reader-search-result").first().waitFor({ timeout: 10_000 });
if (!(await page.locator(".reader-search-result").first().innerText()).includes("下一页"))
  fail("全文搜索没有返回章节上下文");
await page.locator(".reader-search-result").first().click();
await page.waitForTimeout(250);
if (!(await page.locator(".reader-toolbar-title").innerText()).includes("第二章"))
  fail("搜索命中没有回到对应章节");
if ((await page.locator('[data-reader-search-match="true"]').count()) < 1)
  fail("搜索命中没有在正文高亮");

await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
await page.getByRole("button", { name: "夜间" }).click();
await page.getByRole("button", { name: "关闭阅读设置", exact: true }).click();
if (
  !(await page
    .locator(".reader-studio")
    .evaluate((element) => element.classList.contains("reader-theme-night")))
) {
  fail("夜间主题切换未生效");
}
const scroll = page.locator(".reader-reading-scroll");
await scroll.evaluate((element) => {
  element.scrollTop = element.scrollHeight;
  element.dispatchEvent(new Event("scroll"));
});
await page.waitForTimeout(500);
const progress = await page.locator(".reader-progress-ring").innerText();
if (progress === "0%") fail("阅读进度没有随滚动更新");
const progressBeforeReload = progress;

await search.fill("Locator");
await page.locator(".reader-search-result").first().waitFor({ timeout: 10_000 });

await page.screenshot({ path: `${dir}/reader-studio.png`, fullPage: true });
await page.waitForTimeout(900);
if ((await page.locator(".reader-progress-ring").innerText()) !== progressBeforeReload) {
  fail("打开搜索结果不应改写正文阅读进度");
}
// Keep this restore under CPU pressure even on fast developer machines: an
// early scroll flush used to overwrite the saved locator while the restored
// search panel was covering the text probes (82% became 100%).
await cdp.send("Emulation.setCPUThrottlingRate", { rate: Math.max(4, cpuSlowdown) });
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".reader-studio").waitFor({ timeout: 20_000 });
if (
  !(await page
    .locator(".reader-studio")
    .evaluate((element) => element.classList.contains("reader-theme-night")))
) {
  fail("刷新后阅读主题未恢复");
}
if ((await page.locator(".reader-progress-ring").innerText()) !== progressBeforeReload) {
  fail(
    `刷新后阅读进度未恢复：刷新前 ${progressBeforeReload}，刷新后 ${await page.locator(".reader-progress-ring").innerText()}`,
  );
  console.error(
    "Reader restore diagnostics:",
    await page.evaluate(() => {
      const session = JSON.parse(localStorage.getItem("bcr.reader.session.v1") ?? "{}");
      const scroll = document.querySelector(".reader-reading-scroll");
      return {
        activeBookId: session.activeBookId,
        progress: session.progressByBook?.[session.activeBookId],
        searchSession: session.searchSession,
        scrollTop: scroll?.scrollTop,
      };
    }),
  );
}
if ((await page.locator(".reader-bookmark-item").count()) < 1) {
  fail("刷新后阅读书签未恢复");
}
if ((await page.getByLabel("在书库中搜索").inputValue()) !== "Locator") {
  fail("刷新后搜索上下文未恢复");
}
if ((await page.getByLabel("在书库中搜索").inputValue()) === "Locator") {
  await page.locator(".reader-search-result").first().waitFor({ timeout: 10_000 });
}
if ((await page.locator(".reader-progress-ring").innerText()) !== progressBeforeReload) {
  fail("搜索结果恢复后改写了阅读进度");
}
await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });
if ((await page.locator(".reader-search-result").count()) < 1) {
  fail("刷新后搜索结果未恢复");
}
if ((await page.locator(".reader-annotation-item").count()) < 1) {
  fail("刷新后阅读笔记未恢复");
}

const docx = await docxFixture();
await page.locator("input[type=file]").first().setInputFiles({
  name: "reader-format-fixture.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: docx,
});
await page.locator(".reader-reading-intro h1", { hasText: "DOCX 自动化验证" }).waitFor({
  timeout: 20_000,
});
await page.locator(".reader-import-progress").waitFor({ state: "hidden", timeout: 20_000 });
const docxText = await page.locator(".reader-reading-column").innerText();
if (!docxText.includes("来自 Word 的段落") || !docxText.includes("表格 3")) {
  fail("DOCX 标题、正文或表格没有解析到统一阅读模型");
}

const epub = await epubFixture();
await page.locator("input[type=file]").first().setInputFiles({
  name: "reader-navigation-fixture.epub",
  mimeType: "application/epub+zip",
  buffer: epub,
});
await page.locator(".reader-reading-intro h1", { hasText: "EPUB 导航验证" }).waitFor({
  timeout: 20_000,
});
await page.locator(".reader-import-progress").waitFor({ state: "hidden", timeout: 20_000 });
if ((await page.locator(".reader-toc-item").count()) < 3) {
  fail("EPUB 出版物导航没有恢复层级目录");
}
const tocText = await page.locator(".reader-chapter-rail").innerText();
if (!tocText.includes("章内重点") || !tocText.includes("第二章 · 继续")) {
  fail("EPUB 导航标签没有渲染到目录栏");
}
const epubInlineStyle = await page.locator("#idea").getAttribute("style");
if (!epubInlineStyle?.includes("font-weight") || epubInlineStyle.includes("position")) {
  fail("EPUB 内联排版样式没有按安全白名单处理");
}
const epubTypography = await page.locator("#idea").evaluate((element) => {
  const prose = element.closest(".reader-prose");
  if (!(prose instanceof HTMLElement)) return null;
  const elementStyle = getComputedStyle(element);
  const proseStyle = getComputedStyle(prose);
  return {
    elementSize: elementStyle.fontSize,
    proseSize: proseStyle.fontSize,
    elementFamily: elementStyle.fontFamily,
    proseFamily: proseStyle.fontFamily,
  };
});
if (
  epubTypography === null ||
  epubTypography.elementSize !== epubTypography.proseSize ||
  epubTypography.elementFamily !== epubTypography.proseFamily
) {
  fail("EPUB 内嵌字号或字体覆盖了用户阅读设置");
}
await page.getByRole("link", { name: "跳转到第二章重点" }).click();
await page.waitForTimeout(700);
if (!(await page.locator(".reader-toolbar-title").innerText()).includes("第二章")) {
  fail("EPUB 正文跨章节链接没有更新当前章节");
}
if (!new URL(page.url()).pathname.endsWith("/reader")) {
  fail("EPUB 正文链接错误地离开了阅读器路由");
}
const epubLinkVisible = await page.locator("#linked-note").evaluate((target) => {
  const container = target.closest(".reader-reading-scroll");
  if (!(container instanceof HTMLElement)) return false;
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  return targetRect.bottom > containerRect.top && targetRect.top < containerRect.bottom;
});
if (!epubLinkVisible) {
  fail("EPUB 正文链接没有滚动到目标锚点");
}
await page.getByRole("button", { name: "第二章 · 继续" }).click();
if (!(await page.locator(".reader-toolbar-title").innerText()).includes("第二章")) {
  fail("EPUB 目录点击没有跳转到对应章节");
}

const pdf = pdfFixture();
await page.locator("input[type=file]").first().setInputFiles({
  name: "reader-continuous-fixture.pdf",
  mimeType: "application/pdf",
  buffer: pdf,
});
await page.locator(".reader-reading-intro h1", { hasText: "reader-continuous-fixture" }).waitFor({
  timeout: 20_000,
});
await page.locator(".reader-pdf-page").first().waitFor({ timeout: 20_000 });
if ((await page.locator(".reader-pdf-page").count()) !== 3) {
  fail("PDF 没有建立连续页面列表");
}
if ((await page.locator(".reader-toc-item").count()) !== 2) {
  fail("PDF 原生书签没有恢复为目录");
}
await page.getByRole("button", { name: /Page three/ }).click();
await page.waitForTimeout(700);
const pdfNavigation = await page.locator(".reader-reading-scroll").evaluate((element) => {
  const target = element.querySelectorAll(".reader-pdf-page")[2];
  if (target === undefined) return null;
  const containerRect = element.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  return {
    active: target.classList.contains("is-active"),
    relativeTop: targetRect.top - containerRect.top,
  };
});
if (pdfNavigation === null || !pdfNavigation.active || Math.abs(pdfNavigation.relativeTop) > 120) {
  fail("PDF 目录点击没有稳定跳转到目标页面");
}
await page.locator(".reader-reading-scroll").evaluate((element) => {
  element.scrollTop = 0;
  element.dispatchEvent(new Event("scroll"));
});
await page.waitForTimeout(260);
await page.getByRole("button", { name: /Page three/ }).click();
await page.waitForTimeout(700);
const repeatedPdfNavigation = await page.locator(".reader-reading-scroll").evaluate((element) => {
  const target = element.querySelectorAll(".reader-pdf-page")[2];
  if (target === undefined) return null;
  const containerRect = element.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  return {
    active: target.classList.contains("is-active"),
    relativeTop: targetRect.top - containerRect.top,
  };
});
if (
  repeatedPdfNavigation === null ||
  !repeatedPdfNavigation.active ||
  Math.abs(repeatedPdfNavigation.relativeTop) > 120
) {
  fail("重复点击 PDF 目录项没有重新定位到目标页面");
}
await page.locator(".reader-pdf-canvas-shell.is-ready").first().waitFor({ timeout: 20_000 });
const lastPdfPage = page.locator(".reader-pdf-page").last();
await lastPdfPage.scrollIntoViewIfNeeded();
await lastPdfPage.locator(".reader-pdf-canvas-shell.is-ready").waitFor({ timeout: 20_000 });
await page.locator(".reader-reading-scroll").evaluate((element) => {
  element.scrollTop = element.scrollHeight;
  element.dispatchEvent(new Event("scroll"));
});
await page.waitForTimeout(900);
if (!(await lastPdfPage.locator(".reader-pdf-page-meta").innerText()).includes("PAGE 003")) {
  fail("PDF 页面语义标识没有保留");
}
await page.waitForTimeout(1_200);
await page.locator(".reader-import-progress").waitFor({ state: "hidden", timeout: 20_000 });
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".reader-studio").waitFor({ timeout: 20_000 });
await page.locator(".reader-pdf-page").last().waitFor({ timeout: 20_000 });
await page.waitForTimeout(1_200);
if ((await page.locator(".reader-pdf-page.is-active").innerText()).includes("PAGE 003") === false) {
  fail("PDF 刷新后没有恢复最后阅读页面");
}

await browser.close();
console.log(
  process.exitCode ? "reader studio verification FAILED" : "reader studio verification PASSED",
);
