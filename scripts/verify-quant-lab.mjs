/* Quant Lab 主链路：列式行情 → Worker Pipeline → Parquet 往返 → 参数重跑。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

const base = new URL(process.env.BASE_URL ?? "http://localhost:5199/studio");
base.pathname = "/quant";
base.search = "";
const dir = new URL("./shots/", import.meta.url).pathname;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const browser = await launchVerifyBrowser("studio");
const page = browser.pages()[0] ?? (await browser.newPage());
page.on("pageerror", (error) => fail(`pageerror: ${error.message}`));

await page.goto(base.toString(), { waitUntil: "networkidle" });
await page.waitForFunction(
  () => {
    const metric = [...document.querySelectorAll(".ql-metric")].find((element) =>
      element.textContent?.includes("TOTAL RETURN"),
    );
    return metric !== undefined && !metric.textContent?.includes("—");
  },
  undefined,
  { timeout: 20_000 },
);

let body = await page.locator("body").innerText();
if (!body.includes("BCR QUANT LAB")) fail("Quant Lab 未渲染");
if (!body.includes("720 DAILY BARS")) fail("行情未加载或恢复");
if (!body.includes("DuckDB") || !body.includes("ARROW") || !body.includes("PARQUET")) {
  fail("列式数据层未上线");
}
if ((await page.locator(".ql-trade").count()) === 0) fail("回测未产生成交");

const parquetPath = `${dir}/quant-market.parquet`;
const download = page.waitForEvent("download");
await page.getByRole("button", { name: "PARQUET" }).click();
await (await download).saveAs(parquetPath);
await page.locator('input[type="file"]').setInputFiles(parquetPath);
try {
  await page.waitForFunction(
    () =>
      document.querySelector(".ql-market-status")?.textContent?.includes("quant-market.parquet"),
    undefined,
    { timeout: 45_000 },
  );
} catch (error) {
  console.error(`Parquet import diagnostics:\n${await page.locator("body").innerText()}`);
  throw error;
}
await page.getByRole("button", { name: "RUN BACKTEST" }).waitFor({ timeout: 20_000 });

await page.getByLabel("Fast window").fill("16");
await page.getByLabel("Slow window").fill("64");
await page.getByRole("button", { name: "RUN BACKTEST" }).click();
await page.getByRole("button", { name: "RUN BACKTEST" }).waitFor({ timeout: 20_000 });
body = await page.locator("body").innerText();
if (!body.includes("SMA(16, 64)")) fail("参数重跑未进入 Pipeline");
if (!body.includes("rust-wasm") || body.includes("TS FALLBACK BT")) {
  fail("Rust/WASM backtester 未成为实际执行引擎");
}

await page.screenshot({ path: `${dir}/quant-lab.png`, fullPage: true });
await browser.close();
console.log(process.exitCode ? "quant verification FAILED" : "quant verification PASSED");
