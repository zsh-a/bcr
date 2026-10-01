import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const url = new URL(process.env.BASE_URL ?? "http://localhost:5201/");
if (url.pathname.startsWith("/studio")) url.pathname = "/quant";
url.search = "";
const run = async () => {
  const result = page.locator(".research-run-result");
  const before = (await result.count()) ? await result.getAttribute("data-run-id") : null;
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(".research-status")?.textContent?.includes("回测完成") &&
      document.querySelector(".research-run-result") !== null &&
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false" &&
      document.querySelector(".research-run-result")?.getAttribute("data-run-id") !== id,
    before,
  );
};
const download = async (name) => {
  await page.locator(".research-action-menu > summary").click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出结果", exact: true }).click();
  const path = `${shots}/${name}.json`;
  await (await event).saveAs(path);
  return JSON.parse(readFileSync(path, "utf8"));
};
const openStorage = async () => {
  await page.locator(".research-action-menu > summary").click();
  await page.getByRole("button", { name: "数据与存储", exact: true }).click();
  await page.locator(".research-snapshot-list > div").first().waitFor();
};
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.querySelector(".research-run-button")?.disabled);
  await run();
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  await page.getByRole("tab", { name: "参数", exact: true }).click();
  await page.getByLabel("目标股票数", { exact: true }).fill("6");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "运行设置", exact: true }).waitFor({ state: "hidden" });
  await run();
  const captured = await download("jsg-storage-before");
  await page.getByRole("button", { name: "运行历史", exact: true }).click();
  await page
    .getByRole("button", { name: /^移除运行/ })
    .last()
    .click();
  assert.equal(await page.locator(".research-history-row").count(), 1);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("quant");
    const put = async (path) => {
      const parts = path.split("/");
      let dir = root;
      for (const part of parts.slice(0, -1))
        dir = await dir.getDirectoryHandle(part, { create: true });
      const writer = await (
        await dir.getFileHandle(parts.at(-1), { create: true })
      ).createWritable();
      await writer.write(new Uint8Array([1, 2, 3]));
      await writer.close();
    };
    await put("temp/jsg/abandoned/response.arrow");
    await put("artifacts/jsg/input/orphan");
    await put("artifacts/custom/retained");
  });
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".research-run-result").waitFor();
  await openStorage();
  await page.getByRole("button", { name: "清理未使用数据", exact: true }).click();
  await page.getByRole("button", { name: "确认清理", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /^已释放/ })
    .waitFor();
  const paths = await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("quant");
    const files = [];
    const walk = async (dir, prefix = "") => {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === "directory") await walk(handle, prefix + name + "/");
        else files.push(prefix + name);
      }
    };
    await walk(root);
    return files;
  });
  assert(!paths.includes("temp/jsg/abandoned/response.arrow"));
  assert(!paths.includes("artifacts/jsg/input/orphan"));
  assert(paths.includes("artifacts/custom/retained"));
  assert.equal(
    paths.filter((p) => p.startsWith("artifacts/jsg-") && p.includes("/result/")).length,
    1,
  );
  await page.screenshot({ path: `${shots}/jsg-storage.png`, fullPage: true });
  await page.keyboard.press("Escape");
  assert.deepEqual((await download("jsg-storage-after")).result, captured.result);
  await openStorage();
  await page.getByRole("button", { name: "使用快照", exact: true }).first().click();
  assert.deepEqual((await download("jsg-storage-reused")).result, captured.result);
  await page.setViewportSize({ width: 320, height: 844 });
  await openStorage();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${shots}/jsg-storage-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "JSG storage verification PASSED: history removal, lineage/cache reclamation, shared snapshot preservation, abandoned transfer recovery, immutable export, snapshot reuse and mobile",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/jsg-storage-failure.png`, fullPage: true })
    .catch(() => undefined);
  throw error;
} finally {
  await browser.close();
}
