/* Manga Studio：单页导入 → 区域审校 → 翻译流水线 → PNG 导出。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

const base = new URL(process.env.BASE_URL ?? "http://localhost:5199/studio");
base.pathname = "/manga";
base.search = "";
const dir = new URL("./shots/", import.meta.url).pathname;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const browser = await launchVerifyBrowser("studio");
const page = browser.pages()[0] ?? (await browser.newPage());
page.on("pageerror", (error) => fail(`pageerror: ${error.message}`));

await page.goto(base.toString(), { waitUntil: "domcontentloaded" });
await page.locator(".manga-studio").waitFor({ timeout: 20_000 });
if (!(await page.locator("body").innerText()).includes("Manga Studio")) {
  fail("Manga Studio 主界面未渲染");
}
if ((await page.locator(".manga-region-row").count()) < 1) fail("演示页文本区域未加载");
if ((await page.locator(".manga-stage-row").count()) !== 9) fail("翻译流水线阶段不完整");

await page.getByRole("button", { name: "翻译当前页" }).click();
await page.waitForFunction(
  () =>
    document.querySelectorAll(".manga-stage-status").length === 9 &&
    [...document.querySelectorAll(".manga-stage-status")].every(
      (element) => element.textContent === "DONE",
    ),
  undefined,
  { timeout: 20_000 },
);
if (!(await page.locator(".manga-footer").innerText()).includes("pipeline complete")) {
  fail("流水线未完成");
}

await page.locator(".manga-region-row").first().click();
const textareas = page.locator("textarea");
if ((await textareas.count()) < 2) fail("文本区域 Inspector 未渲染");
await textareas.nth(1).fill("审校后的译文");
if ((await page.locator(".manga-page-card-detail").innerText()).includes("translated")) {
  fail("编辑译文后未标记为 needs review");
}

const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "导出当前页面" }).click();
const download = await downloadPromise;
if (!download.suggestedFilename().endsWith("-zh.png")) fail("PNG 导出文件名不正确");

await page.screenshot({ path: `${dir}/manga-studio.png`, fullPage: true });
await browser.close();
console.log(
  process.exitCode ? "manga studio verification FAILED" : "manga studio verification PASSED",
);
