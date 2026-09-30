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
url.search = "?strategy=jsg";
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const waitComplete = () =>
  page.waitForFunction(
    () => document.querySelector(".jsg-footer")?.textContent?.includes("回测完成"),
    undefined,
    { timeout: 60_000 },
  );
const downloadResult = async (name) => {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出结果", exact: true }).click();
  const file = `${dir}/${name}`;
  await (await event).saveAs(file);
  return JSON.parse(readFileSync(file, "utf8"));
};
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "运行 JSG", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".jsg-lab .ui-btn-primary")?.disabled);
  await page.getByLabel("导入 JSG 研究数据", { exact: true }).setInputFiles(files);
  await page.waitForFunction(
    () => document.querySelector(".jsg-footer")?.textContent === "研究数据就绪jsg-adjusted-v1",
  );
  await page.getByRole("button", { name: "运行 JSG", exact: true }).click();
  await waitComplete();
  const first = await downloadResult("jsg-result.json");
  assert.equal(first.result.metrics.model, "jsg-adjusted-v1");
  assert.equal(first.result.metrics.days, 156);
  assert(first.result.metrics.filledOrders > 20);
  assert.equal(first.result.equity.length, 156);
  assert(first.result.orders.every((o) => o.quantity % 100 === 0));
  await page.getByRole("button", { name: "运行 JSG", exact: true }).click();
  await waitComplete();
  assert((await page.locator(".jsg-footer").innerText()).includes("复用已有结果"));
  assert.deepEqual((await downloadResult("jsg-cached.json")).result, first.result);
  await page.getByLabel("目标股票数", { exact: true }).fill("6");
  await page.getByRole("button", { name: "运行 JSG", exact: true }).click();
  await waitComplete();
  const changed = await downloadResult("jsg-six.json");
  assert.equal(changed.config.stockCount, 6);
  assert.notEqual(changed.result.metrics.finalEquity, first.result.metrics.finalEquity);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() =>
    document.querySelector(".jsg-footer")?.textContent?.includes("已恢复本地研究"),
  );
  assert.equal(await page.getByLabel("目标股票数", { exact: true }).inputValue(), "6");
  assert.deepEqual((await downloadResult("jsg-restored.json")).result, changed.result);
  await page.getByLabel("滑点 / bps", { exact: true }).fill("11");
  await page.getByRole("button", { name: "运行 JSG", exact: true }).click();
  await page.getByRole("button", { name: "取消回测", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".jsg-footer")?.textContent?.startsWith("回测已取消"),
  );
  await page.getByRole("button", { name: "运行 JSG", exact: true }).click();
  await waitComplete();
  await page.screenshot({ path: `${dir}/jsg-workbench.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.getByRole("button", { name: "运行 JSG", exact: true }).isVisible());
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  await page.screenshot({ path: `${dir}/jsg-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "JSG browser verification PASSED: import, Rust execution, cache, parameters, restore, cancel, mobile",
  );
} catch (error) {
  await page.screenshot({ path: `${dir}/jsg-failure.png`, fullPage: true }).catch(() => undefined);
  console.error(
    await page
      .locator(".jsg-lab")
      .innerText()
      .catch(() => "JSG view unavailable"),
  );
  throw error;
} finally {
  await browser.close();
}
