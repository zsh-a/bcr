import assert from "node:assert/strict";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";
const url = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5206/");
url.pathname = "/markets";
url.search = "";
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(),
  errors = [],
  shots = ensureShots();
let releaseProbe;
page.on("pageerror", (e) => errors.push(e.message));
// Deterministic offline quotes exercise labelled fallback and don't depend on market hours.
await context.route("**/*", async (route) => {
  const request = new URL(route.request().url());
  if (/eastmoney|sina|sinajs|gtimg|qq\.com|xueqiu/u.test(request.hostname)) await route.abort();
  else await route.continue();
});
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.locator(".ma-overview-summary").waitFor();
  assert.equal(await page.locator(".ma-view-nav button").count(), 4);
  assert((await page.locator(".ma-header").boundingBox()).height <= 64);
  assert.equal(
    await page.locator(".ma-candle-chart").count(),
    0,
    "Overview must not render the detailed candlestick chart",
  );
  assert.equal(await page.locator("[data-dividend-ledger]").count(), 0);
  assert((await page.locator(".ma-data-stamp.demo").count()) > 0, "Demo source must be explicit");
  await page.getByRole("button", { name: "行业", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("view"), "sectors");
  assert.equal(
    await page.locator(".ma-sector-map button:disabled").count(),
    0,
    "Industry exploration must not depend on a leader",
  );
  await page.locator(".ma-sector-map button").first().click();
  await page.locator(".ma-sector-detail[open]").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "宽度", exact: true }).click();
  await page.getByRole("heading", { name: "历史行业宽度", exact: true }).waitFor();
  assert((await page.locator(".ma-content").innerText()).includes("无需先运行回测"));
  await page.getByRole("heading", { name: "尚未选择数据", exact: true }).waitFor();
  const heldProbe = new Promise((resolve) => {
    releaseProbe = resolve;
  });
  const holdProbe = async (route) => {
    await heldProbe;
    await route.abort().catch(() => {});
  };
  await context.route("http://localhost:8123/**", holdProbe);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "数据源", exact: true }).click();
  const sourceDialog = page.locator(".ma-source-dialog[open]");
  await sourceDialog.getByLabel("HTTP 地址", { exact: true }).fill("http://localhost:8123");
  await sourceDialog.getByRole("button", { name: "检查连接", exact: true }).click();
  await sourceDialog.locator(".ui-spinner").waitFor();
  const assertCompactLoading = async (expectedCount) => {
    const bounds = await page.locator(".ma-operation .ui-spinner").evaluateAll((spinners) =>
      spinners
        .filter((spinner) => spinner.offsetWidth > 0 && !spinner.closest("dialog:not([open])"))
        .map((spinner) => {
          const box = spinner.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
    );
    assert.equal(bounds.length, expectedCount);
    assert(
      bounds.every(({ width, height }) => width <= 24 && height <= 24),
      `Loading indicators must stay compact while rotating: ${JSON.stringify(bounds)}`,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  };
  await assertCompactLoading(2);
  await sourceDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator(".ma-breadth-view .ma-source-dialog").waitFor({ state: "hidden" });
  await assertCompactLoading(1);
  assert.equal(await page.locator(".ma-breadth-view").getAttribute("aria-busy"), "true");
  await page.screenshot({ path: `${shots}/market-breadth-loading.png`, fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await assertCompactLoading(1);
  await page.getByRole("button", { name: "数据源", exact: true }).click();
  await assertCompactLoading(2);
  await sourceDialog.getByRole("button", { name: "取消", exact: true }).click();
  await sourceDialog.locator(".ui-spinner").waitFor({ state: "hidden" });
  assert((await sourceDialog.innerText()).includes("已取消操作"));
  assert.equal(await page.locator(".ma-breadth-view").getAttribute("aria-busy"), "false");
  await sourceDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator(".ma-breadth-view .ma-source-dialog").waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "尚未选择数据", exact: true }).waitFor();
  releaseProbe();
  await context.unroute("http://localhost:8123/**", holdProbe);
  const failProbe = (route) =>
    route.fulfill({ status: 503, contentType: "text/plain", body: "测试数据源暂时不可用" });
  await context.route("http://localhost:8123/**", failProbe);
  await page.getByRole("button", { name: "数据源", exact: true }).click();
  await sourceDialog.getByRole("button", { name: "检查连接", exact: true }).click();
  await sourceDialog.locator(".ma-error").waitFor();
  await sourceDialog.locator(".ui-spinner").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".ma-breadth-view").getAttribute("aria-busy"), "false");
  assert(!(await sourceDialog.innerText()).includes("正在检查"));
  await sourceDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator(".ma-breadth-view .ma-source-dialog").waitFor({ state: "hidden" });
  await context.unroute("http://localhost:8123/**", failProbe);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "自选", exact: true }).click();
  await page.getByRole("button", { name: "新建分组", exact: true }).click();
  await page.getByLabel("分组名称", { exact: true }).fill("行业研究");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("heading", { name: "开始整理你的研究标的", exact: true }).waitFor();
  await page.getByRole("button", { name: "概览", exact: true }).click();
  await page.locator(".ma-quote-card .ma-card-star").first().click();
  await page.locator(".ma-quote-main").first().click();
  await page.locator(".ma-stock-detail[open]").waitFor();
  await page.locator(".ma-candle-chart").waitFor();
  const dialogBox = await page.locator(".ma-stock-detail").boundingBox();
  assert(dialogBox.x > 100 && dialogBox.y > 0, "Stock detail must use centered shared dialog");
  assert.equal(await page.getByRole("button", { name: /SMA|Quant/ }).count(), 0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "自选", exact: true }).click();
  assert.equal(await page.locator(".ma-watch-rows > div").count(), 1);
  assert.equal(await page.getByRole("button", { name: /在 Quant 分析组合/ }).count(), 0);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".ma-watch-rows > div").waitFor();
  assert.equal(await page.locator(".ma-watch-rows > div").count(), 1, "Watchlists still persist");
  await page.goto(new URL("/quant", url).toString(), { waitUntil: "networkidle" });
  await page.locator(".research-run-button:not(:disabled)").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".research-status")?.textContent.includes("回测完成"),
    null,
    { timeout: 60000 },
  );
  await page.getByRole("tab", { name: "选股解释", exact: true }).click();
  await page.locator(".ui-breadth-table button").first().waitFor();
  await page.getByRole("button", { name: "在 Market 查看", exact: true }).click();
  await page
    .locator(".ma-breadth-view .ui-breadth-table button")
    .first()
    .waitFor({ timeout: 60000 });
  assert(new URL(page.url()).searchParams.get("snapshot"));
  assert((await page.locator(".ma-breadth-view").innerText()).includes("科技"));
  await page.locator(".ma-breadth-view .ui-breadth-table button").first().click();
  assert((await page.locator(".ma-breadth-inspector").innerText()).includes("高于 MA20"));
  await page.screenshot({ path: `${shots}/market-breadth.png`, fullPage: true });
  const reference = new URL(page.url()).searchParams.get("snapshot");
  await page.reload({ waitUntil: "networkidle" });
  await page
    .locator(".ma-breadth-view .ui-breadth-table button")
    .first()
    .waitFor({ timeout: 60000 });
  assert.equal(new URL(page.url()).searchParams.get("snapshot"), reference);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    const bounds = await page.locator(".ma-header").boundingBox();
    assert(bounds.height <= 110);
    await page.getByRole("button", { name: "行业", exact: true }).click();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.getByRole("button", { name: "自选", exact: true }).click();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  await page.screenshot({ path: `${shots}/market-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "宽度", exact: true }).click();
  await page.getByLabel("选择冻结数据快照", { exact: true }).selectOption(reference);
  await page
    .locator(".ma-breadth-view .ui-breadth-table button")
    .first()
    .waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "在 Quant 研究", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".research-status")?.textContent.includes("已载入 Market 冻结快照"),
    null,
    { timeout: 60000 },
  );
  assert.equal(
    await page.locator(".ql-research-shell").getAttribute("data-strategy"),
    "jsg",
    "Kept-alive app must accept a Market snapshot",
  );
  assert.equal(
    new URL(page.url()).searchParams.get("snapshot"),
    null,
    "URL acknowledged only after successful dataset import",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Market architecture browser verification passed: navigation, sectors, compact loading, cancellation and errors, lazy details, retained watchlists, Rust breadth, frozen round trip, reload and mobile.",
  );
} catch (error) {
  console.error(
    "Market test failed at",
    page.url(),
    "body:",
    await page.locator("body").innerText(),
    "page errors:",
    errors,
  );
  throw error;
} finally {
  releaseProbe?.();
  await context.close();
  await browser.close();
}
