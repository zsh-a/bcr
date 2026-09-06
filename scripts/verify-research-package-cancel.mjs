import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const errors = [];
async function open(page) {
  await page.keyboard.press("Control+Shift+F");
  await page.getByRole("button", { name: /资料集合 ·/u }).click();
}
const saved = (page) => page.getByRole("status").filter({ hasText: "已保存到本地" }).waitFor();
async function pageIn(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/reader`, { waitUntil: "networkidle" });
  await page.getByLabel("导入阅读文件").waitFor({ state: "attached" });
  await page.locator(".reader-reading-scroll").waitFor();
  return page;
}

// Pause real Blob reads at the stream boundary, without replacing package logic.
// A cancelled producer deliberately finishes late to exercise stale-task guards.
async function installGate(page) {
  await page.evaluate(() => {
    const original = Blob.prototype.stream;
    const gate = { enabled: false, blocked: 0, cancelled: 0, release: [] };
    window.__packageGate = gate;
    Blob.prototype.stream = function () {
      const reader = original.call(this).getReader();
      let cancelled = false;
      return new ReadableStream({
        async pull(target) {
          if (gate.enabled) {
            gate.blocked++;
            await new Promise((resolve) => gate.release.push(resolve));
          }
          if (cancelled) return;
          const chunk = await reader.read();
          if (cancelled) return;
          if (chunk.done) target.close();
          else target.enqueue(chunk.value);
        },
        cancel(reason) {
          cancelled = true;
          gate.cancelled++;
          return reader.cancel(reason);
        },
      });
    };
  });
}
async function block(page) {
  await page.evaluate(() => {
    window.__packageGate.enabled = true;
    window.__packageGate.blocked = 0;
  });
}
async function release(page) {
  await page.evaluate(() => {
    window.__packageGate.enabled = false;
    for (const resolve of window.__packageGate.release.splice(0)) resolve();
  });
}
async function blocked(page) {
  await page.waitForFunction(() => window.__packageGate.blocked > 0);
  await page.getByRole("progressbar", { name: "资料包处理进度" }).waitFor();
}
async function cancel(page) {
  await page.getByRole("button", { name: "取消资料包操作", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已取消资料包操作" }).waitFor();
  await page.getByRole("progressbar", { name: "资料包处理进度" }).waitFor({ state: "hidden" });
}

try {
  const a = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await pageIn(a);
  const downloads = [];
  page.on("download", (download) => downloads.push(download));
  await page.getByLabel("导入阅读文件").setInputFiles({
    name: "cancel.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 可取消资料包\n\n取消验证证据需要完整保留。"),
  });
  await page.getByText("导入完成", { exact: true }).waitFor();
  await open(page);
  await page.getByLabel("新集合名称").fill("取消与重试");
  await page.getByRole("button", { name: "创建集合", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "工作区搜索", exact: true }).click();
  await page.getByRole("textbox", { name: "全局搜索", exact: true }).fill("取消验证证据");
  await page.getByRole("tab", { name: /^阅读器/u }).click();
  await page.getByRole("listbox", { name: "搜索结果" }).getByRole("option").first().waitFor();
  await page.getByRole("button", { name: "保存当前结果", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: /资料集合 ·/u }).click();
  await page.getByText("Reader 完整资料包", { exact: true }).click();
  await page.getByLabel("打包集合：取消与重试").check();
  await installGate(page);

  await block(page);
  await page.getByRole("button", { name: "检查资料包", exact: true }).click();
  await blocked(page);
  await cancel(page);
  assert.equal(await page.getByLabel("资料包导出预览").count(), 0);
  // Complete the replacement task while the previous producer is still paused.
  await page.evaluate(() => {
    window.__packageGate.enabled = false;
  });
  await page.getByRole("button", { name: "检查资料包", exact: true }).click();
  await page.getByLabel("资料包导出预览").waitFor();
  await release(page);
  assert.match(await page.getByLabel("资料包导出预览").innerText(), /1 本 Reader/u);

  await block(page);
  await page.getByRole("button", { name: "生成并下载资料包", exact: true }).click();
  await blocked(page);
  await cancel(page);
  await release(page);
  assert.equal(downloads.length, 0);

  await block(page);
  await page.getByRole("button", { name: "生成并下载资料包", exact: true }).click();
  await blocked(page);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "生成并下载资料包", exact: true })
    .waitFor({ state: "hidden" });
  await release(page);
  await open(page);
  await page.getByText("Reader 完整资料包", { exact: true }).click();
  assert.equal(await page.getByLabel("资料包导出预览").count(), 0);
  await page.getByLabel("打包集合：取消与重试").check();
  await page.getByRole("button", { name: "检查资料包", exact: true }).click();
  await page.getByLabel("资料包导出预览").waitFor();
  // A cancelled save may finish opening its target after a replacement task.
  await page.evaluate(() => {
    const gate = {
      entered: false,
      writes: 0,
      closes: 0,
      aborts: 0,
      release: undefined,
      activated: false,
    };
    window.__packageFileGate = gate;
    window.showSaveFilePicker = async () => {
      gate.activated = navigator.userActivation.isActive;
      return {
        createWritable: async () => {
          gate.entered = true;
          await new Promise((resolve) => {
            gate.release = resolve;
          });
          return new WritableStream({
            write() {
              gate.writes++;
            },
            close() {
              gate.closes++;
            },
            abort() {
              gate.aborts++;
            },
          });
        },
      };
    };
  });
  await page.getByRole("button", { name: "直接保存当前卷", exact: true }).click();
  await page.waitForFunction(() => window.__packageFileGate.entered);
  await cancel(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "生成并下载资料包", exact: true }).click();
  const buffer = await readFile(await (await downloading).path());
  assert.equal(downloads.length, 1);
  await page.evaluate(() => window.__packageFileGate.release());
  await page.waitForFunction(() => window.__packageFileGate.aborts === 1);
  assert.deepEqual(
    await page.evaluate(() => ({
      activated: window.__packageFileGate.activated,
      writes: window.__packageFileGate.writes,
      closes: window.__packageFileGate.closes,
    })),
    { activated: true, writes: 0, closes: 0 },
  );
  assert.ok((await page.getByLabel("资料包分卷清单").innerText()).includes("已触发下载"));
  assert.ok(await page.evaluate(() => window.__packageGate.cancelled >= 3));
  await a.close();

  const b = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const restored = await pageIn(b);
  await open(restored);
  await restored.getByText("Reader 完整资料包", { exact: true }).click();
  await installGate(restored);
  const choose = () =>
    restored
      .getByLabel("选择 Reader 资料包", { exact: true })
      .setInputFiles({ name: "package.zip", mimeType: "application/zip", buffer });
  await block(restored);
  await choose();
  await blocked(restored);
  await cancel(restored);
  assert.equal(await restored.getByLabel("资料包恢复预览").count(), 0);
  assert.equal(await restored.locator('[aria-label="集合摘录"] article').count(), 0);
  await restored.evaluate(() => {
    window.__packageGate.enabled = false;
  });
  await choose();
  await restored.getByLabel("资料包恢复预览").waitFor();
  await release(restored);
  await restored.getByRole("button", { name: "确认恢复 Reader 资料包", exact: true }).click();
  await saved(restored);
  assert.equal(await restored.locator('[aria-label="集合摘录"] article').count(), 1);
  assert.deepEqual(errors, []);
  await b.close();
  console.log(
    "Research package cancellation PASSED: inspect, export, unmount, late completion and immediate retry",
  );
} finally {
  await browser.close();
}
