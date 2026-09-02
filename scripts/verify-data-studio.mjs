/* Data Studio：CSV / JSON / NDJSON → Worker 表格 Artifact → 搜索 / 排序 / 导出 / 刷新恢复。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

const base = new URL(process.env.BASE_URL ?? "http://localhost:5199/studio");
base.pathname = "/data";
base.search = "";
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const browser = await launchVerifyBrowser("data");
const page = browser.pages()[0] ?? (await browser.newPage());
page.on("pageerror", (error) => fail(`pageerror: ${error.message}`));

await page.goto(base.toString(), { waitUntil: "domcontentloaded" });
await page.locator(".data-studio").waitFor({ timeout: 20_000 });
if (!(await page.locator("body").innerText()).includes("Data Studio")) {
  fail("Data Studio 主界面未渲染");
}

const input = page.locator(".data-hidden-input");
await input.setInputFiles({
  name: "signals.json",
  mimeType: "application/json",
  buffer: Buffer.from(
    JSON.stringify([
      { date: "2026-09-01", symbol: "BCR", close: 12.5, active: true },
      { date: "2026-09-02", symbol: "BCR", close: 13.25, active: true },
      { date: "2026-09-03", symbol: "DATA", close: null, active: false },
    ]),
  ),
});
await page.locator(".data-main-heading h1", { hasText: "signals.json" }).waitFor({
  timeout: 20_000,
});
if (!(await page.locator(".data-stat").allInnerTexts()).some((text) => text.includes("3"))) {
  fail("JSON 数组没有解析为 3 行表格");
}
if (!(await page.locator(".data-schema-strip").innerText()).includes("NUMBER")) {
  fail("JSON 字段类型推断没有展示");
}
await page.locator("[aria-label='数据存储治理']").waitFor({ timeout: 10_000 });
if (!(await page.locator("[aria-label='数据存储治理']").innerText()).includes("DATA STORE")) {
  fail("Data Artifact 存储治理面板没有渲染");
}

const search = page.getByRole("textbox", { name: "搜索数据行" });
await search.fill("DATA");
if ((await page.locator(".data-table tbody tr").count()) !== 1) {
  fail("表格行搜索没有收敛到匹配结果");
}
await search.fill("");
await page.locator(".data-column-button", { hasText: "close" }).click();
if (!(await page.locator("th[aria-sort='ascending']").count())) {
  fail("点击列标题没有启用升序排序");
}

const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "JSON", exact: true }).click();
const download = await downloadPromise;
const stream = await download.createReadStream();
const chunks = [];
for await (const chunk of stream) chunks.push(chunk);
const bundle = JSON.parse(Buffer.concat(chunks).toString("utf8"));
if (bundle.version !== 1 || bundle.columns?.length !== 4) {
  fail("Canonical table JSON 导出契约不完整");
}

await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".data-main-heading h1", { hasText: "signals.json" }).waitFor({
  timeout: 20_000,
});
if (!(await page.locator(".data-table tbody tr").count())) fail("刷新后表格 Artifact 没有恢复");

await input.setInputFiles({
  name: "second.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify([{ symbol: "SECOND", score: 1 }])),
});
await page.locator(".data-main-heading h1", { hasText: "second.json" }).waitFor({
  timeout: 20_000,
});
if ((await page.locator(".data-asset-card").count()) !== 2) {
  fail("多资产导入没有保留资产目录历史");
}
await page.locator(".data-asset-card", { hasText: "signals.json" }).click();
await page.locator(".data-main-heading h1", { hasText: "signals.json" }).waitFor({
  timeout: 20_000,
});
await page.locator(".data-asset-card", { hasText: "second.json" }).click();
await page.locator(".data-main-heading h1", { hasText: "second.json" }).waitFor({
  timeout: 20_000,
});
await page.getByRole("button", { name: "清除", exact: true }).click();
await page.locator(".data-main-heading h1", { hasText: "signals.json" }).waitFor({
  timeout: 20_000,
});

const deepLink = new URL(base);
deepLink.searchParams.set("query", "DATA");
await page.goto(deepLink.toString(), { waitUntil: "domcontentloaded" });
await page.locator(".data-main-heading h1", { hasText: "signals.json" }).waitFor({
  timeout: 20_000,
});
if ((await search.inputValue()) !== "DATA") fail("Data Studio 没有应用 URL 搜索参数");
if ((await page.locator(".data-table tbody tr").count()) !== 1) {
  fail("Data Studio 深链搜索没有收敛到匹配结果");
}
await search.fill("");

await input.setInputFiles({
  name: "quoted.csv",
  mimeType: "text/csv",
  buffer: Buffer.from('name,value,note\nalpha,1,"hello, world"\nbeta,2,ok\n'),
});
await page.locator(".data-main-heading h1", { hasText: "quoted.csv" }).waitFor({
  timeout: 20_000,
});
if (!(await page.locator(".data-table").innerText()).includes("hello, world")) {
  fail("CSV 引号字段没有保留逗号内容");
}

await input.setInputFiles({
  name: "events.ndjson",
  mimeType: "application/x-ndjson",
  buffer: Buffer.from('{"event":"open","ok":true}\n{"event":"close","ok":false}\n'),
});
await page.locator(".data-main-heading h1", { hasText: "events.ndjson" }).waitFor({
  timeout: 20_000,
});
if ((await page.locator(".data-table tbody tr").count()) !== 2) {
  fail("NDJSON 没有解析为 2 行表格");
}
if (!(await page.locator(".data-schema-strip").innerText()).includes("BOOL")) {
  fail("NDJSON 布尔字段类型推断没有展示");
}
await page.getByRole("button", { name: "清除" }).click();
await page.locator(".data-main-heading h1", { hasText: "quoted.csv" }).waitFor({
  timeout: 20_000,
});
await page.getByRole("button", { name: "清除", exact: true }).click();
await page.locator(".data-main-heading h1", { hasText: "signals.json" }).waitFor({
  timeout: 20_000,
});
await page.getByRole("button", { name: "清除", exact: true }).click();
await page.locator(".data-empty-state").waitFor({ timeout: 10_000 });

await browser.close();
console.log(
  process.exitCode ? "data studio verification FAILED" : "data studio verification PASSED",
);
