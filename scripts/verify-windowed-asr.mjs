/* 分窗 ASR 走查：150s 音频 → 2 个 ASR 窗口 → 跨窗字幕归属 + 排序 + 导出。 */
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:5173";
const dir = new URL("./shots/", import.meta.url).pathname;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

// 150s 音频：每 ~8s 一组 2s 语音脉冲（保证每个窗口内都有语音段）
function makeWav(seconds = 150, sampleRate = 16000) {
  const samples = seconds * sampleRate;
  const pcm = new Int16Array(samples);
  for (let from = 1; from < seconds - 2; from += 8) {
    for (let i = from * sampleRate; i < (from + 2) * sampleRate; i += 1) {
      const t = i / sampleRate;
      pcm[i] = Math.round(
        0.5 *
          Math.sin(2 * Math.PI * 210 * t) *
          32000 *
          (0.7 + 0.3 * Math.sin(2 * Math.PI * 2.5 * t)),
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (err) => fail(`pageerror: ${err.message}`));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const clearBtn = page.getByRole("button", { name: "清空项目" });
if ((await clearBtn.count()) > 0) {
  await clearBtn.click();
  await page.waitForTimeout(800);
}

const wav = makeWav();
await page.evaluate(
  (bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], "long-form.wav", { type: "audio/wav" }));
    const target = document.querySelector("[data-testid='dropzone']");
    (target ?? document.body).dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  },
  [...wav],
);
await page.waitForTimeout(2000);

let text = await page.locator("body").innerText();
if (!text.includes("long-form.wav")) fail("导入失败");

// 引擎可参数化：demo（离线确定性）/ whisper（真实模型，推理需数分钟）
const engine = process.env.ENGINE ?? "demo";
await page.locator("select").nth(1).selectOption(engine);
await page.getByRole("button", { name: "生成字幕" }).click();

// 轮询等待流水线完成（console 出现 "pipeline · done"），whisper 长音频最长达 8 分钟
let done = false;
for (let i = 0; i < 160; i += 1) {
  await page.waitForTimeout(3000);
  text = await page.locator("body").innerText();
  if (text.includes("pipeline · done") || text.includes("pipeline · failed")) {
    done = text.includes("pipeline · done");
    break;
  }
}
await page.screenshot({ path: `${dir}/w1-pipeline.png` });
if (!done) fail(`流水线未完成：${text.slice(-200)}`);
if (!text.includes("150.0s")) fail("解码时长不符（应 150s）");

// 导出 SRT 检查跨窗结果
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 5000 }),
  page.getByRole("button", { name: "SRT" }).click(),
]);
const { readFileSync } = await import("node:fs");
const srt = readFileSync(await download.path(), "utf8");

// 解析 SRT 时间轴：跨过 120s 窗口边界的字幕必须存在（来自窗口 2）
const stamps = [...srt.matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> /g)].map((m) => {
  const [, h, mm, ss] = m;
  return Number(h) * 3600 + Number(mm) * 60 + Number(ss);
});
console.log(`cues: ${stamps.length}, first: ${stamps[0]}s, last: ${stamps[stamps.length - 1]}s`);
if (stamps.length < 10) fail(`字幕条目过少: ${stamps.length}`);
if (!stamps.some((s) => s >= 120)) fail("没有 ≥120s 的字幕——第二窗口未归属任何内容");
let sorted = true;
for (let i = 1; i < stamps.length; i += 1) {
  if ((stamps[i] ?? 0) < (stamps[i - 1] ?? 0)) sorted = false;
}
if (!sorted) fail("跨窗字幕时间轴未排序——窗口归属/合并有问题");

// 双语结构不受影响：勾选翻译节点会因无 whisper 而失败，这里仅回归 SRT
await page.screenshot({ path: `${dir}/w2-done.png` });
await browser.close();
console.log(process.exitCode ? "verification FAILED" : "verification PASSED");
