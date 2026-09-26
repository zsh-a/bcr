import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const title = page.getByLabel("笔记标题", { exact: true });
const body = page.getByLabel("笔记正文", { exact: true });
const saved = () =>
  page
    .locator('[data-testid="knowledge-status"] .knowledge-status-line')
    .filter({ hasText: /^(已保存|已同步)/u })
    .waitFor({ state: "attached" });
async function create(name) {
  const old = page.url();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.waitForURL((url) => url.href !== old);
  await page.waitForFunction(() => document.querySelector('[aria-label="笔记标题"]')?.value === "");
  await title.fill(name);
  await saved();
  return new URL(page.url()).searchParams.get("note");
}
async function tab(name) {
  await page
    .getByRole("navigation", { name: "打开的笔记" })
    .getByRole("button", { name, exact: true })
    .click();
  await page.waitForFunction(
    (value) => document.querySelector('[aria-label="笔记标题"]')?.value === value,
    name,
  );
}
const sourceToggle = () => page.getByRole("button", { name: "源码", exact: true });
// Live-preview widgets hide raw Markdown in edit mode; read via 源码 mode.
async function readBody() {
  const toggle = sourceToggle();
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  const text = (await body.locator(".cm-line").allInnerTexts()).join("\n");
  if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
  return text;
}
const moveButton = () => page.getByRole("button", { name: "移动笔记", exact: true });
async function openMove(name = "移动笔记") {
  await moveButton().click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  await dialog.waitFor();
  return dialog;
}
async function newFolder(dialog, name) {
  await dialog.getByLabel("新建文件夹名称", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "新建文件夹", exact: true }).click();
}
const destLine = (dialog) => dialog.locator(".knowledge-move-path").nth(1).innerText();
// DiffView is one inline flow: rebuild 修改前/修改后 text from del/ins spans.
const diffForms = (dialog) =>
  dialog.locator(".knowledge-diff-flow").evaluate((el) => {
    let before = "",
      after = "";
    for (const node of el.children) {
      const text = node.textContent ?? "";
      if (node.tagName === "DEL") before += text;
      else if (node.tagName === "INS") after += text;
      else {
        before += text;
        after += text;
      }
    }
    return { before, after };
  });
// 路径条已删除：切回列表视图，用路径筛选验证笔记当前所在路径。
async function atPath(query, name) {
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  const search = page.getByLabel("搜索个人笔记", { exact: true });
  await search.fill(query);
  const list = page.getByRole("navigation", { name: "笔记列表" });
  const cards = list.getByRole("button");
  await cards.filter({ hasText: name }).waitFor();
  const matched = await cards.count();
  await search.fill("");
  return matched === 1;
}
try {
  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  const a = await create("Alpha");
  // Instant folder-picker move: 新建文件夹 creates AND selects the destination.
  let dialog = await openMove();
  await dialog.getByText("已解析的笔记链接会保持原目标", { exact: false }).waitFor();
  assert.ok(
    (await dialog.innerText()).includes(
      "已解析的笔记链接会保持原目标。图片、附件及未解析链接暂不自动调整；集合与稳定 ID 不变。",
    ),
    "write-safety note is shown",
  );
  assert.equal(await dialog.getByRole("group", { name: "选择目标文件夹" }).count(), 1);
  // The preview-confirm wizard is gone.
  for (const absent of ["预览移动", "刷新预览", "确认移动"]) {
    assert.equal(
      await dialog.getByRole("button", { name: absent, exact: true }).count(),
      0,
      absent,
    );
  }
  assert.equal(await dialog.getByLabel("目标笔记路径", { exact: true }).count(), 0);
  assert.equal(await dialog.getByLabel("目标文件夹路径", { exact: true }).count(), 0);
  assert.equal(await dialog.getByText("将修改", { exact: false }).count(), 0);
  await newFolder(dialog, "old");
  assert.ok((await dialog.locator(".knowledge-move-created").innerText()).includes("新建："));
  assert.equal(
    await dialog.getByRole("button", { name: "old", exact: true }).getAttribute("aria-pressed"),
    "true",
    "created folder becomes the destination",
  );
  assert.ok((await destLine(dialog)).includes(`将移动到：old/${a}.md`));
  await dialog.getByRole("button", { name: "移动笔记", exact: true }).click();
  const status = dialog.locator('p[role="status"]');
  await status.waitFor();
  const first = await status.innerText();
  assert.ok(first.includes("已移动，无需更新链接。"), first);
  assert.ok(first.includes("已保存到本机，下次同步时提交。"), first);
  assert.ok(
    (await dialog.locator(".knowledge-review-notes").innerText()).includes(`路径 · old/${a}.md`),
  );
  const toast0 = page.locator(".knowledge-undo-toast").filter({ hasText: "已移动，无需更新链接" });
  await toast0.waitFor();
  assert.equal(await toast0.getByRole("button", { name: "撤销", exact: true }).count(), 1);
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const b = await create("Beta");
  // Clicking a note row in the picker selects its parent folder as destination.
  dialog = await openMove();
  await dialog.getByRole("button", { name: `${a}.md`, exact: true }).click();
  assert.ok((await destLine(dialog)).includes(`将移动到：old/${b}.md`));
  await dialog.getByRole("button", { name: "移动笔记", exact: true }).click();
  await dialog.locator('p[role="status"]').waitFor();
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const g = await create("Gamma");
  await tab("Beta");
  await body.fill(`# Beta\n\n[[./${a}|相关笔记]]\n\n[来源](./${a}.md)`);
  await saved();
  await tab("Alpha");
  await body.fill(`# Alpha\n\n[下一篇](./${b}.md)`);
  await saved();
  // Cancelled move: title, path and links untouched; focus returns to 移动笔记.
  dialog = await openMove();
  assert.ok((await dialog.innerText()).includes("目标与当前位置相同，无需移动。"));
  assert.equal(
    await dialog.getByRole("button", { name: "移动笔记", exact: true }).isDisabled(),
    true,
  );
  await dialog.getByRole("button", { name: "根目录", exact: true }).click();
  assert.equal(
    await dialog.getByRole("button", { name: "根目录", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  assert.ok((await destLine(dialog)).includes(`将移动到：${a}.md`));
  assert.equal(
    await dialog.getByRole("button", { name: "移动笔记", exact: true }).isDisabled(),
    false,
    "a changed destination enables the move",
  );
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await moveButton().evaluate((el) => document.activeElement === el),
    true,
    "cancel returns focus to 移动笔记",
  );
  assert.equal(await atPath(`old/${a}.md`, "Alpha"), true, "canceled move keeps the old path");
  dialog = await openMove();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await moveButton().evaluate((el) => document.activeElement === el), true);
  assert.equal(await atPath(`old/${a}.md`, "Alpha"), true);
  // Main move old/Alpha.md -> new/Alpha.md: instant, rewrites inbound and outbound links.
  dialog = await openMove();
  await dialog.getByRole("button", { name: "根目录", exact: true }).click();
  await newFolder(dialog, "new");
  assert.ok((await destLine(dialog)).includes(`将移动到：new/${a}.md`));
  await mkdir("scripts/shots", { recursive: true });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1);
    assert.ok(box.y + box.height <= viewport.height + 1);
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    );
    await dialog.getByRole("button", { name: "移动笔记", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `scripts/shots/knowledge-move-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.getByRole("button", { name: "移动笔记", exact: true }).click();
  await dialog.locator('p[role="status"]').waitFor();
  const moved = await dialog.locator('p[role="status"]').innerText();
  assert.ok(moved.includes("已移动并更新 3 处链接。"), moved);
  assert.ok(moved.includes("已保存到本机，下次同步时提交。"), moved);
  const toast = page.locator(".knowledge-undo-toast").filter({ hasText: "已移动并更新 3 处链接" });
  await toast.waitFor();
  assert.equal(await toast.getByRole("button", { name: "撤销", exact: true }).count(), 1);
  const review = dialog.locator(".knowledge-review-notes");
  assert.equal(await review.getAttribute("aria-label"), "受影响的笔记");
  assert.equal(await review.getByRole("button").count(), 2);
  const reviewText = await review.innerText();
  assert.ok(reviewText.includes(`路径 · new/${a}.md`), reviewText);
  assert.ok(reviewText.includes(`引用 · old/${b}.md`), reviewText);
  const betaReview = review.getByRole("button", { name: /Beta/ });
  await betaReview.click();
  assert.equal(await betaReview.getAttribute("aria-pressed"), "true");
  const betaDiff = await diffForms(dialog);
  assert.ok(betaDiff.before.includes(`[[./${a}|相关笔记]]`), betaDiff.before);
  assert.ok(betaDiff.before.includes(`(./${a}.md)`), betaDiff.before);
  assert.ok(betaDiff.after.includes(`[[${a}|相关笔记]]`), betaDiff.after);
  assert.ok(betaDiff.after.includes(`](${a}.md)`), betaDiff.after);
  assert.ok(!betaDiff.after.includes(`./${a}`), betaDiff.after);
  const alphaReview = review.getByRole("button", { name: /Alpha/ });
  await alphaReview.click();
  const meta = await dialog.locator(".knowledge-review-meta").innerText();
  assert.ok(meta.includes(`原路径：old/${a}.md`), meta);
  assert.ok(meta.includes(`新路径：new/${a}.md`), meta);
  const alphaDiff = await diffForms(dialog);
  assert.ok(alphaDiff.before.includes(`(./${b}.md)`), alphaDiff.before);
  assert.ok(alphaDiff.after.includes(`](${b}.md)`), alphaDiff.after);
  assert.ok(!alphaDiff.after.includes(`./${b}`), alphaDiff.after);
  // Undo from the result stage reverts the move.
  await dialog.getByRole("button", { name: "撤销移动", exact: true }).click();
  await dialog.getByRole("button", { name: "新建文件夹", exact: true }).waitFor();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await atPath(`old/${a}.md`, "Alpha"), true, "undo restores the old path");
  const alphaBody = await readBody();
  assert.ok(alphaBody.includes(`](${b}.md)`), alphaBody);
  assert.ok(!alphaBody.includes(`./${b}.md`), alphaBody);
  await tab("Beta");
  const betaBody = await readBody();
  assert.ok(betaBody.includes(`[[${a}|相关笔记]]`), betaBody);
  assert.ok(betaBody.includes(`](${a}.md)`), betaBody);
  assert.ok(!betaBody.includes(`./${a}`), betaBody);
  await tab("Alpha");
  // Second move: links are already identity-bound, and the toast 撤销 reverts it.
  dialog = await openMove();
  await dialog.getByRole("button", { name: "根目录", exact: true }).click();
  await newFolder(dialog, "new");
  await dialog.getByRole("button", { name: "移动笔记", exact: true }).click();
  await dialog.locator('p[role="status"]').waitFor();
  const again = await dialog.locator('p[role="status"]').innerText();
  assert.ok(again.includes("已移动，无需更新链接。"), again);
  const toast2 = page.locator(".knowledge-undo-toast").filter({ hasText: "已移动，无需更新链接" });
  await toast2.waitFor();
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await toast2.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await atPath(`old/${a}.md`, "Alpha"), true, "undo toast reverts the move");
  // Third move sticks: links stay identity-bound, note id in the URL survives.
  dialog = await openMove();
  await dialog.getByRole("button", { name: "根目录", exact: true }).click();
  await newFolder(dialog, "new");
  await dialog.getByRole("button", { name: "移动笔记", exact: true }).click();
  await dialog.locator('p[role="status"]').waitFor();
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(new URL(page.url()).searchParams.get("note"), a);
  assert.equal(await title.inputValue(), "Alpha");
  assert.equal(await atPath(`new/${a}.md`, "Alpha"), true, "the note lives at the new path");
  // Collision guard: a folder named like another note's file -> 路径冲突, nothing moves.
  await tab("Beta");
  dialog = await openMove();
  await dialog.getByRole("button", { name: "根目录", exact: true }).click();
  await newFolder(dialog, `${g}.md`);
  assert.ok((await destLine(dialog)).includes(`将移动到：${g}.md/${b}.md`));
  await dialog.getByRole("button", { name: "移动笔记", exact: true }).click();
  const alert = dialog.getByRole("alert");
  await alert.waitFor();
  const alertText = await alert.innerText();
  assert.ok(alertText.includes("路径冲突"), alertText);
  assert.ok(alertText.includes("同时作为文件和文件夹"), alertText);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await atPath(`old/${b}.md`, "Beta"), true, "collision keeps the old path");
  // Folder move new -> archive/项目 from the sidebar 文件夹 view.
  await page.getByRole("button", { name: "文件夹视图", exact: true }).click();
  await page.getByRole("button", { name: "移动文件夹 new", exact: true }).click();
  const fdlg = page.getByRole("dialog", { name: "移动文件夹", exact: true });
  await fdlg.waitFor();
  assert.equal(await fdlg.getByRole("button", { name: "关闭移动文件夹", exact: true }).count(), 1);
  assert.ok((await fdlg.innerText()).includes("目标与当前位置相同，无需移动。"));
  assert.equal(
    await fdlg.getByRole("button", { name: "移动文件夹", exact: true }).isDisabled(),
    true,
    "self-move is disabled",
  );
  await fdlg.getByRole("button", { name: "移动文件夹 new", exact: true }).click();
  assert.ok((await fdlg.innerText()).includes("不能将文件夹移动到自身或子目录。"));
  assert.equal(
    await fdlg.getByRole("button", { name: "移动文件夹", exact: true }).isDisabled(),
    true,
    "moving a folder into itself is disabled",
  );
  await fdlg.getByRole("button", { name: "根目录", exact: true }).click();
  await newFolder(fdlg, "archive");
  await newFolder(fdlg, "项目");
  assert.ok((await destLine(fdlg)).includes("文件夹将移动到：archive/项目/new"));
  await fdlg.getByRole("button", { name: "移动文件夹", exact: true }).click();
  const fstatus = fdlg.locator('p[role="status"]');
  await fstatus.waitFor();
  assert.ok((await fstatus.innerText()).includes("已移动，无需更新链接。"));
  assert.ok(
    (await fdlg.locator(".knowledge-review-notes").innerText()).includes(
      `路径 · archive/项目/new/${a}.md`,
    ),
  );
  await fdlg.getByRole("button", { name: "完成", exact: true }).click();
  await fdlg.waitFor({ state: "hidden" });
  // Sidebar path search finds the note at its new path; it survives reload.
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await page.getByLabel("搜索个人笔记", { exact: true }).fill("archive/项目");
  const list = page.getByRole("navigation", { name: "笔记列表" });
  await list.getByRole("button").filter({ hasText: "Alpha" }).waitFor();
  assert.equal(await list.getByRole("button").count(), 1);
  await page.getByLabel("搜索个人笔记", { exact: true }).fill("");
  assert.equal(
    await atPath(`archive/项目/new/${a}.md`, "Alpha"),
    true,
    "sidebar path search finds the note by its new path",
  );
  await page.getByRole("button", { name: "文件夹视图", exact: true }).click();
  await page
    .getByRole("navigation", { name: "笔记列表" })
    .getByRole("button", { name: `${a}.md`, exact: true })
    .click();
  await page.screenshot({ path: "scripts/shots/knowledge-file-tree.png" });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await atPath(`archive/项目/new/${a}.md`, "Alpha"),
    true,
    "paths persist after reload",
  );
  assert.deepEqual(errors, []);
  console.log(
    "knowledge paths PASSED: instant folder-picker moves, inbound/outbound link rewrites, undo toast + 撤销移动, cancel/focus return, collision and self-move guards, folder moves, path search, reload and responsive dialogs",
  );
} catch (error) {
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
