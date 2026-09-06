import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function openCollections(target = page) {
  await target.getByRole("button", { name: "打开全局搜索" }).click();
  await target.getByRole("button", { name: /资料集合 ·/u }).click();
}
async function openBackup(target = page) {
  await target.getByText("集合备份与恢复", { exact: true }).click();
}
async function choose(raw, target = page) {
  await target.getByLabel("选择集合备份", { exact: true }).setInputFiles({
    name: "research.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
}
async function saved(target = page) {
  await target.getByRole("status").filter({ hasText: "已保存到本地" }).waitFor();
}
const notes = (target = page) =>
  target.getByRole("textbox", { name: "笔记：备份证据", exact: true });
try {
  await page.goto(`${origin}/studio`, { waitUntil: "networkidle" });
  const citationModule =
    "/@fs" + fileURLToPath(new URL("../packages/core/src/citation.ts", import.meta.url));
  const citation = await page.evaluate(async (url) => {
    const { createTextCitation, textVersion } = await import(url);
    return createTextCitation(
      "备份原始证据。",
      {
        scope: JSON.stringify(["reader", "backup-source", "s1"]),
        unit: "s1",
        offset: 0,
        version: textVersion("备份原始证据。"),
      },
      { start: 0, end: 6 },
    );
  }, citationModule);
  const fixture = {
    format: "bcr-research-backup",
    version: 1,
    createdAt: 100,
    includesDrafts: true,
    library: {
      version: 1,
      collections: [
        {
          id: "backup-a",
          name: "研究备份",
          excerpts: [
            {
              id: "backup-e",
              documentId: "reader:backup",
              title: "备份证据",
              source: "Reader",
              owner: "reader",
              route: "/reader?book=backup-source&section=s1",
              text: citation.exact,
              citation,
              savedAt: 1,
              note: "已保存理解",
              draft: "备份中的草稿",
            },
          ],
        },
        { id: "backup-b", name: "整理目标", excerpts: [] },
      ],
    },
  };
  const raw = JSON.stringify(fixture);
  await openCollections();
  await openBackup();
  await choose(raw);
  await page.getByLabel("集合导入预览").waitFor();
  assert.equal(await page.locator('[aria-label="集合摘录"] article').count(), 0);
  await page.getByRole("button", { name: "取消导入", exact: true }).click();
  assert.equal(await page.locator('[aria-label="集合摘录"] article').count(), 0);
  await choose('{"format":"wrong"}');
  await page.getByRole("status").filter({ hasText: "无法导入" }).waitFor();
  await choose(raw);
  await page.getByRole("button", { name: "确认导入集合", exact: true }).click();
  await saved();
  assert.equal(await notes().inputValue(), "备份中的草稿");
  await page.locator('[data-citation-status="unverified"]').waitFor();
  await choose(raw);
  await page.getByText(/跳过 2 个完全相同的集合/u).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "确认导入集合", exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "取消导入", exact: true }).click();
  await page.reload({ waitUntil: "networkidle" });
  await openCollections();
  assert.equal(await notes().inputValue(), "备份中的草稿");

  // A read failure must be visible even when the displayed value equals the saved note.
  await page.getByRole("button", { name: "工作区搜索", exact: true }).click();
  await page.evaluate(() => {
    window.originalDraftGet = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("bcr/research-draft/")) throw new Error("read blocked");
      return window.originalDraftGet.call(this, key);
    };
  });
  await page.getByRole("button", { name: /资料集合 ·/u }).click();
  await page.getByRole("button", { name: "重试读取草稿", exact: true }).waitFor();
  assert.equal(await notes().isDisabled(), true);
  await page.evaluate(() => {
    Storage.prototype.getItem = window.originalDraftGet;
  });
  await page.getByRole("button", { name: "重试读取草稿", exact: true }).click();
  assert.equal(await notes().inputValue(), "备份中的草稿");

  // Simulate quota failure. Switching panels retains memory, saving clears the error.
  await page.evaluate(() => {
    window.originalDraftSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("bcr/research-draft/")) throw new Error("quota full");
      return window.originalDraftSet.call(this, key, value);
    };
  });
  await notes().fill("故障期间保留的理解");
  await page.getByRole("button", { name: "重试保留草稿", exact: true }).waitFor();
  await page.getByRole("button", { name: "工作区搜索", exact: true }).click();
  await page.getByRole("button", { name: /资料集合 ·/u }).click();
  assert.equal(await notes().inputValue(), "故障期间保留的理解");
  await page.getByLabel("移动目标：备份证据", { exact: true }).selectOption("backup-b");
  assert.equal(
    await page.getByRole("button", { name: "移动摘录", exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await saved();
  await page
    .getByRole("button", { name: "重试保留草稿", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "移动摘录", exact: true }).isEnabled(), true);
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalDraftSet;
  });
  await notes().fill("新的未保存草稿");
  await openBackup();
  await page.getByLabel("包含未保存草稿", { exact: true }).check();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载集合备份", exact: true }).click();
  const downloaded = await readFile(await (await downloading).path(), "utf8");
  const bundle = JSON.parse(downloaded);
  assert.equal(bundle.library.collections[0].excerpts[0].note, "故障期间保留的理解");
  assert.equal(bundle.library.collections[0].excerpts[0].draft, "新的未保存草稿");
  assert.deepEqual(bundle.library.collections[0].excerpts[0].citation, citation);

  // A conflicting restore is previewed as a copy; cancel preserves local edits.
  await choose(raw);
  await page.getByText(/冲突副本 1 个/u).waitFor();
  await page.getByRole("button", { name: "取消导入", exact: true }).click();
  assert.equal(await notes().inputValue(), "新的未保存草稿");

  // An independent browser storage context must recover the bundle without source files.
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const restored = await fresh.newPage();
  restored.on("pageerror", (error) => errors.push(error.message));
  await restored.goto(`${origin}/studio`, { waitUntil: "networkidle" });
  await openCollections(restored).catch(async (error) => {
    console.error("Fresh context:", await restored.locator("body").innerText());
    throw error;
  });
  await openBackup(restored);
  await choose(downloaded, restored);
  await restored.getByRole("button", { name: "确认导入集合", exact: true }).click();
  await saved(restored);
  assert.equal(await notes(restored).inputValue(), "新的未保存草稿");
  await restored.locator('[data-citation-status="unverified"]').waitFor();
  await restored.reload({ waitUntil: "networkidle" });
  await openCollections(restored);
  await openBackup(restored);
  assert.equal(await notes(restored).inputValue(), "新的未保存草稿");
  await mkdir(new URL("./shots/", import.meta.url), { recursive: true });
  await restored.screenshot({
    path: new URL("./shots/research-backup-mobile.png", import.meta.url).pathname,
  });
  const rect = await restored.getByRole("dialog").boundingBox();
  assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= 390 && rect.y + rect.height <= 844);
  await fresh.close();

  // Browser project lease prevents a second tab from opening the writable store.
  const second = await context.newPage();
  await second.goto(`${origin}/studio`);
  await second.getByText(/already open in another session/u).waitFor();
  await second.close();

  await page.getByRole("button", { name: "删除集合", exact: true }).click();
  await page.getByRole("button", { name: "确认删除集合", exact: true }).click();
  await saved();
  await page.waitForFunction(
    () => !Object.keys(localStorage).some((key) => key.startsWith("bcr/research-draft/v1/")),
  );
  assert.deepEqual(errors, []);
  console.log("Research backup and draft recovery verification PASSED");
} finally {
  await browser.close();
}
