import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5213").origin;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const fontRequests = new Set();
page.on("request", (request) => {
  if (/IBMPlexSansSC-|noto-serif-sc-/u.test(request.url())) fontRequests.add(request.url());
});
const titleText = "中文排版 Typography";
const bodyText =
  "# 清晰的层级\n\n中文阅读与英文 Reading，保持一致。\n\n## 整理思考\n\n### 一个观察";
const cdp = await page.context().newCDPSession(page);
await cdp.send("DOM.enable");
await cdp.send("CSS.enable");

async function fonts(selector) {
  await page.evaluate(() => document.fonts.ready);
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  assert.ok(nodeId, `font sample exists: ${selector}`);
  return (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
}

async function tools() {
  const menu = page.locator(".knowledge-tools-menu");
  const toggle = page.getByRole("button", { name: "更多写作工具", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return menu;
}

async function choose(group, label) {
  const menu = await tools();
  await menu
    .getByRole("group", { name: group, exact: true })
    .getByRole("button", { name: label, exact: true })
    .click();
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
}

async function proseMetrics() {
  return page.locator(".knowledge-prose").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      size: parseFloat(style.fontSize),
      leading: parseFloat(style.lineHeight),
      color: style.color,
      textColor: style.getPropertyValue("--color-text"),
      headings: [...element.querySelectorAll("h1, h2, h3")].map((heading) => {
        const headingStyle = getComputedStyle(heading);
        return { size: parseFloat(headingStyle.fontSize), weight: headingStyle.fontWeight };
      }),
    };
  });
}

try {
  await page.goto(`${origin}/knowledge`);
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("笔记标题", { exact: true }).fill(titleText);
  await page.getByLabel("笔记正文", { exact: true }).fill(bodyText);
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  const titleFonts = await fonts(".knowledge-title");
  const bodyFonts = await fonts(".knowledge-prose p");
  assert.ok(
    titleFonts.some((font) => font.isCustomFont && /IBMPlexSansSC/u.test(font.postScriptName)),
    "Chinese title uses the supplied Plex face",
  );
  assert.ok(
    bodyFonts.some((font) => font.isCustomFont && /IBMPlexSansSC/u.test(font.postScriptName)),
    "Chinese prose uses the supplied Plex face",
  );
  assert.ok(
    bodyFonts.some((font) => font.isCustomFont && font.postScriptName === "IBMPlexSans-Regular"),
    "Latin prose keeps Plex Sans",
  );
  assert.ok(
    ![...fontRequests].some((url) => /noto-serif-sc-/u.test(url)),
    "serif font is not requested by default",
  );
  assert.ok(fontRequests.size > 0 && fontRequests.size < 80, "only visible Chinese subsets load");
  assert.ok(
    [...fontRequests].every((url) => new URL(url).origin === origin),
    "fonts are self-hosted",
  );

  const titleSize = await page
    .locator(".knowledge-title")
    .evaluate((element) => getComputedStyle(element).fontSize);
  for (const [label, size] of [
    ["小", 16],
    ["大", 20],
    ["标准", 18],
  ]) {
    await choose("正文字号", label);
    const metrics = await proseMetrics();
    assert.equal(metrics.size, size);
    assert.ok(metrics.headings[0].size > metrics.headings[1].size);
    assert.ok(parseFloat(titleSize) > metrics.headings[0].size);
    assert.ok(metrics.headings[1].size > metrics.headings[2].size);
    assert.equal(metrics.headings[2].size, size, "H3 never becomes smaller than prose");
    assert.ok(metrics.headings.every((heading) => heading.weight === "600"));
    assert.equal(
      await page
        .locator(".knowledge-title")
        .evaluate((element) => getComputedStyle(element).fontSize),
      titleSize,
      "body size does not change the title",
    );
  }

  await choose("阅读字体", "衬线");
  await page.waitForFunction(() =>
    [...document.fonts].some(
      (font) => font.family.includes("Noto Serif SC") && font.status === "loaded",
    ),
  );
  assert.ok(
    (await fonts(".knowledge-prose p")).some(
      (font) => font.isCustomFont && /NotoSerifSC/u.test(font.postScriptName),
    ),
    "serif preference renders a real Chinese serif font",
  );
  assert.equal((await proseMetrics()).leading, 34.2);
  await choose("正文字号", "大");
  await choose("正文行高", "宽松");
  const noteUrl = page.url();
  await page.reload();
  await page.getByLabel("笔记标题", { exact: true }).waitFor();
  assert.equal(page.url(), noteUrl);
  assert.equal(await page.locator(".knowledge-editor").getAttribute("data-reading-font"), "serif");
  assert.equal(await page.locator(".knowledge-editor").getAttribute("data-reading-size"), "large");
  assert.equal(await page.locator(".knowledge-editor").getAttribute("data-reading-line"), "loose");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  assert.equal(
    await page
      .locator(".cm-content")
      .evaluate((element) =>
        [...element.querySelectorAll(".cm-line")].map((line) => line.textContent).join("\n"),
      ),
    bodyText,
  );
  assert.ok(
    (await fonts(".cm-line:nth-child(3)")).some((font) => /IBMPlexMono/u.test(font.postScriptName)),
    "source mode remains monospace",
  );
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  assert.equal((await proseMetrics()).size, 20);

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const matchesText = await page.locator(".knowledge-prose").evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-text)";
      element.append(probe);
      const same = getComputedStyle(element).color === getComputedStyle(probe).color;
      probe.remove();
      return same;
    });
    assert.ok(matchesText, `primary text contrast in ${theme} theme`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const sidebarHeading = await page
    .locator(".knowledge-sidebar-heading > span")
    .evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      leading: parseFloat(getComputedStyle(element).lineHeight),
    }));
  assert.ok(
    sidebarHeading.height <= sidebarHeading.leading + 1,
    "Chinese sidebar title stays on one line",
  );
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const menu = await tools();
    const bounds = await menu.boundingBox();
    assert.ok(
      bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
      `font settings fit at ${width}px`,
    );
    assert.ok(
      bounds.y >= 0 && bounds.y + bounds.height <= 844,
      "settings stay within the viewport",
    );
    await menu
      .getByRole("group", { name: "正文字号", exact: true })
      .getByRole("button", { name: "小", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    assert.equal((await proseMetrics()).size, 16);
  }
  assert.deepEqual(errors, []);
  console.log(
    "knowledge typography PASSED: real Chinese fonts, lazy subsets, heading hierarchy, persistent preferences, source mode, themes and mobile settings",
  );
} finally {
  await browser.close();
}
