import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const url = new URL(process.env.BASE_URL ?? "http://localhost:5201/");
if (url.pathname.startsWith("/studio")) url.pathname = "/quant";
url.search = "";
const shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [],
  requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => requests.push(request.url()));
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.locator(".research-run-button:not(:disabled)").waitFor({ timeout: 60000 });
  assert(await page.getByRole("heading", { name: "行业宽度轮动", exact: true }).isVisible());
  assert.equal(await page.getByRole("combobox", { name: "选择策略", exact: true }).count(), 0);
  assert.equal(
    await page.locator(".research-run-result").count(),
    0,
    "Opening research must not run a strategy",
  );
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".research-status")?.textContent.includes("回测完成") &&
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false",
    null,
    { timeout: 60000 },
  );
  const result = page.locator(".research-run-result");
  const runId = await result.getAttribute("data-run-id");
  assert(runId);
  await page.locator(".research-action-menu > summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出结果", exact: true }).click();
  const filename = `${shots}/quant-default-result.json`;
  await (await download).saveAs(filename);
  const exported = JSON.parse(readFileSync(filename, "utf8"));
  assert.equal(exported.result.metrics.days, 156);
  assert.equal(exported.result.metrics.model, "jsg-adjusted-v1");
  assert(exported.result.metrics.filledOrders > 20);
  await page.reload({ waitUntil: "networkidle" });
  await result.waitFor({ timeout: 60000 });
  assert.equal(
    await result.getAttribute("data-run-id"),
    runId,
    "Default route must restore its frozen run",
  );
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  await page.getByRole("tab", { name: "参数", exact: true }).click();
  assert.equal(await page.getByLabel("目标股票数", { exact: true }).inputValue(), "10");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "运行设置", exact: true }).waitFor({ state: "hidden" });
  assert.equal(requests.filter((request) => /duckdb/u.test(request)).length, 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${shots}/quant-lab.png`, fullPage: true });
  console.log(
    "Quant default-entry verification passed: explicit run, Rust results, export and reload recovery without DuckDB.",
  );
} catch (error) {
  console.error(page.url(), (await page.locator("body").innerText()).slice(-4000));
  throw error;
} finally {
  await browser.close();
}
