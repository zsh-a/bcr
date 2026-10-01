import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ensureShots, launchEphemeralBrowser, repoRoot } from "./lib/browser.mjs";

const dir = ensureShots();
execFileSync(
  "bun",
  [
    "-e",
    `
import { writeFileSync, mkdirSync } from "node:fs";
import { demoResearch } from "./apps/quant-lab/src/jsg/demo.ts";
mkdirSync("scripts/shots/jsg-input", { recursive: true });
for (const file of demoResearch().files) writeFileSync("scripts/shots/jsg-input/" + file.name, new Uint8Array(await file.arrayBuffer()));
`,
  ],
  { cwd: repoRoot },
);
const manifest = JSON.parse(readFileSync(`${dir}/jsg-input/manifest.json`, "utf8"));
const files = [
  `${dir}/jsg-input/manifest.json`,
  ...manifest.partitions.map((p) => `${dir}/jsg-input/${p.file}`),
];
const url = new URL(process.env.BASE_URL ?? "http://localhost:5201/");
if (url.pathname.startsWith("/studio")) url.pathname = "/quant";
url.search = "";
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const runButton = () => page.getByRole("button", { name: "运行回测", exact: true });
const settings = async () => {
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  await page.getByRole("tab", { name: "参数", exact: true }).click();
};
const closeSettings = async () => {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "运行设置", exact: true }).waitFor({ state: "hidden" });
};
const runId = async () => {
  const result = page.locator(".research-run-result");
  return (await result.count()) ? result.getAttribute("data-run-id") : null;
};
const run = async () => {
  const previous = await runId();
  await runButton().click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(".research-status")?.textContent?.includes("回测完成") &&
      document.querySelector(".research-run-result")?.getAttribute("data-run-id") !== id &&
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false",
    previous,
    { timeout: 60_000 },
  );
};
const downloadResult = async (name) => {
  await page.locator(".research-action-menu > summary").click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出结果", exact: true }).click();
  const file = `${dir}/${name}`;
  await (await event).saveAs(file);
  return JSON.parse(readFileSync(file, "utf8"));
};
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await runButton().waitFor();
  await page.waitForFunction(() => !document.querySelector(".research-run-button")?.disabled);
  await page.getByLabel("导入 JSG 研究数据", { exact: true }).setInputFiles(files);
  await page.getByRole("status").filter({ hasText: "研究数据就绪" }).waitFor();
  await run();
  const firstId = await runId(),
    first = await downloadResult("jsg-result.json");
  assert.equal(first.result.metrics.days, 156);
  assert.equal(first.result.metrics.model, "jsg-adjusted-v1");
  assert(first.result.metrics.filledOrders > 20);
  assert.equal(first.result.equity.length, 156);
  assert(first.result.orders.every((o) => o.quantity % 100 === 0));
  await settings();
  await page.getByLabel("目标股票数", { exact: true }).fill("6");
  assert.equal(await runId(), firstId);
  assert.equal(await page.locator(".jsg-workspace").getAttribute("data-draft-changed"), "true");
  await closeSettings();
  assert.equal((await downloadResult("jsg-preserved-draft.json")).config.stockCount, 10);
  await settings();
  await page.getByLabel("目标股票数", { exact: true }).fill("21");
  assert(await runButton().isDisabled());
  assert.equal(await runId(), firstId);
  await page.getByLabel("目标股票数", { exact: true }).fill("6");
  await closeSettings();
  await run();
  const changed = await downloadResult("jsg-six.json");
  assert.equal(changed.config.stockCount, 6);
  assert.notEqual(changed.result.metrics.finalEquity, first.result.metrics.finalEquity);
  await page.getByRole("button", { name: "添加对照", exact: true }).click();
  await page.locator(`input[data-comparison-id="${firstId}"]`).check();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.locator(".research-comparison").waitFor();
  await page.locator(".research-chart-legend .comparison").waitFor();
  await page.getByRole("tab", { name: "概览", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.getByRole("tab", { name: "分析", exact: true }).getAttribute("aria-selected"),
    "true",
  );
  await page.getByRole("tab", { name: /^成交/ }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /共 .* 笔/ })
    .waitFor();
  const orderCount = first.result.orders.length;
  assert(orderCount > 0);
  assert((await page.locator(".research-orders .research-table tbody tr").count()) <= 50);
  await page.getByLabel("筛选证券", { exact: true }).fill(changed.result.orders[0].code);
  await page
    .getByRole("status")
    .filter({ hasText: /共 .* 笔/ })
    .waitFor();
  await page.waitForFunction(
    (code) =>
      [...document.querySelectorAll(".research-orders .research-table tbody tr")].every((row) =>
        row.textContent.includes(code),
      ),
    changed.result.orders[0].code,
  );
  await page.locator(".research-table-link").first().click();
  await page.getByRole("dialog", { name: "订单详情", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert(
    await page
      .locator(".research-table-link")
      .first()
      .evaluate((el) => el === document.activeElement),
  );
  await page.getByRole("tab", { name: "选股解释", exact: true }).click();
  await page.getByLabel("解释日期", { exact: true }).selectOption(changed.result.decisions[0].date);
  await page.locator(".research-reason-summary").waitFor();
  await page.getByRole("tab", { name: "概览", exact: true }).click();
  await page.getByRole("button", { name: "运行历史", exact: true }).click();
  await page.locator(".research-history-row > button:first-child").last().click();
  await page.waitForFunction(
    (id) => document.querySelector(".research-run-result")?.getAttribute("data-run-id") === id,
    firstId,
  );
  await settings();
  assert.equal(await page.getByLabel("目标股票数", { exact: true }).inputValue(), "6");
  await closeSettings();
  assert.equal((await downloadResult("jsg-history-selected.json")).config.stockCount, 10);
  await run();
  assert((await page.locator(".research-status").innerText()).includes("复用已有结果"));
  assert.deepEqual((await downloadResult("jsg-cached.json")).result, changed.result);
  await settings();
  await page.locator(".research-parameters .research-parameter-details > summary").first().click();
  await page.getByLabel("滑点 / bps", { exact: true }).fill("11");
  await closeSettings();
  const beforeCancel = await runId();
  await runButton().click();
  await page.getByRole("button", { name: "取消研究任务", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已取消，已有结果保留" }).waitFor();
  assert.equal(await runId(), beforeCancel);
  assert.equal((await downloadResult("jsg-cancel-preserved.json")).config.slippageBps, 10);
  await settings();
  const costs = page.locator(".research-parameters .research-parameter-details").first();
  if (!(await costs.evaluate((el) => el.open))) await costs.locator("summary").click();
  await page.getByLabel("滑点 / bps", { exact: true }).fill("10");
  await closeSettings();
  await run();
  await page.waitForTimeout(500); // Debounced metadata acknowledgement before reload.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("status").filter({ hasText: "已恢复本地研究" }).waitFor();
  await settings();
  assert.equal(await page.getByLabel("目标股票数", { exact: true }).inputValue(), "6");
  await closeSettings();
  assert.deepEqual((await downloadResult("jsg-restored.json")).result, changed.result);
  await page.locator(".research-chart-inspector > summary").click();
  await page.getByLabel("查看净值日期", { exact: true }).fill(changed.result.equity[10].date);
  await page.waitForFunction(() =>
    document.querySelector(".research-chart-bottom output")?.textContent?.includes("净值"),
  );
  await page.screenshot({ path: `${dir}/jsg-workbench.png`, fullPage: true });
  assert.equal(await page.locator(".research-parameter-rail").count(), 0);
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.screenshot({ path: `${dir}/jsg-light.png`, fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert(await runButton().isVisible());
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.getByRole("button", { name: "运行设置", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "运行设置", exact: true });
    await sheet.waitFor();
    await sheet.getByRole("tab", { name: "参数", exact: true }).click();
    await sheet.getByLabel("目标股票数", { exact: true }).fill("7");
    await closeSettings();
    assert(
      await page
        .getByRole("button", { name: "运行设置", exact: true })
        .evaluate((el) => el === document.activeElement),
    );
    assert.deepEqual(
      (await downloadResult(`jsg-mobile-preserved-${width}.json`)).result,
      changed.result,
    );
  }
  await page.screenshot({ path: `${dir}/jsg-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "JSG browser verification PASSED: immutable exports, draft edits, invalid input, cache, history, comparison, full-result filtering, details, cancel, restore, theme, keyboard and mobile",
  );
} catch (error) {
  await page.screenshot({ path: `${dir}/jsg-failure.png`, fullPage: true }).catch(() => undefined);
  console.error(
    await page
      .locator(".jsg-workspace")
      .innerText()
      .catch(() => "JSG view unavailable"),
  );
  throw error;
} finally {
  await browser.close();
}
