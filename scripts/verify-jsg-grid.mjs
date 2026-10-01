import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const url = new URL(process.env.BASE_URL ?? "http://localhost:5201/");
if (url.pathname.startsWith("/studio")) url.pathname = "/quant";
url.searchParams.set("strategy", "jsg");
const gridId = () => page.locator(".research-grid-results").getAttribute("data-grid-id");
const runId = () => page.locator(".research-run-result").getAttribute("data-run-id");
const open = async () => {
  await page.locator(".research-action-menu > summary").click();
  await page.getByRole("button", { name: "参数实验", exact: true }).click();
};
const completed = (old) =>
  page.waitForFunction(
    (id) =>
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false" &&
      document.querySelector(".research-taskbar")?.textContent?.includes("参数实验完成") &&
      document.querySelector(".research-grid-results") !== null &&
      document.querySelector(".research-grid-results")?.getAttribute("data-grid-id") !== id,
    old,
    { timeout: 90_000 },
  );
const download = async (name, experiment = false) => {
  if (!experiment) await page.locator(".research-action-menu > summary").click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: experiment ? "导出参数实验" : "导出结果", exact: true })
    .click();
  const path = `${shots}/${name}.json`;
  await (await event).saveAs(path);
  return JSON.parse(readFileSync(path, "utf8"));
};
const storage = async () => {
  await page.locator(".research-action-menu > summary").click();
  await page.getByRole("button", { name: "数据与存储", exact: true }).click();
  await page.locator(".research-snapshot-list > div").first().waitFor();
  await page.getByRole("button", { name: "清理未使用数据", exact: true }).click();
  await page.getByRole("button", { name: "确认清理", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /^已释放/ })
    .waitFor();
  if (await page.locator(".research-storage-dialog .ui-dialog-close").isDisabled()) {
    await page.keyboard.press("Escape");
    assert(await page.locator(".research-storage-dialog[open]").isVisible());
  }
  await page.waitForFunction(
    () => document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false",
  );
  await page.keyboard.press("Escape");
};
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.querySelector(".research-run-button")?.disabled);
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.locator(".research-run-result").waitFor();
  const firstId = await runId(),
    first = await download("jsg-grid-selected-before");
  await open();
  await page.getByRole("button", { name: "添加参数", exact: true }).click();
  assert.equal(await page.locator(".research-grid-axis").count(), 3);
  await page.getByRole("button", { name: "移除实验参数 3", exact: true }).click();
  assert.equal(await page.locator(".research-grid-axis").count(), 2);
  await page.getByLabel("目标股票数候选值", { exact: true }).fill("30");
  assert(await page.getByRole("button", { name: "运行参数实验", exact: true }).isDisabled());
  await page.getByLabel("目标股票数候选值", { exact: true }).fill("6, 10");
  await page.getByLabel("个股止损候选值", { exact: true }).fill("0, 5");
  await page.screenshot({ path: `${shots}/jsg-grid-settings.png`, fullPage: true });
  await page.getByRole("button", { name: "运行参数实验", exact: true }).click();
  await completed(null);
  const firstGridId = await gridId(),
    grid = await download("jsg-grid-first", true);
  assert.equal(grid.result.decodedRows, 64 * 180);
  assert.equal(grid.result.results.length, 4);
  assert.equal(await runId(), firstId);
  assert.deepEqual((await download("jsg-grid-selected-after")).result, first.result);
  await page.getByRole("button", { name: "按收益排序", exact: true }).click();
  assert.equal(await page.locator('.research-grid-table th[aria-sort="ascending"]').count(), 1);
  await page.getByRole("button", { name: "按Sharpe排序", exact: true }).click();
  await page.screenshot({ path: `${shots}/jsg-grid-results.png`, fullPage: true });
  await page.getByRole("button", { name: "查看组合 1 详情", exact: true }).click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false" &&
      document.querySelector(".research-run-result")?.getAttribute("data-run-id") !== id,
    firstId,
  );
  let detailedId = await runId();
  const detailed = await download("jsg-grid-detailed");
  assert.deepEqual(detailed.result.metrics, grid.result.results[0].metrics);
  assert.deepEqual(detailed.config, grid.result.results[0].config);
  assert.equal(await page.getByLabel("目标股票数", { exact: true }).inputValue(), "10");
  await page.locator(".research-grid-toggle").click();
  const beforeCachedDetail = await runId();
  await page.getByRole("button", { name: "查看组合 3 详情", exact: true }).click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false" &&
      document.querySelector(".research-run-result")?.getAttribute("data-run-id") !== id,
    beforeCachedDetail,
  );
  assert((await page.locator(".research-taskbar").innerText()).includes("复用已有结果"));
  assert.deepEqual((await download("jsg-grid-reused-detail")).result, first.result);
  detailedId = await runId();
  await open();
  await page.getByRole("button", { name: "运行参数实验", exact: true }).click();
  await completed(firstGridId);
  const cachedId = await gridId(),
    cached = await download("jsg-grid-cached", true);
  assert.equal(cached.experiment.cached, true);
  assert.deepEqual(cached.result, grid.result);
  assert.equal(await runId(), detailedId);
  await open();
  await page.getByLabel("目标股票数候选值", { exact: true }).fill("1,2,3,4,5,6,7,8,9");
  await page.getByLabel("个股止损候选值", { exact: true }).fill("0,1,2,3,4,5,6,7");
  await page.getByRole("alert").filter({ hasText: "64" }).waitFor();
  await page.getByLabel("目标股票数候选值", { exact: true }).fill("1,2,3,4,5,6,7,8");
  await page.getByRole("button", { name: "运行参数实验", exact: true }).click();
  await page.getByRole("button", { name: "取消研究任务", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已取消，已有结果保留" }).waitFor();
  assert.equal(await gridId(), cachedId);
  assert.equal(await runId(), detailedId);
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".research-grid-results").waitFor();
  assert.equal(await gridId(), cachedId);
  assert.deepEqual((await download("jsg-grid-restored", true)).result, grid.result);
  await page.getByRole("button", { name: "使用组合 1 参数", exact: true }).click();
  assert.equal(await page.getByLabel("目标股票数", { exact: true }).inputValue(), "6");
  assert.equal(await runId(), detailedId);
  await storage();
  assert.deepEqual((await download("jsg-grid-after-cleanup", true)).result, grid.result);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await open();
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector(".research-grid-dialog").scrollWidth >
          document.querySelector(".research-grid-dialog").clientWidth,
      ),
      false,
    );
    assert(
      (
        await page
          .getByRole("button", { name: "移除实验参数 1", exact: true })
          .locator("svg")
          .boundingBox()
      ).width >= 12,
    );
    await page.screenshot({ path: `${shots}/jsg-grid-mobile-${width}.png`, fullPage: true });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const previousGrid = await gridId();
  await open();
  await page.getByLabel("目标股票数候选值", { exact: true }).fill("4,6,8,10");
  await page.getByLabel("个股止损候选值", { exact: true }).fill("0,1,2,3,4,5");
  await page.getByRole("button", { name: "运行参数实验", exact: true }).click();
  await completed(previousGrid);
  assert.equal(await page.locator(".research-grid-table tbody tr").count(), 20);
  await page.getByRole("button", { name: "下一页参数组合", exact: true }).click();
  assert.equal(await page.locator(".research-grid-table tbody tr").count(), 4);
  await page.getByRole("button", { name: "按费用排序", exact: true }).click();
  assert.equal(await page.locator(".research-grid-table tbody tr").count(), 20);
  const latestGrid = await download("jsg-grid-paginated", true);
  await page.getByRole("button", { name: "移除参数实验", exact: true }).click();
  assert.equal(await page.locator(".research-grid-results").count(), 0);
  await storage();
  const retained = await page.evaluate(async (id) => {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("quant");
    const parts = `artifacts/${id}`.split("/");
    try {
      for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name);
      await dir.getFileHandle(parts.at(-1));
      return true;
    } catch {
      return false;
    }
  }, latestGrid.experiment.resultRef.id);
  assert.equal(retained, false);
  assert.deepEqual(errors, []);
  console.log(
    "JSG grid verification PASSED: validation, shared metrics, immutable selected result, sorting, detail parity, cache, cancel, restore, draft application, storage reclamation, mobile",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/jsg-grid-failure.png`, fullPage: true })
    .catch(() => undefined);
  console.error(
    await page
      .locator(".jsg-workspace")
      .innerText()
      .catch(() => "workspace unavailable"),
  );
  throw error;
} finally {
  await browser.close();
}
