/* Subtitle Studio 走查：导入 → 生成（DAG 流水线）→ 字幕/波形/导出 → 刷新恢复。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

const base = process.env.BASE_URL ?? "http://localhost:5180";
const dir = new URL("./shots/", import.meta.url).pathname;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

// 生成 6 秒测试音频（4 组“语音”脉冲 + 静音间隔），f32 WAV
function makeWav(seconds = 6, sampleRate = 16000) {
  const samples = seconds * sampleRate;
  const data = new Float32Array(samples);
  const pulses = [
    [0.3, 1.2],
    [1.8, 2.8],
    [3.4, 4.4],
    [4.9, 5.7],
  ];
  for (const [from, to] of pulses) {
    for (let i = Math.floor(from * sampleRate); i < Math.floor(to * sampleRate); i += 1) {
      const t = i / sampleRate;
      data[i] = 0.5 * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t));
    }
  }
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i += 1) pcm[i] = Math.round((data[i] ?? 0) * 32000);
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

const browser = await launchVerifyBrowser("media");
const page = browser.pages()[0] ?? (await browser.newPage());
page.on("pageerror", (err) => fail(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[console:error]", msg.text().slice(0, 200));
});

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

// 导入
const wav = makeWav();
await page.evaluate(
  (bytes) => {
    const dt = new DataTransfer();
    const file = new File([new Uint8Array(bytes)], "demo-speech.wav", { type: "audio/wav" });
    dt.items.add(file);
    const target = document.querySelector("[data-testid='dropzone']");
    const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
    (target ?? document.body).dispatchEvent(event);
  },
  [...wav],
);
await page.waitForTimeout(1500);

let text = await page.locator("body").innerText();
if (!text.includes("demo-speech.wav")) fail("导入后源文件未显示");
await page.screenshot({ path: `${dir}/m1-imported.png` });

// 生成字幕（演示引擎，避免外网模型依赖）
await page.locator("select").nth(1).selectOption("demo");
await page.getByRole("button", { name: "生成字幕" }).click();
await page.waitForTimeout(4000);
await page.screenshot({ path: `${dir}/m2-pipeline.png` });

text = await page.locator("body").innerText();
if (!text.includes("完成") && !text.includes("缓存命中")) fail("流水线节点未完成");
const editor = await page.locator("[data-testid='cue-editor']").count();
const empty = await page.locator("[data-testid='cue-empty']").count();
if (empty > 0 || editor === 0) fail("字幕编辑器为空——流水线产物未回填");
const cueCount = await page.locator("[data-testid='cue-editor'] input").count();
console.log("cue inputs rendered:", cueCount);
if (cueCount < 2) fail("字幕条目过少");

// 导出 SRT：通过下载事件捕获内容
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 5000 }),
  page.getByRole("button", { name: "SRT" }).click(),
]);
const srtPath = await download.path();
const { readFileSync } = await import("node:fs");
const srt = readFileSync(srtPath, "utf8");
console.log("SRT preview:", JSON.stringify(srt.slice(0, 120)));
if (!srt.includes("-->")) fail("SRT 缺少时间轴");

// 刷新 → 项目恢复
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(4000);
text = await page.locator("body").innerText();
if (!text.includes("demo-speech.wav")) fail("刷新后项目未恢复");
const restoredInputs = page.locator("[data-testid='cue-editor'] input");
let restoredCues = 0;
try {
  await restoredInputs.first().waitFor({ timeout: 5000 });
  restoredCues = await restoredInputs.count();
} catch {
  restoredCues = 0;
}
if (restoredCues === 0) fail("刷新后字幕编辑未恢复");
const firstCue = await restoredInputs.first().inputValue();
if (!firstCue.includes("演示字幕")) fail(`刷新后字幕内容不符: ${firstCue}`);
await page.screenshot({ path: `${dir}/m3-restored.png` });

await browser.close();
console.log(process.exitCode ? "verification FAILED" : "verification PASSED");
