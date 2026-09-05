import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const base = new URL("/reader", process.env.BASE_URL ?? "http://localhost:5199").toString();
mkdirSync(new URL("./shots/", import.meta.url), { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(base);
  await page.locator(".reader-reading-scroll").waitFor();
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  await page.getByText("字体已就绪", { exact: false }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "应用舒适屏幕排版" }).getAttribute("aria-pressed"),
    "true",
  );
  assert(
    !requests.some((url) => /(?:noto-serif-sc|lxgwwenkai-regular).*\.woff2/.test(url)),
    "default screen preset loaded unselected fonts",
  );
  await page.getByRole("button", { name: "关闭阅读设置" }).click();
  const rhythm = await page
    .locator(".reader-section:has(.reader-prose :is(h1,h2))")
    .first()
    .evaluate((section) => {
      const prose = section.querySelector(".reader-prose");
      const heading = prose.querySelector("h1,h2");
      const body = getComputedStyle(prose);
      const title = getComputedStyle(heading);
      return {
        family: body.fontFamily,
        lineHeight: body.lineHeight,
        color: body.color,
        headingColor: title.color,
        headingSize: parseFloat(title.fontSize),
        size: parseFloat(body.fontSize),
        gap: parseFloat(getComputedStyle(section).marginBottom),
      };
    });
  assert(rhythm.family.startsWith('"IBM Plex Sans"'));
  assert.equal(rhythm.lineHeight, "34px");
  assert.equal(rhythm.headingColor, rhythm.color);
  assert(rhythm.headingSize <= rhythm.size * 1.31);
  assert(rhythm.gap <= 44);
  await page.screenshot({
    path: new URL("./shots/reader-comfort-desktop.png", import.meta.url).pathname,
  });
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  await page.getByRole("button", { name: "应用中文长文排版" }).click();
  await page.getByText("字体已就绪", { exact: false }).waitFor();
  assert(
    await page.evaluate(() =>
      document.fonts.check('400 20px "Noto Serif SC Variable"', "阅读中文"),
    ),
  );
  assert(
    !requests.some((url) => /lxgwwenkai-regular.*\.woff2/.test(url)),
    "unselected Chinese fonts loaded eagerly",
  );
  const preview = page.getByLabel("中英混排预览");
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: new URL("./shots/reader-typography-desktop.png", import.meta.url).pathname,
  });
  await page.getByLabel("正文字重", { exact: true }).selectOption("350");
  const lineHeight = page.getByRole("slider", { name: "正文行高" });
  await lineHeight.focus();
  await lineHeight.press("ArrowRight");
  assert.equal(await lineHeight.inputValue(), "1.8");
  await page.getByRole("button", { name: "关闭阅读设置" }).click();
  await page.reload();
  await page.locator(".reader-reading-scroll").waitFor();
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  assert.equal(await page.getByLabel("正文字重", { exact: true }).inputValue(), "350");
  assert.equal(await lineHeight.inputValue(), "1.8");
  await page.getByRole("button", { name: "关闭阅读设置" }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  const closeLibrary = page.getByRole("button", { name: "收起书库", exact: true }).first();
  if (await closeLibrary.isVisible()) await closeLibrary.click();
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  await page.getByRole("button", { name: "应用小说文学排版" }).click();
  await page.getByText("字体已就绪", { exact: false }).waitFor();
  assert(await page.getByLabel("正文字重", { exact: true }).isDisabled());
  const computed = await preview.locator(".reader-prose").evaluate((element) => {
    const style = getComputedStyle(element);
    return { font: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
  });
  assert(computed.font.includes("LXGW WenKai"));
  assert.equal(computed.size, "21px");
  assert.equal(computed.weight, "400");
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: new URL("./shots/reader-typography-mobile.png", import.meta.url).pathname,
  });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "mobile overflow",
  );
  await page.getByRole("button", { name: "应用技术资料排版" }).click();
  await page.getByText("字体已就绪", { exact: false }).waitFor();
  assert(
    await page.evaluate(() =>
      document.fonts.check('400 20px "Atkinson Hyperlegible Next Variable"', "Il1 O0"),
    ),
  );
  assert(!requests.some((url) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url)));
  await page.getByRole("button", { name: "恢复默认正文排版" }).click();
  assert.equal(
    await page.getByRole("button", { name: "应用舒适屏幕排版" }).getAttribute("aria-pressed"),
    "true",
  );
  await page.getByText("字体已就绪", { exact: false }).waitFor();
  await page.getByRole("button", { name: "关闭阅读设置" }).click();
  await page.screenshot({
    path: new URL("./shots/reader-comfort-mobile.png", import.meta.url).pathname,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "打开阅读设置", exact: true }).click();
  await page
    .getByRole("group", { name: "阅读主题", exact: true })
    .getByRole("button", { name: "夜间" })
    .click();
  const increase = page.getByRole("button", { name: "增大字号", exact: true });
  while (await increase.isEnabled()) await increase.click();
  await page.getByRole("button", { name: "关闭阅读设置" }).click();
  const night = await page
    .locator(".reader-section .reader-prose")
    .first()
    .evaluate((element) => {
      const luminance = (color) => {
        const channels = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((n) => {
            const s = n / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const foreground = luminance(getComputedStyle(element).color);
      const background = luminance(
        getComputedStyle(document.querySelector(".reader-studio")).backgroundColor,
      );
      return {
        contrast:
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        size: getComputedStyle(element).fontSize,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  assert(night.contrast >= 4.5, `night contrast ${night.contrast}`);
  assert.equal(night.size, "26px");
  assert.equal(night.overflow, false);
  await page.screenshot({
    path: new URL("./shots/reader-comfort-night.png", import.meta.url).pathname,
  });
  assert.deepEqual(errors, []);
  console.log("reader typography verification PASSED");
} finally {
  await browser.close();
}
