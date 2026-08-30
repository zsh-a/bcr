import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage();
const info = await page.evaluate(async () => {
  const has = "gpu" in navigator;
  if (!has) return { has, adapter: null };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return { has, adapter: adapter ? (adapter.info?.vendor ?? "unknown") : null };
  } catch (e) {
    return { has, adapter: `error:${String(e).slice(0, 80)}` };
  }
});
console.log(JSON.stringify(info));
await browser.close();
