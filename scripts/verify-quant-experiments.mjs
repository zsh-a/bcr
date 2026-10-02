import assert from "node:assert/strict";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const shots = ensureShots(),
  browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const url = process.env.BASE_URL ?? "http://127.0.0.1:5297/quant";
const ready = () =>
  page.waitForFunction(
    () =>
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false" &&
      !document.querySelector(".research-run-button")?.disabled,
  );
const menu = async (name) => {
  await page.locator(".research-action-menu > summary").click();
  await page.getByRole("button", { name, exact: true }).click();
};
const runId = () => page.locator(".research-run-result").getAttribute("data-run-id");
const run = async () => {
  const old = (await page.locator(".research-run-result").count()) ? await runId() : null;
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(".research-run-result")?.getAttribute("data-run-id") &&
      document.querySelector(".research-run-result")?.getAttribute("data-run-id") !== id,
    old,
  );
  await ready();
};
const create = async (type, name) => {
  await page.getByRole("button", { name: type, exact: true }).click();
  await page.getByLabel("研究名称", { exact: true }).fill(name);
  await page.getByRole("button", { name: "创建", exact: true }).click();
};
try {
  await page.goto(url, { waitUntil: "networkidle" });
  await ready();
  await run();
  const first = await runId();
  for (const count of [6, 8]) {
    await menu("参数实验");
    await page.getByLabel("目标股票数候选值", { exact: true }).fill(String(count));
    await page.getByLabel("个股止损候选值", { exact: true }).fill("0");
    const grid = page.locator(".research-grid-results");
    const prior = (await grid.count()) ? await grid.getAttribute("data-grid-id") : null;
    await page.getByRole("button", { name: "运行参数实验", exact: true }).click();
    await page.waitForFunction(
      (id) =>
        document.querySelector(".research-grid-results")?.getAttribute("data-grid-id") &&
        document.querySelector(".research-grid-results")?.getAttribute("data-grid-id") !== id,
      prior,
    );
    await ready();
  }
  assert.equal(await page.locator('[data-entry-kind="grid"]').count(), 2);
  await menu("稳健性验证");
  await page.getByLabel("验证方式").selectOption("cost");
  await page.getByRole("button", { name: "运行稳健性验证", exact: true }).click();
  await page.locator("[data-study-id]").waitFor();
  await ready();
  assert.equal(await page.locator('[data-entry-kind="study"]').count(), 1);
  await create("新建项目", "策略比较");
  await create("新建实验", "动量强弱");
  await page.getByRole("button", { name: "收藏实验 动量强弱", exact: true }).click();
  await page.locator(".research-experiment-details > summary").click();
  await page.getByLabel("实验标签", { exact: true }).fill("动量, 日频");
  await page.getByLabel("研究备注", { exact: true }).fill("比较不同观察周期的稳定性");
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  await page.getByLabel("研究策略", { exact: true }).selectOption("momentum");
  await page.getByLabel("动量观察周期", { exact: true }).fill("10");
  await page.getByRole("button", { name: "使用设置运行", exact: true }).click();
  await page.locator(".research-run-result").waitFor();
  await ready();
  const momentumId = await runId();
  assert.notEqual(momentumId, first);
  await page.getByRole("button", { name: `设为基线 ${momentumId}`, exact: true }).click();
  await page.locator(".research-context > summary").click();
  assert((await page.locator(".research-context").innerText()).includes("策略不使用财务筛选"));
  assert((await page.locator(".research-context").innerText()).includes("momentum-1"));
  await page.getByRole("tab", { name: "选股解释", exact: true }).click();
  await page.getByRole("columnheader", { name: "区间动量", exact: true }).waitFor();
  await page.screenshot({ path: `${shots}/quant-experiment-momentum.png`, fullPage: true });
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  await page.getByLabel("动量观察周期", { exact: true }).fill("15");
  await page.getByRole("button", { name: "使用设置运行", exact: true }).click();
  await page.waitForFunction(
    (id) => document.querySelector(".research-run-result")?.getAttribute("data-run-id") !== id,
    momentumId,
  );
  await ready();
  await page.getByRole("button", { name: "对比基线", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".research-result-context")?.textContent?.includes("对照 1"),
  );
  await page.getByRole("button", { name: "取消收藏 动量强弱", exact: true }).waitFor();
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "networkidle" });
  await ready();
  assert.equal(
    await page.getByLabel("研究项目", { exact: true }).inputValue(),
    await page
      .getByLabel("研究项目", { exact: true })
      .locator("option")
      .filter({ hasText: "策略比较" })
      .getAttribute("value"),
  );
  assert.equal(await page.locator(".research-baseline-label").count(), 1);
  await page.locator(".research-experiment-details > summary").click();
  assert.equal(
    await page.getByLabel("研究备注", { exact: true }).inputValue(),
    "比较不同观察周期的稳定性",
  );
  assert.equal(await page.getByLabel("实验标签", { exact: true }).inputValue(), "动量, 日频");
  await page.getByLabel("研究项目", { exact: true }).selectOption({ label: "我的研究" });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-entry-kind="grid"]').length === 2,
  );
  await ready();
  assert.equal(await page.locator('[data-entry-kind="study"]').count(), 1);
  await page.locator('[data-entry-kind="grid"]').first().click();
  await page.locator(".research-grid-results").waitFor();
  await page.locator(".research-grid-table").waitFor();
  await page.screenshot({ path: `${shots}/quant-experiment-library.png`, fullPage: true });
  await menu("数据与存储");
  await page.getByRole("button", { name: "清理未使用数据", exact: true }).click();
  await page.getByRole("button", { name: "确认清理", exact: true }).click();
  await ready();
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "networkidle" });
  await ready();
  assert.equal(await page.locator('[data-entry-kind="grid"]').count(), 2);
  await page.locator('[data-entry-kind="study"]').first().click();
  await page.locator("[data-study-id]").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.querySelector(".jsg-workspace")?.getAttribute("data-library-open") === "false",
  );
  await page.getByRole("button", { name: "研究目录", exact: true }).click();
  assert(await page.getByRole("complementary", { name: "研究目录" }).isVisible());
  await menu("参数实验");
  assert.equal(await page.getByRole("complementary", { name: "研究目录" }).count(), 0);
  await page.getByRole("dialog", { name: "参数实验", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "研究目录", exact: true }).click();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: `${shots}/quant-experiment-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS Quant projects, archived grids/studies, momentum, baseline, reload and cleanup",
  );
} finally {
  await context.close();
  await browser.close();
}
