import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.env.BASE_URL ?? "http://127.0.0.1:5199/studio");
  const harness =
    "/@fs" +
    fileURLToPath(new URL("../packages/react/tests/lifecycle-harness.tsx", import.meta.url));
  await page.evaluate(async (url) => {
    const { verifyRuntimeLifecycle } = await import(url);
    await verifyRuntimeLifecycle();
  }, harness);
  console.log("runtime lifecycle verification PASSED");
} finally {
  await browser.close();
}
