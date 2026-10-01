import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { launchEphemeralBrowser, repoRoot, ensureShots } from "./lib/browser.mjs";
const shots = ensureShots();
execFileSync(
  "bun",
  [
    "-e",
    `import {demoResearch} from "./apps/quant-lab/src/jsg/demo.ts";import {mkdirSync,writeFileSync} from "node:fs";mkdirSync("scripts/shots/layout-input",{recursive:true});for(const f of demoResearch().files)writeFileSync("scripts/shots/layout-input/"+f.name,new Uint8Array(await f.arrayBuffer()));`,
  ],
  { cwd: repoRoot },
);
const manifest = JSON.parse(readFileSync(`${shots}/layout-input/manifest.json`, "utf8"));
const url = new URL(process.env.BASE_URL ?? "http://localhost:5201/");
if (url.pathname.startsWith("/studio")) url.pathname = "/quant";
url.search = "";
const browser = await launchEphemeralBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const settings = () => page.getByRole("dialog", { name: "运行设置", exact: true });
const close = async () => {
  await page.keyboard.press("Escape");
  await settings().waitFor({ state: "hidden" });
};
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page
    .getByLabel("导入 JSG 研究数据", { exact: true })
    .setInputFiles([
      `${shots}/layout-input/manifest.json`,
      ...manifest.partitions.map((p) => `${shots}/layout-input/${p.file}`),
    ]);
  await page.getByRole("status").filter({ hasText: "研究数据就绪" }).waitFor();
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".research-run-result") &&
      document.querySelector(".jsg-workspace").getAttribute("data-busy") === "false",
  );
  await page.locator(".research-chart-canvas canvas").first().waitFor();
  await page.waitForFunction(() => !document.querySelector(".research-chart-legend .ui-spinner"));
  const geometry = await page.evaluate(() => ({
    toolbar: document.querySelector(".research-header").getBoundingClientRect().height,
    tabs: document.querySelector(".research-explorer > .research-tabs").getBoundingClientRect()
      .bottom,
    chart: document.querySelector(".research-chart-canvas").getBoundingClientRect().toJSON(),
    viewport: innerHeight,
  }));
  assert(geometry.toolbar <= 64, JSON.stringify(geometry));
  assert(geometry.tabs < geometry.chart.top, JSON.stringify(geometry));
  assert(geometry.chart.bottom <= geometry.viewport - 4, JSON.stringify(geometry));
  assert.equal(
    await page.locator(".research-parameter-rail, .research-sourcebar, .research-taskbar").count(),
    0,
  );
  await page.getByRole("button", { name: "3 月", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "3 月", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("tab", { name: /^成交/ }).click();
  assert.equal(await page.locator(".research-chart").isVisible(), false);
  await page.getByRole("tab", { name: "概览", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "3 月", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "全部", exact: true }).click();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    await page.screenshot({ path: `${shots}/jsg-layout-${theme}.png` });
  }
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  await page.waitForFunction(() => {
    const r = document.querySelector(".research-settings-drawer").getBoundingClientRect();
    return Math.abs(r.right - innerWidth) < 1 && r.height >= innerHeight - 1;
  });
  const box = await settings().boundingBox();
  assert(Math.abs(box.x + box.width - 1366) < 2);
  assert(box.width <= 420);
  assert(box.height >= 760);
  await page.getByLabel("目标股票数", { exact: true }).fill("6");
  await page.getByRole("tab", { name: /^修改/ }).click();
  assert.match(await page.locator(".research-draft-changes").innerText(), /目标股票数/);
  await page.screenshot({ path: `${shots}/jsg-layout-changes.png` });
  await page.getByRole("button", { name: "恢复本次运行设置", exact: true }).click();
  await page.getByText("设置与当前运行一致", { exact: true }).waitFor();
  assert.equal(await page.locator(".jsg-workspace").getAttribute("data-draft-changed"), "false");
  await close();
  assert(
    await page
      .getByRole("button", { name: "运行设置", exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  const firstRun = await page.locator(".research-run-result").getAttribute("data-run-id");
  await page.getByRole("tab", { name: /^成交/ }).click();
  await page.getByLabel("筛选证券", { exact: true }).fill("NO-MATCH");
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  await page.getByRole("tab", { name: "参数", exact: true }).click();
  await page.getByLabel("目标股票数", { exact: true }).fill("6");
  await page.keyboard.press("Control+Enter");
  await settings().waitFor({ state: "hidden" });
  await page.waitForFunction(
    (id) =>
      document.querySelector(".jsg-workspace").getAttribute("data-busy") === "false" &&
      document.querySelector(".research-run-result").getAttribute("data-run-id") !== id,
    firstRun,
  );
  assert.equal(await page.locator(".jsg-workspace").getAttribute("data-draft-changed"), "false");
  assert.equal(
    await page.getByRole("tab", { name: /^成交/ }).getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.getByLabel("筛选证券", { exact: true }).inputValue(), "");
  await page.getByRole("tab", { name: "概览", exact: true }).click();
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await page.getByRole("heading", { name: "行业宽度轮动", exact: true }).isVisible());
    assert(await page.getByRole("button", { name: "运行回测", exact: true }).isVisible());
    await page.getByRole("tab", { name: "分析", exact: true }).click();
    assert.equal(await page.locator(".research-chart").isVisible(), false);
    await page.getByRole("tab", { name: "概览", exact: true }).click();
    await page.screenshot({ path: `${shots}/jsg-layout-mobile-${width}.png` });
    await page.getByRole("button", { name: "运行设置", exact: true }).click();
    await page.getByRole("tab", { name: "数据与区间", exact: true }).click();
    await page.locator(".research-source-options > button").first().click();
    await page.getByLabel("ClickHouse 地址", { exact: true }).waitFor();
    assert(await settings().evaluate((el) => el.scrollWidth <= el.clientWidth));
    assert(
      await page
        .locator(".research-settings-drawer .research-tab-panel")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    );
    await page.screenshot({ path: `${shots}/jsg-layout-data-${width}.png` });
    await page.locator(".research-source-options > button").last().click();
    await close();
    if (width <= 390) {
      await page.locator(".research-action-menu > summary").click();
      await page.getByRole("button", { name: "运行历史", exact: true }).click();
      await page.getByRole("dialog", { name: "运行历史", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page
        .getByRole("dialog", { name: "运行历史", exact: true })
        .waitFor({ state: "hidden" });
    }
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".research-run-result").waitFor();
  assert(await page.getByRole("tab", { name: "概览", exact: true }).isVisible());
  assert.deepEqual(errors, []);
  console.log(
    "JSG layout verification PASSED: laptop first fold, drawer geometry, draft recovery, retained chart range, keyboard run, default entry restoration, focus, light/dark, mobile history",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/jsg-layout-failure.png`, fullPage: true })
    .catch(() => undefined);
  console.error((await page.locator("body").innerText()).slice(-4000));
  throw error;
} finally {
  await browser.close();
}
