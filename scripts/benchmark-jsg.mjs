import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import path from "node:path";
const root = path.resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const dir = path.resolve(process.argv[3] ?? "tmp/browser-benchmark");
mkdirSync(dir, { recursive: true });
const profile = mkdtempSync(path.join(dir, "profile-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: { width: 1440, height: 900 },
});
const page = context.pages()[0];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let actualBrowserPid;
let peakHeap = 0,
  peakBrowserRss = 0;
function browserRss() {
  const entries = [];
  let rootPid = actualBrowserPid;
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const status = readFileSync(`/proc/${name}/status`, "utf8");
      const ppid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1]);
      const rss = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024;
      entries.push({ pid: Number(name), ppid, rss });
      if (
        readFileSync(`/proc/${name}/cmdline`, "utf8")
          .split("\0")
          .includes(`--user-data-dir=${profile}`)
      )
        rootPid = Number(name);
    } catch {}
  }
  if (rootPid === undefined) return 0;
  const pids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of entries)
      if (pids.has(e.ppid) && !pids.has(e.pid)) {
        pids.add(e.pid);
        changed = true;
      }
  }
  return entries.filter((e) => pids.has(e.pid)).reduce((n, e) => n + e.rss, 0);
}

await page.goto(process.env.BASE_URL ?? "http://localhost:5202/?strategy=jsg", {
  waitUntil: "networkidle",
});
await page.waitForFunction(() => !document.querySelector(".research-run-button")?.disabled);
const session = await context.newCDPSession(page);
try {
  const browserSession = await context.browser()?.newBrowserCDPSession();
  const info = await browserSession?.send("SystemInfo.getProcessInfo");
  actualBrowserPid = info?.processInfo?.find((p) => p.type === "browser")?.id;
} catch {}
const baselineRss = browserRss();
const monitor = setInterval(async () => {
  peakBrowserRss = Math.max(peakBrowserRss, browserRss());
  try {
    const r = await session.send("Runtime.getHeapUsage");
    peakHeap = Math.max(peakHeap, r.usedSize + (r.backingStorageSize ?? 0));
  } catch {}
}, 50);
try {
  const importStart = performance.now();
  await page
    .getByLabel("导入 JSG 研究数据", { exact: true })
    .setInputFiles([
      path.join(root, "manifest.json"),
      ...manifest.partitions.map((p) => path.join(root, p.file)),
    ]);
  await page.waitForFunction(
    () => document.querySelector(".research-taskbar")?.textContent?.startsWith("研究数据就绪"),
    undefined,
    { timeout: 180000 },
  );
  const importMs = performance.now() - importStart;
  const start = performance.now();
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".research-taskbar")?.textContent?.includes("回测完成"),
    undefined,
    { timeout: 180000 },
  );
  const replayMs = performance.now() - start;
  const chartStart = performance.now();
  await page
    .getByLabel("查看净值日期", { exact: true })
    .fill(String(manifest.startDate).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"));
  await page.locator(".research-chart-bottom output").filter({ hasText: "现金" }).waitFor();
  const chartMs = performance.now() - chartStart;
  const exportStart = performance.now();
  await page.locator(".research-action-menu > summary").click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出结果", exact: true }).click();
  await (await event).saveAs(path.join(dir, "result.json"));
  const exportMs = performance.now() - exportStart;
  const result = JSON.parse(readFileSync(path.join(dir, "result.json"), "utf8")).result;
  assert(result.orders.length === result.metrics.filledOrders + result.metrics.rejectedOrders);
  const ordersStart = performance.now();
  await page.getByRole("tab", { name: /^成交/ }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /共 .* 笔/ })
    .waitFor();
  assert((await page.locator(".research-table tbody tr").count()) <= 50);
  const ordersMs = performance.now() - ordersStart;
  const filterStart = performance.now();
  await page.getByLabel("筛选证券", { exact: true }).fill(result.orders[0]?.code ?? "sz");
  const matches = result.orders.filter((order) =>
    order.code.includes(result.orders[0]?.code ?? "sz"),
  ).length;
  await page
    .getByRole("status")
    .filter({ hasText: `共 ${matches.toLocaleString()} 笔` })
    .waitFor();
  const filterMs = performance.now() - filterStart;
  await page.getByLabel("筛选证券", { exact: true }).fill("");
  await page
    .getByRole("status")
    .filter({ hasText: `共 ${result.orders.length.toLocaleString()} 笔` })
    .waitFor();
  if (result.orders.length > 50) {
    await page.getByRole("button", { name: "下一页订单", exact: true }).click();
    await page.getByRole("status").filter({ hasText: /51–/ }).waitFor();
    assert((await page.locator(".research-table tbody tr").count()) <= 50);
  }
  const renderedOrderRows = await page.locator(".research-table tbody tr").count();
  const previous = await page.locator(".research-run-result").getAttribute("data-run-id");
  const cachedStart = performance.now();
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(".research-run-result")?.getAttribute("data-run-id") !== id &&
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false" &&
      document.querySelector(".research-taskbar")?.textContent?.includes("复用已有结果"),
    previous,
  );
  const cacheMs = performance.now() - cachedStart;
  const beforeCancel = await page.locator(".research-run-result").getAttribute("data-run-id");
  await page.getByLabel("目标股票数", { exact: true }).fill("11");
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.getByRole("button", { name: "取消研究任务", exact: true }).waitFor();
  const cancelStart = performance.now();
  await page.getByRole("button", { name: "取消研究任务", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false",
  );
  const cancelMs = performance.now() - cancelStart;
  assert.equal(
    await page.locator(".research-run-result").getAttribute("data-run-id"),
    beforeCancel,
  );
  assert.deepEqual(errors, []);
  const report = {
    rows: manifest.partitions.reduce((n, p) => n + p.rows, 0),
    bytes: manifest.partitions.reduce((n, p) => n + p.bytes, 0),
    importMs,
    replayMs,
    exportMs,
    ordersMs,
    filterMs,
    chartMs,
    cacheMs,
    cancelMs,
    workerTimings: result.timings,
    manifestSha256: createHash("sha256")
      .update(readFileSync(path.join(root, "manifest.json")))
      .digest("hex"),
    mainPageHeapAndBackingMiB: peakHeap / 1048576,
    browserBaselineRssMiB: baselineRss > 0 ? baselineRss / 1048576 : null,
    sampledBrowserPeakRssMiB: peakBrowserRss > 0 ? peakBrowserRss / 1048576 : null,
    memoryScope:
      "CDP main-page JS heap/backing storage; RSS sampled at 50 ms across automation Chromium process tree; may include other automation contexts and counts shared pages in each process",
    resultRows: result.orders.length,
    renderedOrderRows,
    metrics: result.metrics,
  };
  writeFileSync(path.join(dir, "statistics.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  clearInterval(monitor);
  await context.close();
}
