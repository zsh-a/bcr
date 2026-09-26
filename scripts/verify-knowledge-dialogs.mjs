import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
try {
  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  const title = page.getByLabel("笔记标题", { exact: true });
  await title.fill("弹窗体验验证");
  await page
    .getByLabel("笔记正文", { exact: true })
    .fill("# 保留写作现场\n\n" + "正文内容\n\n".repeat(80));
  await page
    .locator('[data-testid="knowledge-status"] .knowledge-status-line')
    .filter({ hasText: /^(已保存|已同步)/u })
    .waitFor({ state: "attached" });
  await page.locator(".knowledge-content").evaluate((el) => {
    el.scrollTop = 300;
  });
  const before = await page.locator(".knowledge-content").evaluate((el) => el.scrollTop);
  const dialog = page.getByRole("dialog", { name: "同步设置", exact: true });
  const statusTrigger = page.locator(".knowledge-status-trigger");

  // 关闭弹层后焦点必须回到可见触发器：瞬时入口（溢出菜单、命令面板）会卸载打开元素。
  async function assertFocusReturned(label) {
    assert.ok(
      await statusTrigger.evaluate(
        (el) =>
          el === document.activeElement && el.checkVisibility() && el.getClientRects().length > 0,
      ),
      `focus returns to a visible trigger after ${label}`,
    );
  }

  // 同步设置的入口：宽屏走状态弹层「同步设置…」；≤720px 工具栏收进「更多操作」菜单。
  async function openSync() {
    if (page.viewportSize().width <= 720) {
      await page.getByRole("button", { name: "更多操作", exact: true }).click();
      await page
        .locator(".knowledge-overflow-menu")
        .getByRole("menuitem", { name: "同步设置", exact: true })
        .click();
    } else {
      await statusTrigger.click();
      await page
        .locator(".knowledge-sync-popover")
        .getByRole("button", { name: "同步设置…", exact: true })
        .click();
    }
    await dialog.waitFor();
  }

  // --- 状态弹层入口 + 面板结构（Area 1 + 6）
  await statusTrigger.click();
  const popover = page.locator(".knowledge-sync-popover");
  await popover.waitFor();
  assert.deepEqual(await popover.locator("dl.knowledge-sync-facts dt").allTextContents(), [
    "上次同步",
    "待同步",
  ]);
  await popover.getByRole("button", { name: "同步设置…", exact: true }).click();
  await dialog.waitFor();
  await page.getByRole("button", { name: "关闭同步设置", exact: true }).waitFor();
  const panel = dialog.locator(
    'section.knowledge-panel.knowledge-sync[aria-label="GitHub 同步设置"]',
  );
  await panel.waitFor();
  await panel.getByLabel("GitHub 仓库地址").waitFor();
  await panel.getByLabel("GitHub Token", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("checkbox", { name: "记住此设备" }).count(), 1);
  assert.equal(await panel.getByRole("checkbox", { name: "自动同步" }).count(), 1);
  await panel.getByRole("button", { name: "连接并同步", exact: true }).waitFor();
  const advanced = panel
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "高级" }) });
  assert.equal(await advanced.count(), 1);
  assert.equal(await advanced.evaluate((el) => el.open), false);
  await advanced.locator("summary").click();
  await panel.getByLabel("GitHub 分支").waitFor();
  const manage = dialog.locator("div.knowledge-sync-manage");
  await manage.getByRole("button", { name: "清除 Token", exact: true }).waitFor();
  // 未连接同步仓库时不应出现「断开连接」。
  assert.equal(await manage.getByRole("button", { name: "断开连接", exact: true }).count(), 0);
  // 管理块的一步确认：清除 Token 弹出确认块，「继续保留」不改任何配置。
  await manage.getByRole("button", { name: "清除 Token", exact: true }).click();
  const confirm = manage.locator('div[role="alert"].knowledge-sync-confirm');
  await confirm.waitFor();
  assert.match(await confirm.textContent(), /清除 Token？仓库配置会保留。/u);
  await confirm.getByRole("button", { name: "继续保留", exact: true }).click();
  await confirm.waitFor({ state: "hidden" });

  // --- 定位：1440x1000 下居中
  await page.waitForTimeout(220);
  const box = await dialog.boundingBox();
  assert.ok(Math.abs(box.x + box.width / 2 - 720) < 2, `x center ${box.x + box.width / 2}`);
  assert.ok(Math.abs(box.y + box.height / 2 - 500) < 2, `y center ${box.y + box.height / 2}`);
  assert.equal(await page.locator(".knowledge-content").evaluate((el) => el.scrollTop), before);

  // --- 草稿：关闭再开保留字段内容；焦点锁在弹层内
  await dialog.getByLabel("GitHub 仓库地址").fill("draft-owner/notes");
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.ok(await statusTrigger.evaluate((el) => el === document.activeElement));
  assert.equal(await page.locator(".knowledge-content").evaluate((el) => el.scrollTop), before);

  // --- 命令面板入口「打开同步设置」= 重新打开且草稿保留
  await page.keyboard.press("Control+o");
  const palette = page.getByRole("dialog", { name: "命令面板" });
  await palette.waitFor();
  await palette.getByRole("combobox", { name: "搜索笔记或操作" }).fill("同步设置");
  await palette.getByRole("option", { name: /打开同步设置/ }).click();
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel("GitHub 仓库地址").inputValue(), "draft-owner/notes");
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({ path: "scripts/shots/knowledge-dialog-desktop.png" });

  // --- 背景点击关闭
  await page.waitForTimeout(350);
  await page.mouse.click(8, 8);
  await dialog.waitFor({ state: "hidden" });
  // 命令面板是瞬时入口（选项随面板卸载）：焦点必须回到可见触发器，而不是 body。
  await assertFocusReturned("命令面板「打开同步设置」背景点击关闭");

  // --- 版本历史：打开/关闭（关闭按钮「关闭版本历史」把焦点还给触发按钮）
  await page.getByRole("button", { name: "笔记版本历史", exact: true }).click();
  const history = page.getByRole("dialog", { name: "版本历史", exact: true });
  await history.waitFor();
  await history
    .locator('section.knowledge-panel.knowledge-history[aria-label="笔记版本历史"]')
    .waitFor();
  await history.locator('[role="tablist"][aria-label="历史来源"]').waitFor();
  await page.screenshot({ path: "scripts/shots/knowledge-dialog-history.png" });
  await history.getByRole("button", { name: "关闭版本历史" }).click();
  await history.waitFor({ state: "hidden" });
  assert.ok(
    await page
      .getByRole("button", { name: "笔记版本历史", exact: true })
      .evaluate((el) => el === document.activeElement),
  );

  // --- 恢复备份：打开/关闭
  await page.getByText("导入、导出与备份", { exact: true }).click();
  await page.getByRole("button", { name: "恢复 ZIP 备份", exact: true }).click();
  const restore = page.getByRole("dialog", { name: "恢复备份" });
  await restore.waitFor();
  await restore.locator('section.knowledge-panel[aria-label="恢复知识库备份"]').waitFor();
  await restore.getByRole("button", { name: "关闭恢复备份" }).click();
  await restore.waitFor({ state: "hidden" });
  assert.ok(
    await page
      .getByRole("button", { name: "恢复 ZIP 备份", exact: true })
      .evaluate((el) => el === document.activeElement),
  );

  // --- 移动端 / 横屏：弹层在视口内、无横向溢出；减弱动效照常开关
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSync();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0);
    assert.ok(bounds.x + bounds.width <= viewport.width + 1);
    assert.ok(bounds.y + bounds.height <= viewport.height + 1);
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await dialog.getByRole("button", { name: "连接并同步" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `scripts/shots/knowledge-dialog-${viewport.width}.png` });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }

  // --- 「更多操作」是工具栏 ⋯ 菜单，与写作工具菜单（更多写作工具）完全分开
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  const overflow = page.locator('div.knowledge-overflow-menu[role="menu"][aria-label="更多操作"]');
  await overflow.waitFor();
  assert.deepEqual(await overflow.getByRole("menuitem").allTextContents(), [
    "收藏当前笔记",
    "版本历史",
    "同步设置",
    "立即同步",
  ]);
  await page.getByRole("button", { name: "关闭菜单", exact: true }).click();
  await page.getByRole("button", { name: "更多写作工具", exact: true }).click();
  const tools = page.locator(".knowledge-tools-menu[data-open]");
  await tools.waitFor();
  assert.equal(await tools.getAttribute("role"), null);
  assert.equal(await tools.getByRole("menuitem").count(), 0);
  assert.ok(await tools.getByRole("button", { name: "源码模式", exact: true }).isVisible());
  assert.equal(await tools.getByRole("button", { name: "同步设置", exact: true }).count(), 0);
  await page.keyboard.press("Escape");

  // --- 溢出菜单是瞬时入口（菜单项随菜单卸载）：关闭后焦点必须回到可见触发器。
  for (const item of ["同步设置", "版本历史"]) {
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await overflow.getByRole("menuitem", { name: item, exact: true }).click();
    const opened = page.getByRole("dialog", { name: item, exact: true });
    await opened.waitFor();
    await page.keyboard.press("Escape");
    await opened.waitFor({ state: "hidden" });
    await assertFocusReturned(`更多操作菜单「${item}」`);
  }

  // --- 大字号：24px 下弹层仍无横向溢出
  await page.addStyleTag({
    content: ".knowledge-dialog :is(p, label, input, button, span) { font-size: 24px !important; }",
  });
  await openSync();
  await dialog.getByRole("button", { name: "连接并同步" }).scrollIntoViewIfNeeded();
  assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  // --- 真实冲突：过期草稿与远端改写重叠 → 处理冲突弹层（新触发器 + 关闭按钮）
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ media: null, reducedMotion: "no-preference" });
  await page.getByLabel("笔记正文", { exact: true }).fill("远端改写\n第二行");
  await page
    .locator('[data-testid="knowledge-status"] .knowledge-status-line')
    .filter({ hasText: /^(已保存|已同步)/u })
    .waitFor({ state: "attached" });
  const noteId = new URL(page.url()).searchParams.get("note");
  assert.ok(noteId, "created note keeps ?note id");
  const now = Date.now();
  const stale = (body) => ({
    id: noteId,
    title: "弹窗体验验证",
    body,
    tags: [],
    collectionId: null,
    createdAt: now,
    updatedAt: now,
    citations: [],
  });
  await page.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), {
    key: `bcr/knowledge-draft/v1/${noteId}`,
    draft: {
      base: stale("第一行\n第二行"),
      note: stale("本地改写\n第二行"),
      proposedTitle: null,
    },
  });
  await page.reload({ waitUntil: "networkidle" });
  await page
    .locator(".knowledge-alert")
    .filter({ hasText: "这篇笔记存在同步冲突，双方内容已保留。" })
    .waitFor();
  await page
    .locator(".knowledge-alert")
    .filter({ hasText: "保存产生同步冲突，草稿已保留，请先解决冲突" })
    .waitFor();
  assert.match(await page.locator(".knowledge-status-line").textContent(), /1 处冲突待处理/u);
  const bannerButton = page.getByRole("button", { name: "处理冲突", exact: true });
  await bannerButton.click();
  const conflicts = page.getByRole("dialog", { name: "处理冲突", exact: true });
  await conflicts.waitFor();
  await conflicts.getByRole("button", { name: "关闭处理冲突" }).waitFor();
  assert.equal(await conflicts.locator("article.knowledge-conflict-row").count(), 1);
  await conflicts.getByRole("button", { name: "关闭处理冲突" }).click();
  await conflicts.waitFor({ state: "hidden" });
  assert.ok(await bannerButton.evaluate((el) => el === document.activeElement));
  // 冲突存在时状态弹层提供「查看冲突」，同样直达处理冲突弹层
  await statusTrigger.click();
  await popover.getByRole("button", { name: "查看冲突", exact: true }).click();
  await conflicts.waitFor();
  await page.keyboard.press("Escape");
  await conflicts.waitFor({ state: "hidden" });
  assert.ok(await statusTrigger.evaluate((el) => el === document.activeElement));
  // 有冲突时命令面板「打开同步设置」仍打开同步设置（转到处理冲突只发生在同步完成回调 openSyncPanel）
  await page.keyboard.press("Control+o");
  await palette.waitFor();
  await palette.getByRole("combobox", { name: "搜索笔记或操作" }).fill("同步设置");
  await palette.getByRole("option", { name: /打开同步设置/ }).click();
  await dialog.waitFor();
  assert.equal(await conflicts.isVisible(), false);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await assertFocusReturned("命令面板「打开同步设置」Escape 关闭");

  assert.deepEqual(errors, []);
  console.log(
    "knowledge dialogs PASSED: 同步设置 triggers (popover/overflow/palette), panel structure, positioning, focus trap/return, dismissal, draft preservation, scroll, 版本历史/恢复备份/处理冲突 open+close, mobile, landscape, reduced motion, large text",
  );
} finally {
  await browser.close();
}
