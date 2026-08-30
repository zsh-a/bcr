/* M2 走查：device=auto 探测降级 + Whisper 识别 + opus-mt 文本翻译双语导出。 */
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
      const env2 = Math.min(1, (t - from) * 8, (to - t) * 8);
      pcm[i] = Math.round(
        0.6 * Math.sin(2 * Math.PI * 180 * t) * Math.sin(2 * Math.PI * 3 * t) * env2 * 32000,
      );
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
    dt.items.add(new File([new Uint8Array(bytes)], "m2.wav", { type: "audio/wav" }));
    const target = document.querySelector("[data-testid='dropzone']");
    (target ?? document.body).dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  },
  [...makeWav()],
);
await page.waitForTimeout(2000);

// 第一轮：识别（引擎=演示，确定性；device=auto → headless 无 GPU → 静默 wasm 探测路径）
await page.locator("select").nth(1).selectOption("demo");
await page.getByRole("button", { name: "生成字幕" }).click();
const countDone = () =>
  page
    .locator("body")
    .innerText()
    .then((t) => (t.match(/pipeline · done/g) ?? []).length);
let baseline = await countDone();
let done = false;
for (let i = 0; i < 100; i += 1) {
  await page.waitForTimeout(2000);
  if ((await countDone()) > baseline) {
    done = true;
    break;
  }
}
if (!done) fail("第一轮（识别）未完成");
console.log("round 1 (transcribe) done");

// 第二轮：开启双语翻译（中→英，匹配 demo 占位文本语言）→ translate 节点 opus-mt
await page.locator("input[type='checkbox']").first().check();
await page.locator("header select").nth(2).selectOption("zh-en");
await page.getByRole("button", { name: "生成字幕" }).click();
baseline = await countDone();
done = false;
for (let i = 0; i < 200; i += 1) {
  await page.waitForTimeout(2000);
  if ((await countDone()) > baseline) {
    done = true;
    break;
  }
}
await page.screenshot({ path: `${dir}/m2-bilingual.png` });
if (!done) fail("第二轮（翻译）未完成");
const text = await page.locator("body").innerText();
if (!text.includes("opus-mt-zh-en")) fail("翻译引擎徽标未显示 opus-mt-zh-en");
console.log("round 2 (translate) done");

// 导出 SRT：双语 cue 应为两行
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 5000 }),
  page.getByRole("button", { name: "SRT" }).click(),
]);
const { readFileSync } = await import("node:fs");
const srt = readFileSync(await download.path(), "utf8");
console.log("SRT preview:", JSON.stringify(srt.slice(0, 160)));
const blocks = srt.trim().split("\n\n");
if (!blocks.some((b) => b.split("\n").length >= 4)) fail("SRT 中没有双语 cue（应为文本+译文两行）");

await browser.close();
console.log(process.exitCode ? "verification FAILED" : "verification PASSED");
