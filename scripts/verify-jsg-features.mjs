import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ensureShots, launchEphemeralBrowser, repoRoot } from "./lib/browser.mjs";

const shots = ensureShots();
execFileSync(
  "bun",
  [
    "-e",
    `import {writeFileSync,mkdirSync} from "node:fs";import {demoResearch} from "./apps/quant-lab/src/jsg/demo.ts";mkdirSync("scripts/shots/features-input",{recursive:true});for(const file of demoResearch().files)writeFileSync("scripts/shots/features-input/"+file.name,new Uint8Array(await file.arrayBuffer()));`,
  ],
  { cwd: repoRoot },
);
const manifest = JSON.parse(readFileSync(`${shots}/features-input/manifest.json`, "utf8"));
const url = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5206/quant");
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
const runId = () => page.locator(".research-run-result").getAttribute("data-run-id");
const settings = async () => {
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  await page.getByRole("tab", { name: "参数", exact: true }).click();
};
const closeSettings = async () => {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "运行设置", exact: true }).waitFor({ state: "hidden" });
};
const run = async () => {
  const previous = (await page.locator(".research-run-result").count()) ? await runId() : null;
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false" &&
      document.querySelector(".research-run-result")?.getAttribute("data-run-id") &&
      document.querySelector(".research-run-result")?.getAttribute("data-run-id") !== id,
    previous,
    { timeout: 60_000 },
  );
  return runId();
};
const exportJson = async (button, file) => {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const path = `${shots}/${file}`;
  await (await event).saveAs(path);
  return JSON.parse(readFileSync(path, "utf8"));
};
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.querySelector(".research-run-button")?.disabled);
  await page
    .getByLabel("导入 JSG 研究数据", { exact: true })
    .setInputFiles([
      `${shots}/features-input/manifest.json`,
      ...manifest.partitions.map((p) => `${shots}/features-input/${p.file}`),
    ]);
  await page.getByRole("status").filter({ hasText: "研究数据就绪" }).waitFor();
  const ids = [];
  for (const count of [10, 8, 6, 4, 3]) {
    await settings();
    await page.getByLabel("目标股票数", { exact: true }).fill(String(count));
    await closeSettings();
    ids.push(await run());
  }
  await settings();
  await page.getByLabel("目标股票数", { exact: true }).fill("2");
  await page
    .locator(".research-parameter-details > summary")
    .filter({ hasText: "风险控制" })
    .click();
  for (const [name, value] of [
    ["单股仓位上限", "10"],
    ["总仓位上限", "35"],
    ["单日亏损", "2"],
    ["固定止盈", "2"],
  ]) {
    await page.getByLabel(`启用${name}`, { exact: true }).check();
    await page.getByLabel(`${name} / %`, { exact: true }).fill(value);
  }
  await closeSettings();
  const riskId = await run();
  await page.locator(".research-action-menu > summary").click();
  const risk = await exportJson("导出结果", "features-risk.json");
  assert.equal(risk.config.maxPositionPct, 0.1);
  assert.equal(risk.config.maxExposurePct, 0.35);
  assert.equal(risk.config.maxDailyLoss, 0.02);
  assert.equal(risk.config.takeProfit, 0.02);
  assert(risk.result.orders.some((o) => o.riskReason === "position-cap"));
  assert(risk.result.orders.some((o) => o.reason === "take-profit" || o.reason === "daily-loss"));
  await page.getByRole("tab", { name: "分析", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".research-evaluation")?.getAttribute("aria-busy") === "false" &&
      document.querySelector(".research-period-table tbody tr"),
  );
  await page.locator(".research-evaluation-details > summary").click();
  const evaluation = await exportJson("导出研究评估", "features-evaluation.json");
  assert.equal(evaluation.evaluation.version, "jsg-evaluation-2");
  for (const name of [
    "sortino",
    "calmar",
    "downsideDeviation",
    "winRate",
    "profitFactor",
    "avgWin",
    "avgLoss",
  ])
    assert(name in evaluation.evaluation.strategy);
  await page.getByRole("tab", { name: "概览", exact: true }).click();
  await page.getByRole("button", { name: "3 月", exact: true }).click();
  await page.getByRole("button", { name: "添加对照", exact: true }).click();
  for (let i = 0; i < 4; i++) {
    await page.locator(`input[data-comparison-id="${ids[i]}"]`).check();
    await page
      .locator(".research-comparison-footer > span")
      .filter({ hasText: `已选 ${i + 1} / 4` })
      .waitFor();
  }
  assert(await page.locator(`input[data-comparison-id="${ids[4]}"]`).isDisabled());
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "导出比较", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "导出比较")
        ?.disabled,
  );
  assert.equal(await page.locator(".research-chart-legend .comparison").count(), 4);
  assert.equal(
    await page.locator(".research-comparison > .research-table-wrap thead th").count(),
    6,
  );
  assert.equal(
    await page.getByRole("button", { name: "3 月", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await page.locator(".research-comparison-parameters > summary").click();
  assert(
    (await page.locator(".research-comparison-parameters").innerText()).includes("单股仓位上限"),
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出比较", exact: true }).click();
  await (await download).saveAs(`${shots}/features-comparison.csv`);
  const csv = readFileSync(`${shots}/features-comparison.csv`, "utf8");
  assert(csv.includes("Sortino") && csv.includes("单股仓位上限") && csv.includes(ids[3]));
  await page.locator(".research-results").evaluate((el) => el.scrollTo(0, 0));
  await page.screenshot({ path: `${shots}/jsg-features-desktop.png`, fullPage: true });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `overflow at ${width}`,
    );
  }
  await page.locator(".research-comparison").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/jsg-features-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "管理对照（4）", exact: true }).click();
  await page.locator(`input[data-comparison-id="${ids[0]}"]`).uncheck();
  await page
    .locator(".research-comparison-footer > span")
    .filter({ hasText: "已选 3 / 4" })
    .waitFor();
  assert(!(await page.locator(`input[data-comparison-id="${ids[4]}"]`).isDisabled()));
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  assert.equal(await page.locator(".research-comparison").count(), 0);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".research-run-result").waitFor();
  assert.equal(await runId(), riskId);
  await settings();
  await page
    .locator(".research-parameter-details > summary")
    .filter({ hasText: "风险控制" })
    .click();
  assert.equal(await page.getByLabel("单股仓位上限 / %", { exact: true }).inputValue(), "10");
  await closeSettings();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: complete metrics, five-run comparisons/export/limits, risk configuration and fills, reload, responsive layouts",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/jsg-features-failure.png`, fullPage: true })
    .catch(() => undefined);
  throw error;
} finally {
  await context.close();
  await browser.close();
}
