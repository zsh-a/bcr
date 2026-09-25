import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/knowledge`);
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("笔记标题", { exact: true }).fill("备份恢复验证");
  const body = page.getByLabel("笔记正文", { exact: true });
  const saved = () =>
    page
      .locator('[data-testid="knowledge-status"] .knowledge-status-line')
      .filter({ hasText: /^(已保存|已同步)/u })
      .waitFor();
  await body.fill("来自备份的正文");
  await saved();
  const id = new URL(page.url()).searchParams.get("note");
  const downloading = page.waitForEvent("download");
  await page.getByText("导入、导出与备份", { exact: true }).click();
  await page.getByRole("button", { name: "导出知识库", exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  assert.ok(path);
  await body.fill("当前本机的新正文");
  await saved();
  await page.getByRole("button", { name: "恢复 ZIP 备份", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "恢复备份", exact: true });
  await dialog.waitFor();
  const panel = dialog.getByRole("region", { name: "恢复知识库备份", exact: true });
  await panel.getByLabel("选择知识库备份", { exact: true }).setInputFiles(path);
  await panel.getByText(/将新增 0 篇/).waitFor();
  assert.equal(await panel.getByRole("radio").count(), 3, "restore mode offers keep/copy/replace");
  await panel.getByText(/替换 0 篇、跳过 1 篇/).waitFor();
  await panel.getByLabel("使用备份版本替换同 ID 的内容").check();
  await panel.getByText(/替换 1 篇/).waitFor();
  await panel.getByText(/跳过 0 篇/).waitFor();
  assert.ok((await body.textContent()).includes("当前本机的新正文"), "preview must not write");
  await panel.getByRole("button", { name: "确认恢复", exact: true }).click();
  await page.getByText("备份已恢复到本机，未修改同步连接", { exact: true }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="笔记正文"]')?.textContent?.includes("来自备份的正文"),
  );
  assert.equal(new URL(page.url()).searchParams.get("note"), id);
  await page.reload();
  await saved();
  await page.getByText("导入、导出与备份", { exact: true }).click();
  assert.ok((await body.textContent()).includes("来自备份的正文"));
  await page.getByRole("button", { name: "恢复 ZIP 备份", exact: true }).click();
  await panel.getByLabel("选择知识库备份", { exact: true }).setInputFiles(path);
  await panel.getByText(/将新增 0 篇/).waitFor();
  await page.getByRole("button", { name: "关闭恢复备份", exact: true }).click();
  await body.fill("预览后的新修改");
  await saved();
  await page.getByRole("button", { name: "恢复 ZIP 备份", exact: true }).click();
  await panel.getByRole("button", { name: "确认恢复", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "预览后知识库已变化" }).waitFor();
  assert.ok((await body.textContent()).includes("预览后的新修改"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    const bounds = await panel.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
  }
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 375, height: 812 });
  await panel.scrollIntoViewIfNeeded();
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({ path: "scripts/shots/knowledge-restore-mobile.png" });
  console.log("Knowledge backup restore verification PASSED");
} finally {
  await browser.close();
}
