/* 刷新恢复走查：导入 → 计算 → reload → 文件/任务历史恢复 + 缓存命中（§7/§8）。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

const base = process.env.BASE_URL ?? "http://localhost:5199/studio";
const dir = new URL("./shots/", import.meta.url).pathname;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const browser = await launchVerifyBrowser("studio");
const page = browser.pages()[0] ?? (await browser.newPage());

page.on("pageerror", (err) => fail(`pageerror: ${err.message}`));

// ── 会话 1：导入 + 计算 ────────────────────────────────────────────
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const payload = new Float32Array(48000 * 4);
for (let i = 0; i < payload.length; i += 1) {
  payload[i] = Math.sin(i / 40) * Math.exp(-i / payload.length);
}
const buffer = Buffer.from(payload.buffer);

await page.evaluate(
  (bytes) => {
    const dt = new DataTransfer();
    const file = new File([new Uint8Array(bytes)], "persist.raw", {
      type: "application/octet-stream",
    });
    dt.items.add(file);
    const target = document.querySelector("[class*='border-dashed']");
    const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
    (target ?? document.body).dispatchEvent(event);
  },
  [...buffer],
);
await page.waitForTimeout(1500);

await page.locator("button", { hasText: "BLAKE3" }).first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${dir}/p1-computed.png` });

const taskText1 = await page.locator("body").innerText();
if (!taskText1.includes("persist.raw")) fail("会话 1：文件未出现在项目列表");
const taskId = taskText1.match(/task-[a-z0-9]+-[a-z0-9]+/)?.[0];
if (taskId === undefined) fail("会话 1：任务未出现在任务历史");
console.log("session 1 done");

// ── 会话 2：刷新 → 恢复 ───────────────────────────────────────────
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${dir}/p2-reloaded.png` });

const taskText2 = await page.locator("body").innerText();
if (!taskText2.includes("persist.raw")) fail("刷新后文件列表未恢复（kv/files 缺失）");
if (taskId !== undefined && !taskText2.includes(taskId)) {
  fail("刷新后任务历史未恢复（task_journal 缺失）");
}
console.log("file list and task history restored after reload");

// 同一文件重跑 → 缓存命中（cache_entries 持久化）
await page.locator("button", { hasText: "BLAKE3" }).first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${dir}/p3-cachehit.png` });

const taskText3 = await page.locator("body").innerText();
if (!taskText3.includes("cache hit")) fail("刷新后重跑未命中缓存（cache_entries 未持久化）");
console.log("cache hit after reload");

await browser.close();
console.log(process.exitCode ? "verification FAILED" : "verification PASSED");
