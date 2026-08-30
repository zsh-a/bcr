/* 截图走查：加载 Studio → 截图空状态 → 注入文件 → 跑任务 → 截图。 */
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:5199";
const dir = new URL("./shots/", import.meta.url).pathname;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[console:error]", msg.text());
});
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${dir}/01-empty.png` });

// 生成一个测试文件并导入（通过 file input 太绕，直接走 store 逻辑不可行；
// 用 input[type=file] 需要触发点击——这里改用拖拽 dataTransfer 注入）
const payload = new Float32Array(48000 * 4);
for (let i = 0; i < payload.length; i += 1) {
  payload[i] = Math.sin(i / 40) * Math.exp(-i / payload.length);
}
const buffer = Buffer.from(payload.buffer);

await page.evaluate(
  (bytes) => {
    const dt = new DataTransfer();
    const file = new File([new Uint8Array(bytes)], "demo.raw", {
      type: "application/octet-stream",
    });
    dt.items.add(file);
    const target = document.querySelector("[class*='border-dashed']");
    const event = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    });
    (target ?? document.body).dispatchEvent(event);
  },
  [...buffer],
);

await page.waitForTimeout(1200);
await page.screenshot({ path: `${dir}/02-imported.png` });

// 运行波形 + hash（按按钮角色定位）
await page.getByRole("button", { name: "提取波形" }).click();
await page.waitForTimeout(2000);
console.log(
  "buttons before blake3:",
  JSON.stringify(await page.$$eval("button", (bs) => bs.map((b) => b.textContent?.trim()))),
);
await page.screenshot({ path: `${dir}/03-pre-blake3.png` });
await page.locator("button", { hasText: "BLAKE3" }).first().click();
await page.waitForTimeout(2000);
await page.screenshot({ path: `${dir}/03-computed.png` });

// 再点一次 BLAKE3 → 应命中缓存
await page.locator("button", { hasText: "BLAKE3" }).first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${dir}/03b-cachehit.png` });

// 命令面板
await page.keyboard.press("Control+k");
await page.waitForTimeout(400);
await page.screenshot({ path: `${dir}/04-palette.png` });

await browser.close();
console.log("done");
