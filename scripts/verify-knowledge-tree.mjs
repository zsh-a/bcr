import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5213").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const title = () => page.getByLabel("笔记标题", { exact: true });
const body = () => page.getByLabel("笔记正文", { exact: true });
const saved = () =>
  page
    .locator('[data-testid="knowledge-status"] .knowledge-status-line')
    .filter({ hasText: /^(已保存|已同步)/u })
    .waitFor({ state: "attached" });
const nav = () => page.getByRole("navigation", { name: "笔记列表" });
const rows = () => nav().locator(".knowledge-file-note");
const folderRow = (name) =>
  nav()
    .locator(".knowledge-file-folder > summary")
    .filter({ hasText: new RegExp(`^${name}$`, "u") });
const menu = () => page.getByRole("menu", { name: "目录树操作" });
const nameInput = () => page.getByLabel("目录名称", { exact: true });
const summaries = () => nav().locator(".knowledge-file-folder > summary").allInnerTexts();
const notePaths = () =>
  rows().evaluateAll((els) => els.map((el) => el.getAttribute("title")?.split("\n").at(-1)));
const folderPaths = () =>
  nav()
    .locator(".knowledge-folder-move")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label")?.replace("移动文件夹 ", "")),
    );
const undo = () =>
  page
    .locator(".knowledge-undo-toast")
    .getByRole("button", { name: "撤销", exact: true })
    .click()
    .then(() => page.waitForTimeout(400));

async function create(name, content) {
  const old = page.url();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.waitForURL((url) => url.href !== old);
  await page.waitForFunction(() => document.querySelector('[aria-label="笔记标题"]')?.value === "");
  await title().fill(name);
  await body().fill(content);
  await saved();
  return new URL(page.url()).searchParams.get("note");
}
async function createFolder(value, viaMenu = false) {
  if (viaMenu) await menu().getByRole("menuitem", { name: "新建子目录", exact: true }).click();
  else await page.getByRole("button", { name: "新建目录", exact: true }).click();
  await nameInput().fill(value);
  await nameInput().press("Enter");
  await page.waitForTimeout(300);
}
try {
  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  if ((await page.locator(".knowledge-app").getAttribute("data-sidebar")) !== "expanded") {
    const expand = page.getByRole("button", { name: "展开侧栏" });
    if (await expand.count()) await expand.click();
  }
  const a = await create("Alpha", "# Alpha\n\n内容。");
  const b = await create("Beta", "# Beta\n\n[[Alpha]]。");

  // 行内新建目录：多级路径一次成型；Esc 放弃不留痕。
  await createFolder("工作/项目");
  assert.deepEqual(await summaries(), ["工作", "项目"]);
  await page.getByRole("button", { name: "新建目录", exact: true }).click();
  await nameInput().fill("放弃我");
  await nameInput().press("Escape");
  assert.deepEqual(await summaries(), ["工作", "项目"]);

  // 根空白处右键：只有新建入口。
  await nav().click({ button: "right", position: { x: 24, y: 600 } });
  await menu().waitFor();
  assert.deepEqual(await menu().getByRole("menuitem").allTextContents(), ["新建目录", "新建笔记"]);
  await page.keyboard.press("Escape");
  await menu().waitFor({ state: "hidden" });

  // 目录右键：子目录/重命名/移动/删除；「新建子目录」在当前目录下落位。
  await folderRow("工作").click({ button: "right" });
  await menu().waitFor();
  assert.deepEqual(await menu().getByRole("menuitem").allTextContents(), [
    "新建子目录",
    "重命名目录",
    "移动到…",
    "删除目录",
  ]);
  await createFolder("草稿", true);
  assert.deepEqual(await summaries(), ["工作", "草稿", "项目"]);

  // 重命名目录：行内输入预填原名，Enter 后目录与登记一起改名。
  await folderRow("草稿").click({ button: "right" });
  await menu().getByRole("menuitem", { name: "重命名目录", exact: true }).click();
  assert.equal(await nameInput().inputValue(), "草稿");
  await nameInput().fill("素材");
  await nameInput().press("Enter");
  await page.waitForTimeout(300);
  assert.deepEqual(await summaries(), ["工作", "素材", "项目"]);

  // 拖放笔记进目录：路径即刻变化，撤销吐司一步还原。
  await rows().filter({ hasText: "Beta" }).dragTo(folderRow("项目"));
  await page.waitForTimeout(300);
  assert.ok(
    (await notePaths()).some((path) => path?.startsWith("工作/项目/")),
    `dragged note lands in the folder: ${await notePaths().then(String)}`,
  );
  await undo();
  assert.deepEqual((await notePaths()).toSorted(), [`${a}.md`, `${b}.md`].toSorted());

  // 拖放目录到另一个目录：整棵前缀搬家（含显式子目录登记），撤销还原。
  await createFolder("外部");
  await folderRow("工作").dragTo(folderRow("外部"));
  await page.waitForTimeout(300);
  assert.ok((await folderPaths()).includes("外部/工作/项目"), await folderPaths().then(String));
  assert.equal((await folderPaths()).includes("工作/项目"), false);
  await undo();
  assert.ok((await folderPaths()).includes("工作/项目"), await folderPaths().then(String));

  // 笔记右键菜单与重命名（聚焦标题框）。
  await rows().filter({ hasText: "Alpha" }).click({ button: "right" });
  await menu().waitFor();
  assert.deepEqual(await menu().getByRole("menuitem").allTextContents(), [
    "打开",
    "在新标签打开",
    "重命名",
    "移动到…",
    "收藏",
    "删除",
  ]);
  await menu().getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "笔记标题",
  );
  await title().fill("Alpha 重命名");
  await saved();

  // 空目录删除不需要确认；含内容的目录先弹确认，确认后笔记归根。
  await createFolder("空目录");
  await folderRow("空目录").click({ button: "right" });
  await menu().getByRole("menuitem", { name: "删除目录", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal((await summaries()).includes("空目录"), false, "empty folder deletes instantly");
  await rows().filter({ hasText: "Beta" }).dragTo(folderRow("项目"));
  await folderRow("工作").click({ button: "right" });
  await menu().getByRole("menuitem", { name: "删除目录", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除目录", exact: true });
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /移到库根/u);
  await dialog.getByRole("button", { name: "确认删除目录", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await summaries(), ["外部"]);
  assert.ok(
    (await notePaths()).includes(`${b}.md`),
    `deleted folder returns its notes to the root: ${await notePaths().then(String)}`,
  );

  assert.deepEqual(errors, []);
  console.log(
    "knowledge tree PASSED: inline create/rename, context menus, note/folder drag & drop with undo, guarded folder delete",
  );
} catch (error) {
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
