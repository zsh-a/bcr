import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { launchEphemeralBrowser } from "./lib/browser.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext();
const errors = [];
const create = async (path, selector) => {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + path, { waitUntil: "domcontentloaded" });
  await page.locator(selector).first().waitFor();
  return page;
};
const quantReady = (page) =>
  page.waitForFunction(
    () =>
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false" &&
      !document.querySelector(".research-run-button")?.disabled,
  );
const held = (page) =>
  page.evaluate(async () => (await navigator.locks.query()).held.map((lock) => lock.name));

try {
  const [market, quant, manga] = await Promise.all([
    create("/pwa/markets/", ".market-atlas"),
    create("/pwa/quant/", ".quant-lab"),
    create("/pwa/manga/", ".manga-studio"),
  ]);
  await quantReady(quant);
  await manga.getByRole("button", { name: "翻译当前页", exact: true }).waitFor();
  await manga.waitForFunction(() => !document.querySelector(".manga-runtime-alert"));
  assert.ok(
    !(await held(market)).includes("bcr:project:studio"),
    "focused PWAs must not own Studio metadata",
  );
  const workspace = await create("/pwa/workspace/", ".home-app-card");
  assert.ok(
    (await held(workspace)).includes("bcr:project:studio"),
    "workspace retains its single writer",
  );
  await workspace.close();
  await market.keyboard.press("Control+Shift+f");
  await market.getByRole("dialog", { name: "全局搜索", exact: true }).waitFor();
  assert.equal(await market.getByRole("button", { name: /^资料集合/ }).count(), 0);
  assert.equal(await market.getByText("本地元数据不可用，无法保存资料集合").count(), 0);
  await market.keyboard.press("Escape");

  await quant.getByRole("button", { name: "运行回测", exact: true }).click();
  await quant.locator(".research-run-result").waitFor();
  await quantReady(quant);
  const runId = await quant.locator(".research-run-result").getAttribute("data-run-id");
  const duplicate = await context.newPage();
  await duplicate.goto(origin + "/pwa/quant/");
  await duplicate
    .getByRole("alert")
    .filter({ hasText: 'Project "quant" is already open' })
    .waitFor();
  await quant.close();
  await duplicate.reload();
  await quantReady(duplicate);
  assert.equal(
    await duplicate.locator(".research-run-result").getAttribute("data-run-id"),
    runId,
    "isolated Quant restores its persisted run",
  );

  await manga.getByRole("button", { name: "翻译当前页", exact: true }).click();
  await manga.waitForFunction(
    () =>
      [...document.querySelectorAll(".manga-stage-status")].length === 9 &&
      [...document.querySelectorAll(".manga-stage-status")].every(
        (element) => element.textContent === "DONE",
      ),
  );
  await manga.evaluate(
    async (url) => {
      const { closeMangaSession } = await import(url);
      await closeMangaSession();
    },
    "/@fs" +
      fileURLToPath(new URL("../apps/manga-studio/tests/lifecycle-harness.ts", import.meta.url)),
  );
  await manga.reload();
  await manga.waitForFunction(
    () =>
      document.querySelectorAll(".manga-stage-status").length === 9 &&
      [...document.querySelectorAll(".manga-stage-status")].every(
        (element) => element.textContent === "DONE",
      ),
  );
  assert.equal(await manga.getByRole("alert").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "session isolation PASSED: Market / Quant / Manga / Workspace coexist, domain leases and restored compute preserved",
  );
} catch (error) {
  for (const page of context.pages()) {
    console.error(page.url(), (await page.locator("body").innerText()).slice(-3000));
  }
  throw error;
} finally {
  await context.close();
  await browser.close();
}
