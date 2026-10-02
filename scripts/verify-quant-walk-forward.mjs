import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { ensureShots, launchEphemeralBrowser, repoRoot } from "./lib/browser.mjs";

const shots = ensureShots();
execFileSync(
  "bun",
  [
    "-e",
    `
import { mkdirSync, writeFileSync } from "node:fs";
import { demoResearch } from "./apps/quant-lab/src/jsg/demo.ts";
mkdirSync("scripts/shots/walk-forward-input", { recursive: true });
for (const file of demoResearch().files) writeFileSync("scripts/shots/walk-forward-input/" + file.name, new Uint8Array(await file.arrayBuffer()));
`,
  ],
  { cwd: repoRoot },
);
const input = `${shots}/walk-forward-input/manifest.json`;
const manifest = JSON.parse(readFileSync(input, "utf8"));
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [];
const url = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5297/quant");
if (url.pathname.startsWith("/studio")) url.pathname = "/quant";
page.on("pageerror", (e) => errors.push(e.message));
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
const download = async (label, name) => {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: label, exact: true }).click();
  const path = `${shots}/${name}.json`;
  await (await pending).saveAs(path);
  return JSON.parse(readFileSync(path, "utf8"));
};
try {
  await page.goto(url.toString(), {
    waitUntil: "networkidle",
  });
  await ready();
  await page
    .getByLabel("导入 JSG 研究数据", { exact: true })
    .setInputFiles([
      input,
      ...manifest.partitions.map((p) => `${shots}/walk-forward-input/${p.file}`),
    ]);
  await page.getByRole("status").filter({ hasText: "研究数据就绪" }).waitFor();
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  await page.getByRole("tab", { name: "参数", exact: true }).click();
  await page.getByLabel("研究策略", { exact: true }).selectOption("momentum");
  await page.getByLabel("动量观察周期", { exact: true }).fill("10");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "运行设置", exact: true }).waitFor({ state: "hidden" });
  await menu("稳健性验证");
  assert.equal(await page.getByLabel("验证方式", { exact: true }).inputValue(), "walk-forward");
  assert.equal(await page.getByLabel("验证观察周期候选", { exact: true }).inputValue(), "10");
  await page.getByLabel("验证股票数候选", { exact: true }).fill("6,10");
  await page.getByLabel("验证止损候选", { exact: true }).fill("0");
  await page.getByLabel("验证观察周期候选", { exact: true }).fill("10,20");
  await page.getByRole("button", { name: "运行稳健性验证", exact: true }).click();
  await page
    .getByRole("region", { name: "连续样本外表现", exact: true })
    .waitFor({ timeout: 90_000 });
  await ready();
  const id = await page.locator("[data-study-id]").getAttribute("data-study-id");
  const full = await download("导出连续回测完整结果", "quant-walk-forward-full");
  assert.equal(full.research.parameterSchedule.length, 5);
  assert.equal(full.result.metrics.days, 96);
  assert.equal(full.result.equity.length, 96);
  assert(full.result.orders.length > 200, "full export must exceed the event preview limit");
  assert.equal(full.result.chunks, undefined);
  for (const step of full.research.parameterSchedule) {
    const i = manifest.calendar.findIndex((d) => d.date === step.from);
    assert.equal(manifest.calendar[i - 1].date, step.selectedAt);
    assert(step.selectedAt < step.from);
  }
  const study = await download("导出稳健性验证", "quant-walk-forward-study");
  assert.equal(study.result.training.length, 20);
  assert.deepEqual(
    study.result.continuous.deployed.map((d) => d.days),
    [20, 20, 20, 20, 16],
  );
  assert.equal(
    study.result.continuous.evaluation.strategy.totalReturn,
    full.result.metrics.totalReturn,
  );
  const compounded =
    study.result.continuous.deployed.reduce((v, d) => v * (1 + d.totalReturn), 1) - 1;
  assert(Math.abs(compounded - full.result.metrics.totalReturn) < 1e-12);
  for (let i = 1; i < 5; i++)
    assert.equal(
      study.result.continuous.deployed[i].startEquity,
      study.result.continuous.deployed[i - 1].endEquity,
    );
  const configPath = `${shots}/walk-forward-config.json`,
    schedulePath = `${shots}/walk-forward-schedule.json`;
  writeFileSync(configPath, JSON.stringify(full.config));
  writeFileSync(schedulePath, JSON.stringify(full.research.parameterSchedule));
  const native = JSON.parse(
    execFileSync(
      "cargo",
      [
        "run",
        "--quiet",
        "--manifest-path",
        "crates/quant/Cargo.toml",
        "--bin",
        "jsg",
        "--",
        input,
        configPath,
        "--schedule",
        schedulePath,
      ],
      { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
    ),
  );
  assert.deepEqual(native.metrics, full.result.metrics);
  assert.deepEqual(native.equity, full.result.equity);
  assert.deepEqual(native.orders, full.result.orders);
  await page.screenshot({ path: `${shots}/quant-walk-forward-curve.png`, fullPage: true });
  await page.getByRole("tab", { name: /^验证窗口/ }).click();
  assert.equal(await page.locator(".research-deployed-folds tbody tr").count(), 5);
  await page.getByRole("tab", { name: "分期收益", exact: true }).click();
  await page.getByLabel("样本外分期频率", { exact: true }).selectOption("years");
  await page.getByRole("tab", { name: "参数稳定性", exact: true }).click();
  await page.locator(".research-parameter-stability").waitFor();
  await page.screenshot({ path: `${shots}/quant-walk-forward-stability.png`, fullPage: true });
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(`[data-study-id="${id}"]`).waitFor();
  await ready();
  await menu("数据与存储");
  await page.getByRole("button", { name: "清理未使用数据", exact: true }).click();
  await page.getByRole("button", { name: "确认清理", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /^已释放/ })
    .waitFor();
  await ready();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "数据与存储", exact: true }).waitFor({ state: "hidden" });
  const after = await download("导出连续回测完整结果", "quant-walk-forward-cleanup");
  assert.deepEqual(after.result, full.result);
  await menu("稳健性验证");
  await page.getByLabel("训练窗口", { exact: true }).fill("80");
  await page.getByLabel("验证股票数候选", { exact: true }).fill("1,2,3,4,5,6,7,8");
  await page.getByLabel("验证止损候选", { exact: true }).fill("0,5");
  await page.getByLabel("验证观察周期候选", { exact: true }).fill("10");
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error("Cancellation did not appear"));
        }, 10_000);
        const observer = new MutationObserver(() => {
          const cancel = document.querySelector('button[aria-label="取消研究任务"]');
          if (!cancel) return;
          observer.disconnect();
          clearTimeout(timeout);
          cancel.click();
          resolve();
        });
        observer.observe(document.querySelector(".jsg-workspace"), {
          childList: true,
          subtree: true,
        });
        [...document.querySelectorAll(".research-grid-dialog button")]
          .find((b) => b.textContent.trim() === "运行稳健性验证")
          .click();
      }),
  );
  await page.getByRole("status").filter({ hasText: "已取消，已有结果保留" }).waitFor();
  await ready();
  assert.equal(await page.locator("[data-study-id]").getAttribute("data-study-id"), id);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(
      await page
        .locator(".research-walk-forward .research-metrics > div:last-child dd")
        .evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1;
        }),
      "asset value must remain readable at narrow widths",
    );
    await page.getByRole("tab", { name: /^验证窗口/ }).click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole("tab", { name: "参数稳定性", exact: true }).click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.screenshot({ path: `${shots}/quant-walk-forward-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS continuous OOS, full export, native/WASM parity, analysis, reload, cleanup, cancellation and mobile",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/quant-walk-forward-failure.png`, fullPage: true })
    .catch(() => undefined);
  console.error(
    await page
      .locator(".jsg-workspace")
      .innerText()
      .catch(() => "Quant unavailable"),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
