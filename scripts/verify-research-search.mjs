import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const note = () => page.getByRole("textbox", { name: /^笔记：/u });
const saved = () => page.getByRole("status").filter({ hasText: "已保存到本地" }).waitFor();
async function search(query) {
  await page.getByRole("button", { name: "工作区搜索", exact: true }).click();
  await page.getByRole("textbox", { name: "全局搜索", exact: true }).fill(query);
}
async function collection() {
  await page.getByRole("button", { name: /资料集合 ·/u }).click();
}
async function create(name) {
  await page.getByLabel("新集合名称").fill(name);
  await page.getByRole("button", { name: "创建集合", exact: true }).click();
  await saved();
  return page.getByLabel("当前集合", { exact: true }).inputValue();
}
try {
  await page.goto(`${origin}/reader`, { waitUntil: "networkidle" });
  await page.getByLabel("导入阅读文件").setInputFiles({
    name: "research-search.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 搜索笔记来源\n\n集合原始证据需要核对。"),
  });
  await page.getByText("导入完成", { exact: true }).waitFor();
  await page.getByRole("button", { name: "打开全局搜索" }).click();
  await collection();
  const first = await create("笔记集合甲");
  await search("集合原始证据");
  await page.getByRole("listbox", { name: "搜索结果" }).getByRole("option").first().waitFor();
  await page.getByRole("button", { name: "保存当前结果", exact: true }).click();
  await saved();
  await collection();
  const second = await create("笔记集合乙");
  await page.getByLabel("当前集合", { exact: true }).selectOption(first);
  const savedNote = "背景理解。".repeat(450) + "独特笔记证据ＡＬＰＨＡ";
  await note().fill(savedNote);
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await saved();
  await note().fill("尚未保存的独特草稿");
  await search("独特草稿");
  await page.getByText("没有找到匹配内容", { exact: true }).waitFor();
  await search("独特笔记证据alpha");
  await page.getByRole("tab", { name: /^资料集合/u }).click();
  await page.getByLabel("集合搜索范围").selectOption(second);
  await page.getByText("没有找到匹配内容", { exact: true }).waitFor();
  await page.getByLabel("集合搜索范围").selectOption(first);
  const result = page
    .getByRole("listbox", { name: "搜索结果" })
    .getByRole("option")
    .filter({ hasText: "命中已保存笔记" })
    .first();
  await result.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await result.click();
  const mark = page.locator('[data-research-hit="note"]');
  await mark.waitFor();
  assert.equal(await mark.innerText(), "独特笔记证据ＡＬＰＨＡ");
  assert.equal(await note().inputValue(), "尚未保存的独特草稿");
  await page.waitForFunction(() => {
    const mark = document.querySelector('[data-research-hit="note"]');
    const box = mark?.getBoundingClientRect();
    const parent = mark?.closest('[aria-label="已保存笔记命中"]')?.getBoundingClientRect();
    return (
      box &&
      parent &&
      box.top >= parent.top - 1 &&
      box.bottom <= parent.bottom + 1 &&
      box.top >= 0 &&
      box.bottom <= innerHeight
    );
  });
  await mkdir(new URL("./shots/", import.meta.url), { recursive: true });
  await page.screenshot({
    path: new URL("./shots/research-search-mobile.png", import.meta.url).pathname,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await note().fill("更新后的笔记标记");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await saved();
  await search("独特笔记证据alpha");
  await page.getByText("没有找到匹配内容", { exact: true }).waitFor();
  await search("更新后的笔记标记");
  await page.getByRole("listbox", { name: "搜索结果" }).getByRole("option").first().click();
  await page.getByLabel(/^移动目标：/u).selectOption(second);
  await page.getByRole("button", { name: "移动摘录", exact: true }).click();
  await saved();
  await search("更新后的笔记标记");
  await page.getByLabel("集合搜索范围").selectOption(first);
  await page.getByText("没有找到匹配内容", { exact: true }).waitFor();
  await page.getByLabel("集合搜索范围").selectOption(second);
  await page
    .getByRole("listbox", { name: "搜索结果" })
    .getByRole("option")
    .filter({ hasText: "笔记集合乙" })
    .first()
    .click();
  await page.getByRole("button", { name: "重命名集合", exact: true }).click();
  await page.getByLabel("集合新名称").fill("笔记集合已更名");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await saved();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "打开全局搜索" }).click();
  await search("更新后的笔记标记");
  await page
    .getByRole("listbox", { name: "搜索结果" })
    .getByRole("option")
    .filter({ hasText: "笔记集合已更名" })
    .first()
    .click();
  assert.equal(await note().inputValue(), "更新后的笔记标记");
  await page.locator('[data-research-hit="note"]').waitFor();
  await search("集合原始证据");
  await page.getByRole("tab", { name: /^资料集合/u }).click();
  await page
    .getByRole("listbox", { name: "搜索结果" })
    .getByRole("option")
    .filter({ hasText: "命中摘录正文" })
    .first()
    .click();
  await page.locator('[data-research-hit="text"]').waitFor();
  await page.getByRole("button", { name: "回到原文", exact: true }).click();
  await page.waitForURL(/\/reader\?.*start=/u);
  await page.locator('[data-reader-search-match="true"]').first().waitFor();
  await page.getByRole("button", { name: "打开全局搜索" }).click();
  await search("更新后的笔记标记");
  await page.getByRole("listbox", { name: "搜索结果" }).getByRole("option").first().click();
  await page.getByRole("button", { name: "移除摘录", exact: true }).click();
  await saved();
  await search("更新后的笔记标记");
  await page.getByText("没有找到匹配内容", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Research note search verification PASSED");
} finally {
  await browser.close();
}
