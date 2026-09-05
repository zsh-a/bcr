/* 全局搜索走查：索引跨域投影、键盘呼出、结果筛选与深链导航。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

const base = process.env.BASE_URL ?? "http://localhost:5199/studio";
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const browser = await launchVerifyBrowser("studio");
const page = browser.pages()[0] ?? (await browser.newPage());
page.on("pageerror", (error) => fail(`pageerror: ${error.message}`));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1_500);
await page.getByRole("button", { name: "打开全局搜索" }).waitFor();

await page.getByRole("button", { name: "打开全局搜索" }).click();
const input = page.getByRole("textbox", { name: "全局搜索" });
await input.fill("Market Atlas");
await page.getByRole("option", { name: /Market Atlas/u }).waitFor();
await page.getByRole("option", { name: /Market Atlas/u }).click();
await page.waitForURL(/\/markets/u);

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.getByRole("button", { name: "打开全局搜索" }).click();
await input.fill("贵州茅台");
await page.getByRole("option", { name: /贵州茅台/u }).waitFor();
await page.getByRole("tab", { name: /市场/u }).click();
await page.getByRole("option", { name: /贵州茅台/u }).waitFor();
await page.getByRole("option", { name: /贵州茅台/u }).click();
await page.waitForURL(/\/markets\?instrument=/u);

// Visit Reader once so its hydrated publication projection is available to
// the shared index, then verify a section result carries a deep-link locator.
await page.getByRole("button", { name: "打开命令面板" }).click();
await page.getByPlaceholder("输入命令…").fill("打开 Reader Studio");
await page.getByRole("button", { name: /打开 Reader Studio/u }).click();
await page.waitForURL(/\/reader(?:\?|$)/u);
await page.getByLabel("阅读内容").waitFor();
// The last active book can come from a previous check, and the library is
// collapsed in focused mode. Verify the indexed fixture in the library.
const openLibrary = page.getByRole("button", { name: "打开书库", exact: true });
if (await openLibrary.isVisible()) await openLibrary.click();
await page.locator(".reader-book-card", { hasText: "把时间还给阅读" }).waitFor();
await page.waitForTimeout(1_200);
await page.getByRole("button", { name: "打开命令面板" }).click();
await page.getByPlaceholder("输入命令…").fill("打开 Studio 工作台");
await page.getByRole("button", { name: /打开 Studio 工作台/u }).click();
await page.waitForURL(/\/studio(?:\?|$)/u);
await page.getByRole("button", { name: "打开全局搜索" }).click();
await input.fill("轻量的内核");
await page.getByRole("option", { name: /轻量的内核/u }).waitFor();
await page.getByRole("option", { name: /轻量的内核/u }).click();
await page.waitForURL(/\/reader\?book=.*section=/u);
await page.getByText("第一章 · 轻量的内核").first().waitFor();

await browser.close();
console.log(
  process.exitCode ? "global search verification FAILED" : "global search verification PASSED",
);
