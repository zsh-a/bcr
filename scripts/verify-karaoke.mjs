/* 卡拉 OK 探针：真实 Whisper 词级时间戳 → ASS \k 标签。需外网下载模型，网络抖动可重跑。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

const base = process.env.BASE_URL ?? "http://localhost:5180";
const dir = new URL("./shots/", import.meta.url).pathname;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
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

const browser = await launchVerifyBrowser("media");
const page = browser.pages()[0] ?? (await browser.newPage());
page.on("pageerror", (err) => fail(`pageerror: ${err.message}`));
page.on("crash", () => console.log("[diag] page crashed"));
browser.on("disconnected", () => console.log("[diag] browser disconnected"));

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
    dt.items.add(new File([new Uint8Array(bytes)], "karaoke.wav", { type: "audio/wav" }));
    const target = document.querySelector("[data-testid='dropzone']");
    (target ?? document.body).dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  },
  [...makeWav()],
);
await page.waitForTimeout(2000);

// 仅 Whisper + 词级时间戳（默认开启）；模型下载受外网抖动影响，失败重试至多 3 次
await page.locator("select").nth(1).selectOption("whisper");
let done = false;
for (let attempt = 1; attempt <= 3 && !done; attempt += 1) {
  await page.getByRole("button", { name: "生成字幕" }).click();
  for (let i = 0; i < 160; i += 1) {
    await page.waitForTimeout(3000);
    const text = await page.locator("body").innerText();
    if (text.includes("pipeline · done")) {
      done = true;
      break;
    }
    if (text.includes("failed")) {
      console.log(`attempt ${attempt} failed, retrying…`);
      await page.waitForTimeout(3000);
      break;
    }
  }
}
if (!done) fail("流水线未完成（含重试）");

const cueInputs = await page.locator("[data-testid='cue-editor'] input").count();
const consoleArea = await page.locator("aside").innerText();
console.log(
  "cue inputs:",
  cueInputs,
  "| console tail:",
  consoleArea.split("\n").slice(-4).join(" | "),
);
await page.screenshot({ path: `${dir}/k1-before-export.png` });
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 8000 }),
  page.getByRole("button", { name: "ASS" }).click(),
]);
const { readFileSync } = await import("node:fs");
const ass = readFileSync(await download.path(), "utf8");
const karaokeLines = ass.split("\n").filter((line) => line.includes("\\k"));
console.log("karaoke dialogue lines:", karaokeLines.length);
console.log("sample:", karaokeLines[0]?.slice(0, 140));
if (karaokeLines.length === 0) fail("ASS 中没有 \\k 卡拉 OK 标签——词级时间戳未生效");
await page.screenshot({ path: `${dir}/k1-karaoke.png` });
await browser.close();
console.log(process.exitCode ? "verification FAILED" : "verification PASSED");
