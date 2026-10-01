import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const shots = ensureShots(),
  browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const url = new URL(process.env.BASE_URL ?? "http://localhost:5201/");
url.pathname = url.pathname.startsWith("/studio") ? "/quant" : url.pathname;
url.search = "?strategy=jsg";
const menu = async (name) => {
  await page.locator(".research-action-menu > summary").click();
  await page.getByRole("button", { name, exact: true }).click();
};
const downloaded = async (button) => {
  const event = page.waitForEvent("download");
  await button.click();
  return await event;
};
const runStudy = async (mode) => {
  const previous = await page
    .locator("[data-study-id]")
    .getAttribute("data-study-id")
    .catch(() => null);
  await menu("稳健性验证");
  await page.getByLabel("验证方式", { exact: true }).selectOption(mode);
  await page.getByRole("button", { name: "运行稳健性验证", exact: true }).click();
  await page.waitForFunction(
    (id) =>
      document.querySelector("[data-study-id]")?.getAttribute("data-study-id") !== id &&
      document.querySelector(".research-status")?.textContent.includes("稳健性验证完成"),
    previous,
    { timeout: 60_000 },
  );
};
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  const run = page.getByRole("button", { name: "运行回测", exact: true });
  await page.waitForFunction(() => !document.querySelector(".research-run-button")?.disabled);
  await run.click();
  await page.waitForFunction(
    () => document.querySelector(".research-status")?.textContent.includes("回测完成"),
    null,
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: /^数据质量/ }).click();
  const quality = page.getByRole("dialog", { name: "数据质量与研究假设", exact: true });
  await quality.waitFor();
  assert((await quality.innerText()).includes("宇宙格点覆盖率"));
  assert((await quality.innerText()).includes("获取时源数据最新日"));
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /^账本/ }).click();
  await page.getByLabel("持仓日期", { exact: true }).fill("2024-02-12");
  await page.locator(".research-insights .research-table tbody tr").first().waitFor();
  await page.getByLabel("账本视图", { exact: true }).selectOption("attribution");
  await page.getByRole("button", { name: "研究报告", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find((b) => b.textContent === "研究报告")?.disabled,
  );
  const csv = await downloaded(page.getByRole("button", { name: "账本 CSV", exact: true }));
  await csv.saveAs(`${shots}/jsg-ledger.csv`);
  assert(readFileSync(`${shots}/jsg-ledger.csv`, "utf8").includes("净盈亏"));
  const html = await downloaded(page.getByRole("button", { name: "研究报告", exact: true }));
  await html.saveAs(`${shots}/jsg-report.html`);
  assert(readFileSync(`${shots}/jsg-report.html`, "utf8").includes("行业归因与期末暴露"));
  await page.getByLabel("账本视图", { exact: true }).selectOption("risk");
  assert((await page.locator(".research-insights").innerText()).includes("63 日滚动观察"));
  await page.getByRole("tab", { name: "选股解释", exact: true }).click();
  await page.locator(".research-breadth-map button").first().waitFor();
  assert(
    (await page
      .locator(".research-breadth-map button")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)) !== "rgba(0, 0, 0, 0)",
  );
  await page.locator(".research-reason-summary").waitFor();
  await page.getByLabel("解释日期", { exact: true }).selectOption({ index: 0 });
  await page.waitForFunction(() =>
    document.querySelector(".research-reason-summary")?.textContent.includes("目标证券"),
  );
  assert((await page.locator(".research-reason-summary").innerText()).includes("目标证券"));
  assert((await page.locator(".research-insights .research-table tbody tr").count()) <= 50);
  await page.screenshot({ path: `${shots}/jsg-explanations.png`, fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  await page.screenshot({ path: `${shots}/jsg-research-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await runStudy("holdout");
  let id = await page.locator("[data-study-id]").getAttribute("data-study-id");
  assert(
    (await page.getByRole("region", { name: "稳健性验证结果" }).innerText()).includes("测试收益"),
  );
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出稳健性验证", exact: true }).click();
  await (await event).saveAs(`${shots}/jsg-validation.json`);
  const validation = JSON.parse(readFileSync(`${shots}/jsg-validation.json`, "utf8"));
  assert.equal(validation.result.folds.length, 1);
  assert(validation.result.folds[0].train.end < validation.result.folds[0].test.start);
  assert.equal(validation.result.costs.length, 4);
  assert.equal(validation.result.training.length, 4);
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(`[data-study-id="${id}"]`).waitFor();
  await runStudy("rolling");
  id = await page.locator("[data-study-id]").getAttribute("data-study-id");
  const rolling = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出稳健性验证", exact: true }).click();
  await (await rolling).saveAs(`${shots}/jsg-rolling.json`);
  const folds = JSON.parse(readFileSync(`${shots}/jsg-rolling.json`, "utf8")).result.folds;
  assert.equal(folds.length, 4);
  for (let i = 1; i < folds.length; i++) assert(folds[i - 1].test.end < folds[i].test.start);
  await menu("稳健性验证");
  await page.getByLabel("验证方式", { exact: true }).selectOption("holdout");
  await page.getByLabel("验证股票数候选", { exact: true }).fill("1,2,3,4,5,6,7,8");
  await page.getByLabel("验证止损候选", { exact: true }).fill("0,1,2,3,4,5,6,7");
  await page.getByRole("button", { name: "运行稳健性验证", exact: true }).click();
  await page.getByRole("button", { name: "取消研究任务", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false",
  );
  assert.equal(await page.locator("[data-study-id]").getAttribute("data-study-id"), id);
  await page.screenshot({ path: `${shots}/jsg-validation.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "JSG research browser verification PASSED: diagnostics, complete ledger/report, risk, historical breadth, candidate pagination, mobile, holdout, rolling, cost stress, reload and cancellation",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/jsg-research-failure.png`, fullPage: true })
    .catch(() => undefined);
  console.error(
    await page
      .locator(".jsg-workspace")
      .innerText()
      .catch(() => "unavailable"),
  );
  throw error;
} finally {
  await browser.close();
}
