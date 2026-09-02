/* Reader Studio：书库 → 全文搜索 → Locator 进度 → 主题切换 → 刷新恢复。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

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
page.on("pageerror", (error) => fail(`pageerror: ${error.message}`));

await page.goto(base.toString(), { waitUntil: "domcontentloaded" });
await page.locator(".reader-studio").waitFor({ timeout: 20_000 });
await page.locator(".reader-book-card").first().waitFor({ timeout: 20_000 });
const body = await page.locator("body").innerText();
if (!body.includes("Reader Studio") || !body.includes("把时间还给阅读")) fail("阅读器主界面未渲染");
if ((await page.locator(".reader-book-card").count()) < 1) fail("书库未加载");
if ((await page.locator(".reader-section").count()) < 3) fail("演示出版物章节未加载");
if (!(await page.locator(".reader-sidebar-footer").innerText()).includes("OPFS"))
  fail("本地持久化状态未展示");
const searchClose = page.getByRole("button", { name: "关闭搜索结果" });
if ((await searchClose.count()) > 0) await searchClose.click();
const bookmarkButton = page.getByRole("button", { name: /标记当前位置|移除当前位置书签/ });
if ((await bookmarkButton.getAttribute("aria-label")) === "标记当前位置") {
  await bookmarkButton.click();
}
await page.locator(".reader-bookmark-list").waitFor({ timeout: 5_000 });
if ((await page.locator(".reader-bookmark-item").count()) < 1) fail("书签没有写入当前阅读会话");
if ((await page.locator(".reader-annotation-item").count()) === 0) {
  await page.getByRole("button", { name: "添加阅读笔记" }).click();
  await page.getByLabel("笔记内容").fill("验证阅读会话恢复");
  await page.getByRole("button", { name: "保存笔记" }).click();
}
await page.locator(".reader-annotation-list").waitFor({ timeout: 5_000 });
if ((await page.locator(".reader-annotation-item").count()) < 1) fail("阅读笔记没有写入当前会话");

const search = page.getByLabel("在书库中搜索");
await search.fill("Locator");
await page.locator(".reader-search-result").first().waitFor({ timeout: 10_000 });
if (!(await page.locator(".reader-search-result").first().innerText()).includes("下一页"))
  fail("全文搜索没有返回章节上下文");
await page.locator(".reader-search-result").first().click();
await page.waitForTimeout(250);
if (!(await page.locator(".reader-toolbar-title").innerText()).includes("第二章"))
  fail("搜索命中没有回到对应章节");

await page.getByRole("button", { name: "夜间" }).click();
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

await search.fill("Locator");
await page.locator(".reader-search-result").first().waitFor({ timeout: 10_000 });

await page.screenshot({ path: `${dir}/reader-studio.png`, fullPage: true });
await page.waitForTimeout(900);
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".reader-studio").waitFor({ timeout: 20_000 });
if (
  !(await page
    .locator(".reader-studio")
    .evaluate((element) => element.classList.contains("reader-theme-night")))
) {
  fail("刷新后阅读主题未恢复");
}
if ((await page.locator(".reader-bookmark-item").count()) < 1) {
  fail("刷新后阅读书签未恢复");
}
if ((await page.getByLabel("在书库中搜索").inputValue()) !== "Locator") {
  fail("刷新后搜索上下文未恢复");
}
if ((await page.locator(".reader-search-result").count()) < 1) {
  fail("刷新后搜索结果未恢复");
}
if ((await page.locator(".reader-annotation-item").count()) < 1) {
  fail("刷新后阅读笔记未恢复");
}

await browser.close();
console.log(
  process.exitCode ? "reader studio verification FAILED" : "reader studio verification PASSED",
);
