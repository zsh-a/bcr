/* M3 走查：undo/redo（按钮+键盘）、跟随播放高亮、CPS 告警、ASS 导出。 */
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:5175";
const dir = new URL("./shots/", import.meta.url).pathname;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

function makeWav(seconds = 6, sampleRate = 16000) {
  const samples = seconds * sampleRate;
  const pcm = new Int16Array(samples);
  for (const [from, to] of [
    [0.3, 2.3],
    [3.0, 5.5],
  ]) {
    for (let i = from * sampleRate; i < to * sampleRate; i += 1) {
      const t = i / sampleRate;
      pcm[i] = Math.round(0.5 * Math.sin(2 * Math.PI * 220 * t) * 32000);
    }
  }
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  return new Uint8Array([...new Uint8Array(header), ...new Uint8Array(pcm.buffer)]);
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("pageerror", (err) => fail(`pageerror: ${err.message}`));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const clearBtn = page.getByRole("button", { name: "清空项目" });
if ((await clearBtn.count()) > 0) {
  await clearBtn.click();
  await page.waitForTimeout(800);
}

await page.evaluate(
  (bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], "m3.wav", { type: "audio/wav" }));
    const target = document.querySelector("[data-testid='dropzone']");
    (target ?? document.body).dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  },
  [...makeWav()],
);
await page.waitForTimeout(2000);

// 生成（演示引擎）
await page.locator("select").nth(1).selectOption("demo");
await page.getByRole("button", { name: "生成字幕" }).click();
for (let i = 0; i < 30; i += 1) {
  await page.waitForTimeout(2000);
  if ((await page.locator("body").innerText()).includes("pipeline · done")) break;
}
const editorInputs = page.locator("[data-testid='cue-editor'] input");
await editorInputs.first().waitFor({ timeout: 8000 });

// ── undo/redo：改第一条文本 → 键盘撤销 → 重做 ──────────────────────
const firstInput = editorInputs.first();
const original = await firstInput.inputValue();
await firstInput.fill("edited-text");
await page.waitForTimeout(300);
await page.keyboard.press("Control+z");
await page.waitForTimeout(300);
const afterUndo = await firstInput.inputValue();
if (afterUndo !== original) fail(`撤销失败：${afterUndo} !== ${original}`);
console.log("undo restored:", afterUndo);
await page.keyboard.press("Control+y");
await page.waitForTimeout(300);
if ((await firstInput.inputValue()) !== "edited-text") fail("重做失败");
await page.getByTestId("undo").click();
if ((await firstInput.inputValue()) !== original) fail("按钮撤销失败");
console.log("button undo ok");

// ── 跟随播放：拖播放头到第二条 cue 中点 → 该行 data-active ─────────
const rows = page.locator("[data-testid='cue-editor'] > div:nth-child(2) > div");
const secondStart = await rows
  .nth(1)
  .locator("button")
  .nth(1)
  .innerText()
  .then((t) => {
    const [m, s] = t.split(" → ")[0].split(":");
    return Number(m) * 60 + Number(s);
  });
await page.evaluate((seconds) => {
  const video = document.querySelector("video");
  if (video !== null) video.currentTime = seconds + 0.5;
}, secondStart);
await page.waitForTimeout(800);
const activeRow = page.locator("[data-active='true']");
if ((await activeRow.count()) !== 1) fail(`跟随播放高亮异常：${await activeRow.count()} 行 active`);
console.log("follow-playback highlight ok at", secondStart + 0.5, "s");
await page.screenshot({ path: `${dir}/m3-follow.png` });

// ── ASS 导出回归（demo 无词 → 无 karaoke 标签）──────────────────────
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 5000 }),
  page.getByRole("button", { name: "ASS" }).click(),
]);
const { readFileSync } = await import("node:fs");
const ass = readFileSync(await download.path(), "utf8");
if (!ass.includes("Dialogue:")) fail("ASS 缺 Dialogue");

await browser.close();
console.log(process.exitCode ? "verification FAILED" : "verification PASSED");
