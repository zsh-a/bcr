import { chromium } from "playwright";
const base = "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 150)));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

// 清空上一轮项目,导入新文件
const clearBtn = page.getByRole("button", { name: "清空项目" });
if ((await clearBtn.count()) > 0) {
  await clearBtn.click();
  await page.waitForTimeout(500);
}

const samples = 16000 * 4;
const pcm = new Float32Array(samples);
for (let i = 0; i < samples; i++) pcm[i] = 0.4 * Math.sin((2 * Math.PI * 200 * i) / 16000);
const header = new ArrayBuffer(44);
const view = new DataView(header);
const write = (o, t) => {
  for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i));
};
write(0, "RIFF");
view.setUint32(4, 36 + samples * 2, true);
write(8, "WAVEfmt ");
view.setUint32(16, 16, true);
view.setUint16(20, 1, true);
view.setUint16(22, 1, true);
view.setUint32(24, 16000, true);
view.setUint32(28, 32000, true);
view.setUint16(32, 2, true);
view.setUint16(34, 16, true);
write(36, "data");
view.setUint32(40, samples * 2, true);
const i16 = new Int16Array(samples);
for (let i = 0; i < samples; i++) i16[i] = Math.round((pcm[i] ?? 0) * 32000);
const wav = new Uint8Array([...new Uint8Array(header), ...new Uint8Array(i16.buffer)]);

await page.evaluate(
  (bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], "whisper-probe.wav", { type: "audio/wav" }));
    const target = document.querySelector("[data-testid='dropzone']");
    (target ?? document.body).dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  },
  [...wav],
);
await page.waitForTimeout(1500);

// 引擎保持默认 auto → 尝试真实 whisper-tiny
await page.getByRole("button", { name: "生成字幕" }).click();
// 模型下载最多等 3 分钟
await page.waitForTimeout(180000);
const badge = await page
  .locator("header span.rounded")
  .last()
  .innerText()
  .catch(() => "(no badge)");
console.log("engine badge:", badge);
const console_ = await page.locator("aside").innerText();
console.log("console tail:", console_.split("\n").slice(-6).join(" | "));
await page.screenshot({ path: "scripts/shots/m4-whisper.png" });
await browser.close();
