/* Isolated browser: Reader/Document/Media evidence → collection → notes → export → restore. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function openSearch(query) {
  await page.getByRole("button", { name: "打开全局搜索" }).click();
  await page.getByRole("textbox", { name: "全局搜索", exact: true }).fill(query);
}
async function saveCurrent() {
  await page.getByRole("button", { name: "保存当前结果", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已保存到本地" }).waitFor();
}
async function collections() {
  await page.getByRole("button", { name: /资料集合 ·/u }).click();
}
function wav() {
  const rate = 16000,
    count = 9 * rate;
  const buffer = Buffer.alloc(44 + count * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const time = i / rate;
    const pulse = time % 2 > 0.3 && time % 2 < 1.3;
    buffer.writeInt16LE(
      pulse ? Math.round(14000 * Math.sin(2 * Math.PI * 220 * time)) : 0,
      44 + i * 2,
    );
  }
  return buffer;
}
try {
  await page.goto(`${origin}/reader`, { waitUntil: "networkidle" });
  await page.getByLabel("导入阅读文件").setInputFiles({
    name: "research-long.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# 研究章节\n\n" +
        "背景内容。".repeat(3000) +
        "独特研究证据用于引用回跳。" +
        "后续内容。".repeat(100),
    ),
  });
  await page.getByText("导入完成", { exact: true }).waitFor();
  await openSearch("独特研究证据");
  await page.getByRole("option").filter({ hasText: "独特研究证据" }).first().waitFor();
  await collections();
  await page.getByLabel("新集合名称").fill("跨格式研究");
  await page.getByRole("button", { name: "创建集合", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已保存到本地" }).waitFor();
  await page.getByRole("button", { name: "工作区搜索", exact: true }).click();
  await saveCurrent();
  await saveCurrent(); // Same snapshot must not be duplicated.
  await collections();
  assert.equal(await page.locator('[aria-label="集合摘录"] article').count(), 1);
  await page.getByRole("textbox", { name: /^笔记：/u }).fill("核对了章节中的原始证据");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await page.getByText("笔记尚未保存", { exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "回到原文", exact: true }).click();
  await page.waitForURL(/\/reader\?.*start=/u);
  assert.ok(Number(new URL(page.url()).searchParams.get("start")) > 12000);
  const readerLink = page.url();

  // A durable block from the first job remains indexed after selecting the second.
  await page.goto(`${origin}/documents`, { waitUntil: "networkidle" });
  for (const [name, marker] of [
    ["first.md", "文档证据甲"],
    ["second.md", "文档证据乙"],
  ]) {
    await page.getByLabel("导入文档或图片文件").setInputFiles({
      name,
      mimeType: "text/markdown",
      buffer: Buffer.from(`# ${name}\n\n${marker} 保留完整来源。`),
    });
    await page.locator(".document-job-copy strong", { hasText: name }).waitFor();
    await page.locator(".document-stage-card", { hasText: "Extract" }).click();
    await page.getByRole("button", { name: "运行 Extract", exact: true }).click();
    await page.locator(".document-content-card").waitFor();
  }
  await openSearch("文档证据甲");
  await page.getByRole("option").filter({ hasText: "原文" }).first().waitFor();
  await page.getByRole("option").filter({ hasText: "原文" }).first().hover();
  await saveCurrent();
  await page.keyboard.press("Escape");

  await page.goto(`${origin}/media`, { waitUntil: "networkidle" });
  await page
    .locator('.media-studio input[type="file"]')
    .setInputFiles({ name: "research.wav", mimeType: "audio/wav", buffer: wav() });
  await page.locator('.media-studio select[title="识别引擎"]').selectOption("demo");
  await page.getByRole("button", { name: "生成字幕", exact: true }).click();
  const cue = page.locator('[data-testid="cue-editor"] input').nth(1);
  await cue.waitFor();
  await cue.fill("音频证据时间点");
  await openSearch("音频证据时间点");
  await page.getByRole("option").filter({ hasText: "音频证据时间点" }).waitFor();
  await saveCurrent();
  await page.getByRole("option").filter({ hasText: "音频证据时间点" }).click();
  await page.waitForURL(/\/media\?.*time=/u);
  const time = Number(new URL(page.url()).searchParams.get("time"));
  assert.ok(time > 0);
  await page.waitForFunction(
    (time) => Math.abs(document.querySelector("video").currentTime - time) < 0.1,
    time,
  );
  await page.evaluate(() => {
    document.querySelector("video").currentTime = 0;
  });
  await openSearch("音频证据时间点");
  await page.getByRole("option").filter({ hasText: "音频证据时间点" }).click();
  await page.waitForFunction(
    (time) => Math.abs(document.querySelector("video").currentTime - time) < 0.1,
    time,
  );

  await page.reload({ waitUntil: "networkidle" });
  await openSearch("");
  await collections();
  assert.equal(await page.locator('[aria-label="集合摘录"] article').count(), 3);
  assert.equal(
    await page
      .getByRole("textbox", { name: /^笔记：/u })
      .first()
      .inputValue(),
    "核对了章节中的原始证据",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Markdown", exact: true }).click();
  const download = await downloadPromise;
  const markdown = await readFile(await download.path(), "utf8");
  for (const marker of ["独特研究证据", "文档证据甲", "音频证据时间点", "核对了章节中的原始证据"])
    assert.ok(markdown.includes(marker));
  assert.ok(markdown.includes("/reader?book="));
  assert.ok(markdown.includes("/documents?job="));
  assert.ok(markdown.includes("/media?source="));
  await mkdir(new URL("./shots/", import.meta.url), { recursive: true });
  await page.screenshot({
    path: new URL("./shots/research-collections.png", import.meta.url).pathname,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL("./shots/research-mobile.png", import.meta.url).pathname });
  const popup = await page.getByRole("dialog").boundingBox();
  assert.ok(popup && popup.x >= 0 && popup.x + popup.width <= 390 && popup.y + popup.height <= 844);
  await page.keyboard.press("Escape");
  await page.goto(readerLink, { waitUntil: "networkidle" });
  await page.getByLabel("阅读内容").waitFor();
  assert.deepEqual(errors, []);
  console.log("Research collections verification PASSED");
} finally {
  await browser.close();
}
