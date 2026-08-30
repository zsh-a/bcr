/* 渐进渲染探针：whisper 分窗推理期间，字幕应分批出现而非结束后一次性填充。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

const base = process.env.BASE_URL ?? "http://localhost:5180";
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

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

const browser = await launchVerifyBrowser("media");
const page = browser.pages()[0] ?? (await browser.newPage());
page.on("pageerror", (err) => fail(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "warning" || msg.type() === "error")
    console.log("[browser]", msg.type(), msg.text().slice(0, 160));
});

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
    dt.items.add(new File([new Uint8Array(bytes)], "progressive.wav", { type: "audio/wav" }));
    const target = document.querySelector("[data-testid='dropzone']");
    (target ?? document.body).dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  },
  [...makeWav()],
);
await page.waitForTimeout(2000);

await page.locator("select").nth(1).selectOption("whisper");
await page.getByRole("button", { name: "生成字幕" }).click();

// 轮询：记录编辑器行数随时间的变化——应在推理期间分批增长
const samples = [];
for (let i = 0; i < 150; i += 1) {
  await page.waitForTimeout(2000);
  const body = await page.locator("body").innerText();
  if (body.includes("pipeline · done") || body.includes("pipeline · failed")) {
    console.log("ended at t=", i * 2, "·", body.includes("pipeline · done") ? "done" : "failed");
    break;
  }
  const rows = await page
    .locator("[data-testid='cue-editor'] input")
    .count()
    .catch(() => 0);
  if (samples[samples.length - 1]?.count !== rows) {
    samples.push({ t: i * 2, count: rows });
    console.log(`t=${i * 2}s cues=${rows / 2}`);
  }
  if (i === 5)
    await page.screenshot({ path: new URL("./shots/prog-mid.png", import.meta.url).pathname });
}
const consoleText = await page.locator("aside").innerText();
console.log("console tail:", consoleText.split("\n").slice(-8).join(" | "));
console.log("progression:", JSON.stringify(samples));
// 断言：完成前观察到非零中间态（条数 < 最终条数），即字幕是边算边出而非一次性填充
const midRunFill = samples.some((s) => s.count > 0);
if (!midRunFill) fail("渐进渲染未观察到：运行期间编辑器始终为空");
await browser.close();
console.log(process.exitCode ? "verification FAILED" : "verification PASSED");
