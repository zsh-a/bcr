import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5213").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const body = () => page.getByLabel("笔记正文", { exact: true });
const title = () => page.getByLabel("笔记标题", { exact: true });
// 保存/同步状态只保留 data-testid="knowledge-status" 状态簇：落库后的稳态文案
// 以「已保存/已同步」开头（未配置同步恒为「已保存到本机」）。
const saved = () =>
  page
    .locator('[data-testid="knowledge-status"] .knowledge-status-line')
    .filter({ hasText: /^(已保存|已同步)/u })
    .waitFor({ state: "attached" });
const palette = () => page.locator("dialog.knowledge-switcher");
const rail = () => page.locator("aside.knowledge-context:visible");
async function create(name, content) {
  const previous = new URL(page.url()).searchParams.get("note");
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("note") !== previous);
  await page.waitForFunction(() => document.querySelector('[aria-label="笔记标题"]')?.value === "");
  await title().fill(name);
  await body().fill(content);
  await saved();
  return new URL(page.url()).searchParams.get("note");
}
async function tab(name) {
  await page
    .getByRole("navigation", { name: "打开的笔记", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
  await page.waitForFunction(
    (expected) => document.querySelector('[aria-label="笔记标题"]')?.value === expected,
    name,
  );
}
async function mode(button) {
  await page.getByRole("button", { name: button, exact: true }).click();
  await page.waitForTimeout(150);
}
// 视图是编辑/源码/阅读的单选分段（data-source=on 显示原始 Markdown）；
// 退出源码回到「编辑」，再点「源码」不会关闭。
async function source(on) {
  const button = page.getByRole("button", { name: "源码", exact: true });
  if ((await button.getAttribute("aria-pressed")) !== String(on)) await mode(on ? "源码" : "编辑");
  assert.equal(
    await page.locator(".knowledge-editor").getAttribute("data-source"),
    on ? "on" : null,
  );
}
// 命令面板：Ctrl/Cmd+K 与 Ctrl/Cmd+O 都能打开；操作入口在最后一个分组。
async function openPalette() {
  await page.keyboard.press("Control+o");
  await palette().waitFor({ state: "visible" });
}
async function command(label) {
  await openPalette();
  await palette().getByLabel("搜索笔记或操作").fill(label);
  const groups = palette().locator(".knowledge-switcher-group");
  assert.ok(
    await groups.last().getByText("操作", { exact: true }).count(),
    "操作 is the last group",
  );
  await groups.last().getByRole("option", { name: label, exact: false }).click();
  await palette().waitFor({ state: "hidden" });
}
try {
  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  // 覆盖断言：关闭态同步浮层不得吞掉下方控件的点击。
  assert.equal(
    await page.evaluate(() => {
      const button = document.querySelector(".knowledge-create");
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return button.contains(hit) && !hit.closest(".knowledge-sync-popover");
    }),
    true,
    "closed sync popover must not intercept clicks on the sidebar",
  );
  const alpha = await create("Alpha", "# First\n\nOriginal note.");
  // Separate user typing from the initial paste into distinct CodeMirror undo groups.
  await page.waitForTimeout(600);
  await body().press("Control+End");
  await body().pressSequentially(" Extra sentence.");
  await saved();
  // 视图模式：编辑 / 源码 / 阅读 单选分段（旧的预览/继续编辑/实时预览/独立源码开关已移除）。
  assert.equal(
    await page.locator('.knowledge-segmented[role="group"][aria-label="视图模式"]').count(),
    1,
  );
  const pressed = (button) =>
    page.getByRole("button", { name: button, exact: true }).getAttribute("aria-pressed");
  assert.equal(await pressed("编辑"), "true");
  assert.equal(await pressed("阅读"), "false");
  await mode("阅读");
  assert.equal(await pressed("阅读"), "true");
  assert.equal(await pressed("编辑"), "false");
  assert.equal(await page.locator(".knowledge-prose").count(), 1);
  await mode("编辑");
  await body().focus();
  await body().press("Control+z");
  assert.match(await body().innerText(), /Original note\./);
  assert.ok(!(await body().innerText()).includes("Extra sentence."), "reading mode preserves undo");
  await body().press("Control+y");
  assert.match(await body().innerText(), /Extra sentence\./);
  await saved();
  await source(true);
  assert.equal(await pressed("源码"), "true");
  assert.match(await body().innerText(), /^# First/);
  await body().press("Control+z");
  assert.ok(!(await body().innerText()).includes("Extra sentence."), "undo works in source mode");
  await body().press("Control+y");
  assert.match(await body().innerText(), /Extra sentence\./);
  await source(false);
  assert.equal(await pressed("源码"), "false");
  await body().focus();
  await body().press("Control+z");
  assert.ok(!(await body().innerText()).includes("Extra sentence."), "source mode preserves undo");
  await body().press("Control+y");
  await saved();
  await create(
    "Beta",
    '# Links\n\n[[Alpha#First|Go to Alpha]]\n\n[Go via Markdown](Alpha.md#First "Keep tooltip")\n\n[Go via reference][alpha-ref]\n\n- [x] Complete\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n[alpha-ref]: Alpha.md#First "Reference tooltip"',
  );
  await tab("Alpha");
  await body().focus();
  await body().press("Control+z");
  assert.ok(
    !(await body().innerText()).includes("Extra sentence."),
    "switching notes preserves undo",
  );
  await saved();
  // 收藏入口在「更多操作」菜单里，标签栏不再有独立星标按钮；
  // 收藏态以下面「收藏」视图的结果行数为准。
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "收藏当前笔记", exact: true }).click();
  await page
    .getByRole("group", { name: "笔记范围" })
    .getByRole("button", { name: "收藏", exact: true })
    .click();
  assert.equal(await page.locator(".knowledge-result").count(), 1);
  await page
    .getByRole("group", { name: "笔记范围" })
    .getByRole("button", { name: "全部", exact: true })
    .click();
  // 上下文栏默认收起，展开后按大纲与链接分别导航。
  assert.equal(await rail().count(), 0);
  await page.getByRole("button", { name: "展开上下文栏", exact: true }).click();
  await rail().getByRole("button", { name: "First", exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await title().inputValue(), "Alpha");
  assert.match(
    await page.evaluate(
      () =>
        document.getSelection()?.anchorNode?.parentElement?.closest(".cm-line")?.textContent ?? "",
    ),
    /First/,
    "outline click reveals the heading in the editor",
  );
  await rail()
    .getByRole("group", { name: "笔记信息视图" })
    .getByRole("button", { name: /^链接/u })
    .click();
  await rail().getByRole("button", { name: "Beta", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="笔记标题"]')?.value === "Beta",
  );
  await mode("阅读");
  assert.equal(await page.locator(".knowledge-prose table").count(), 1);
  assert.equal(await page.locator('.knowledge-prose input[type="checkbox"]').count(), 1);
  await page
    .locator(".knowledge-prose")
    .getByRole("link", { name: "Go to Alpha", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="笔记标题"]')?.value === "Alpha",
  );
  await tab("Beta");
  await rail()
    .getByRole("group", { name: "笔记信息视图" })
    .getByRole("button", { name: /^链接/u })
    .click();
  await rail().getByRole("button", { name: "Go to Alpha", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="笔记标题"]')?.value === "Alpha",
  );
  await tab("Beta");
  await tab("Alpha");
  // 命令面板：两个快捷键都可用；IME 确认（Enter + isComposing）不得新建笔记。
  await page.keyboard.press("Control+k");
  await palette().waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await palette().waitFor({ state: "hidden" });
  await openPalette();
  await palette().getByLabel("搜索笔记或操作").fill("New from switcher");
  await palette().getByText("创建「New from switcher」", { exact: true }).waitFor();
  await palette()
    .getByLabel("搜索笔记或操作")
    .dispatchEvent("keydown", { key: "Enter", isComposing: true });
  assert.ok(await palette().isVisible(), "IME confirmation must not create a note");
  assert.notEqual(await title().inputValue(), "New from switcher");
  await palette().getByLabel("搜索笔记或操作").press("Enter");
  await palette().waitFor({ state: "hidden" });
  assert.equal(await title().inputValue(), "New from switcher");
  // 模板：给笔记打上「模板」标签后，通过 / 插入面板与编辑器溢出菜单插入。
  await create("My template", "# {{title}}\n\nDate: {{date}}\n\n## Notes\n");
  await page.getByRole("button", { name: "编辑笔记属性", exact: true }).click();
  // 标签入口是安静的「+ 标签」，点击后才出现输入框（提示在 placeholder 里）。
  await page.getByRole("button", { name: "添加标签", exact: true }).click();
  await page.getByLabel("笔记标签", { exact: true }).fill("模板");
  await page.getByLabel("笔记标签", { exact: true }).press("Enter");
  await page.getByLabel("笔记标签", { exact: true }).fill("待整理");
  await title().click();
  await page.getByRole("button", { name: "移除标签 待整理", exact: true }).waitFor();
  await page.getByRole("button", { name: "添加标签", exact: true }).click();
  await page.getByLabel("笔记标签", { exact: true }).fill("不提交");
  await page.getByLabel("笔记标签", { exact: true }).press("Escape");
  assert.equal(await page.getByRole("button", { name: "移除标签 不提交", exact: true }).count(), 0);
  await page.getByRole("button", { name: "移除标签 待整理", exact: true }).click();
  await saved();
  await tab("New from switcher");
  await body().click();
  await body().press("Control+End");
  await body().press("Enter");
  await body().pressSequentially("/");
  const slash = page.locator(".cm-tooltip-autocomplete");
  await slash.waitFor({ state: "visible" });
  for (const label of [
    "代码块",
    "任务列表",
    "分割线",
    "引用",
    "无序列表",
    "日期",
    "标题 1",
    "标题 2",
    "标题 3",
    "表格",
  ]) {
    assert.ok(
      await slash.getByRole("option").filter({ hasText: label }).count(),
      `/${label} insert item`,
    );
  }
  await slash.getByRole("option").filter({ hasText: "模板 My template" }).first().click();
  await saved();
  await source(true);
  let raw = await body().innerText();
  assert.match(raw, /# New from switcher/);
  assert.match(raw, /Date: \d{4}-\d{2}-\d{2}/);
  assert.ok(!raw.includes("{{"), "template variables are substituted");
  await source(false);
  // 编辑器溢出菜单：更多写作工具 -> .knowledge-tools-menu。
  // 只留写作偏好；视图模式与源码在标题栏已有控件，宽容器下这里不重复出现。
  await page.getByRole("button", { name: "更多写作工具" }).click();
  const tools = page.locator(".knowledge-tools-menu");
  await tools.waitFor({ state: "visible" });
  assert.equal(await tools.getByRole("button", { name: "专注模式", exact: true }).count(), 0);
  await tools.getByRole("button", { name: "打字机模式", exact: true }).waitFor();
  await tools.getByText("阅读字体", { exact: true }).waitFor();
  await tools.getByText("行高", { exact: true }).waitFor();
  assert.equal(
    await tools.getByRole("button", { name: "源码", exact: true }).count(),
    0,
    "视图分段不在工具菜单里重复（宽容器下分段常驻文档工具行）",
  );
  await tools.getByText("插入模板", { exact: true }).click();
  await tools.getByRole("button", { name: "My template", exact: true }).click();
  await saved();
  await page.keyboard.press("Escape");
  await source(true);
  raw = await body().innerText();
  assert.equal(raw.split("Date: ").length - 1, 2, "overflow insert reuses the template");
  assert.ok(!raw.includes("{{"));
  await source(false);
  // 今日日记：幂等（同一天同一个 daily- 笔记）。
  await command("今日日记");
  await page.waitForURL((url) => url.searchParams.get("note")?.startsWith("daily-"));
  const daily = new URL(page.url()).searchParams.get("note");
  assert.ok(daily.startsWith("daily-"));
  await body().fill("My daily record");
  await saved();
  await tab("Alpha");
  await command("今日日记");
  await page.waitForURL((url) => url.searchParams.get("note") === daily);
  assert.equal(new URL(page.url()).searchParams.get("note"), daily);
  assert.equal((await body().innerText()).trim(), "My daily record");
  await page.reload({ waitUntil: "networkidle" });
  await tab("Alpha");
  // 刷新后收藏仍在：同样以侧栏「收藏」筛选命中数为准。
  await page
    .getByRole("group", { name: "笔记范围" })
    .getByRole("button", { name: "收藏", exact: true })
    .click();
  assert.equal(await page.locator(".knowledge-result").count(), 1);
  await page
    .getByRole("group", { name: "笔记范围" })
    .getByRole("button", { name: "全部", exact: true })
    .click();
  // Ctrl+点击链接：从正文链接跳到目标笔记。
  await tab("Beta");
  await page
    .locator(".cm-line")
    .filter({ hasText: "Go via reference" })
    .click({ modifiers: ["Control"], position: { x: 35, y: 8 } });
  await page.waitForFunction(
    () => document.querySelector('[aria-label="笔记标题"]')?.value === "Alpha",
  );
  await tab("Beta");
  await mode("阅读");
  await page
    .locator(".knowledge-prose")
    .getByRole("link", { name: "Go via Markdown", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="笔记标题"]')?.value === "Alpha",
  );
  await mode("编辑");
  // 笔记补全：[[Al 提供补全；转义/代码块中的链接不补全。
  for (const text of ["\\[[Al", "```md\n[[Al"]) {
    await body().fill(text);
    await body().press("Control+Space");
    await page.waitForTimeout(350);
    assert.equal(
      await page.getByRole("option").filter({ hasText: "Alpha" }).count(),
      0,
      "escaped/code links must not offer note completion",
    );
    await body().press("Escape");
  }
  await body().fill("[[Al");
  await body().press("Control+Space");
  await page.getByRole("option").filter({ hasText: "Alpha" }).first().waitFor();
  // Enter 立即接受选中项：补全刚被 Ctrl+Space 重启也一样，不给列表任何落定时间。
  await body().press("Enter");
  assert.match(await body().innerText(), new RegExp(alpha));
  await saved();
  // 列表已可见时再按 Ctrl+Space 重启（pending 落定窗口）：Enter 同样立刻接受，不偷跑成换行。
  await body().fill("[[Al");
  await page.getByRole("option").filter({ hasText: "Alpha" }).first().waitFor();
  await body().press("Control+Space");
  await body().press("Enter");
  assert.match(await body().innerText(), new RegExp(alpha));
  await saved();
  // 实时预览：稳定 ID 隐藏为可读文本，Markdown 原文不被改写。
  await title().click();
  await page.locator("button.knowledge-inline-link").filter({ hasText: "Alpha" }).waitFor();
  const widget = page.locator("button.knowledge-inline-link").filter({ hasText: "Alpha" }).first();
  assert.equal(await widget.innerText(), "Alpha");
  assert.ok(!(await body().innerText()).includes(alpha), "live preview hides stable IDs");
  await source(true);
  assert.equal(
    (await body().innerText()).trim(),
    `[[${alpha}|Alpha]]`,
    "live preview must not rewrite Markdown",
  );
  await source(false);
  await body().fill(
    "# 把零散想法连成知识\n\n记录只是开始，让笔记之间建立联系。\n\n## 下一步\n\n- [ ] 回顾今天的想法\n- [ ] 整理资料与来源\n\n## 关联阅读\n\n[[Beta|链接与引用示例]]\n\n**保留原始 Markdown，让知识可以随时带走。**",
  );
  await saved();
  await page
    .locator("button.knowledge-inline-link")
    .filter({ hasText: "链接与引用示例" })
    .waitFor();
  assert.equal(
    await page
      .locator("button.knowledge-inline-link")
      .filter({ hasText: "链接与引用示例" })
      .innerText(),
    "链接与引用示例",
    "live preview shows the readable link text",
  );
  for (const heading of ["下一步", "关联阅读"]) {
    await rail().getByRole("button", { name: heading, exact: true }).waitFor();
  }
  // 目录树行的日期是相对时间（本次跑批都是今天新建：刚刚/N 分钟前/N 小时前），不再是绝对日期。
  const cardTimes = await page.locator(".knowledge-file-note time").allTextContents();
  assert.ok(cardTimes.length >= 2, "tree rows show their dates");
  for (const text of cardTimes)
    assert.match(text, /^(刚刚|\d+ 分钟前|\d+ 小时前)$/u, `relative card time: ${text}`);
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({ path: "scripts/shots/knowledge-workbench-desktop.png" });
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // 形态切换的 120ms 淡入淡出是设计行为；reduced-motion 兜底不打断进行中的过渡，
    // 断言前等跨断点的右栏/折叠段交换落定。
    await page.waitForTimeout(200);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    );
    // 小屏：上下文通过原生模态抽屉展开，不占正文空间。
    const drawer = page.getByRole("dialog", { name: "笔记信息", exact: true });
    if (!(await drawer.isVisible()))
      await page.getByRole("button", { name: "展开上下文栏", exact: true }).click();
    await drawer.waitFor();
    assert(await drawer.evaluate((element) => element.matches(":modal")));
    await drawer.getByRole("button", { name: "关联阅读", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    if (viewport.width === 375) {
      await page.keyboard.press("Control+o");
      const mobilePicker = palette();
      await mobilePicker.getByLabel("搜索笔记或操作").fill("Alpha");
      await mobilePicker.getByLabel("搜索笔记或操作").press("Escape");
      await mobilePicker.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "切换笔记列表", exact: true }).click();
      await page.getByRole("button", { name: "收起列表", exact: true }).click();
      // Mobile exposes view modes directly, with no duplicate menu entry.
      const modes = page.getByRole("group", { name: "视图模式", exact: true });
      await modes.getByRole("button", { name: "源码", exact: true }).waitFor();
      await modes.getByRole("button", { name: "阅读", exact: true }).waitFor();
      await page.getByRole("button", { name: "更多写作工具" }).click();
      const mobileTools = page.locator(".knowledge-tools-menu");
      assert.equal(await mobileTools.getByRole("button", { name: "源码", exact: true }).count(), 0);
      await page.keyboard.press("Escape");
      await mobileTools.waitFor({ state: "hidden" });
    }
    await page.screenshot({ path: `scripts/shots/knowledge-workbench-${viewport.width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log(
    "knowledge workbench PASSED: undo across modes and notes, tabs, context rail (outline/backlinks/outlinks), GFM, palette IME-safety, / and overflow templates, daily notes, favorites, completion, live preview and mobile",
  );
} catch (error) {
  // 失败诊断不能被截图本身的问题顶掉：截图失败时仍要抛出真正的断言错误。
  await mkdir("scripts/shots", { recursive: true });
  await page
    .screenshot({ path: "scripts/shots/knowledge-workbench-failure.png", timeout: 5000 })
    .catch(() => undefined);
  const snapshot = await page
    .evaluate(() => ({
      url: location.href,
      tabs: document.querySelector(".knowledge-tabs")?.textContent ?? "(no tabs)",
      title: document.querySelector('[aria-label="笔记标题"]')?.value ?? "(no title)",
    }))
    .catch(() => null);
  console.error("workbench failure snapshot:", snapshot);
  throw error;
} finally {
  await browser.close();
}
