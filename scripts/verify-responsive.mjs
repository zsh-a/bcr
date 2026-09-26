import { openWorkspaceOptions } from "./lib/topbar.mjs";
/* 响应式验证：三档语义断点 + 容器降级 + 矮窗/安全区 + reduced-motion + 浮标避让。
 *
 * BASE_URL 语义与其他走查脚本一致（verify-ci 注入 dev server 地址）。
 * 断言分 7 组，逐组输出 PASS/FAIL；任一组失败进程退出码非 0。
 * 容器阈值用「元素样式注入 + 真实布局宽度」触发：--w-sidebar / --w-rail 令牌
 * 直接驱动布局宽度，dock-panel / ui-body 改写容器自身 width，均需实测宽度
 * 跨过阈值后才断言降级形态，避免空断言。 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

const BP_MD = 720; // --bp-md 45em
const BP_LG = 1100; // --bp-lg 68.75em

const results = [];
async function group(name, run) {
  try {
    await run();
    results.push([name, "PASS"]);
    console.log(`PASS: ${name}`);
  } catch (error) {
    results.push([name, "FAIL"]);
    process.exitCode = 1;
    console.error(
      `FAIL: ${name}\n  ${String(error.message ?? error)
        .split("\n")
        .join("\n  ")}`,
    );
  }
}

const settle = (ms = 320) => page.waitForTimeout(ms);

async function noHScroll(label) {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert(
    size.scrollWidth <= size.innerWidth + 1,
    `${label}: 横向溢出 scrollWidth=${size.scrollWidth} > innerWidth=${size.innerWidth}`,
  );
}

async function topbarFits(label) {
  const bar = await page.evaluate(() => {
    const el = document.querySelector(".studio-topbar");
    const style = getComputedStyle(el);
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      height: el.getBoundingClientRect().height,
      maxHeight: parseFloat(style.getPropertyValue("--h-topbar")) + parseFloat(style.paddingTop),
    };
  });
  assert(
    bar.scrollWidth <= bar.clientWidth + 1,
    `${label}: 顶栏横向溢出 scrollWidth=${bar.scrollWidth} > clientWidth=${bar.clientWidth}`,
  );
  assert(bar.height <= bar.maxHeight + 1, `${label}: 工具栏必须保持单行（${bar.height}px）`);
}

function parseDurationMs(value) {
  return Math.max(
    ...value
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        const amount = Number.parseFloat(trimmed);
        return trimmed.endsWith("ms") ? amount : amount * 1000;
      })
      .concat(0),
  );
}

/* ---------- 准备：一篇带标题层级的笔记（大纲/缩进探针需要 data-depth 项） ---------- */

let noteId;
{
  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "新建笔记", exact: true }).first().click();
  await page.waitForURL((url) => url.searchParams.get("note") !== null);
  noteId = new URL(page.url()).searchParams.get("note");
  await page.getByLabel("笔记标题", { exact: true }).fill("响应式验证笔记");
  await page
    .getByLabel("笔记正文", { exact: true })
    .fill(
      [
        "# 一级标题",
        "开头段落。响应式布局必须在任何等效视口下不产生横向滚动，且核心功能始终可达。",
        "",
        "## 二级标题 A",
        "二级内容。".repeat(20),
        "",
        "### 三级标题",
        "三级内容。",
        "",
        "## 二级标题 B",
        "结尾段落。",
      ].join("\n"),
    );
  await page
    .locator('[data-testid="knowledge-status"] .knowledge-status-line')
    .filter({ hasText: /^(已保存|已同步)/u })
    .waitFor({ timeout: 20_000 });
}
const knowledgeUrl = `${origin}/knowledge?note=${noteId}`;
async function openKnowledge() {
  await page.goto(knowledgeUrl, { waitUntil: "networkidle" });
  await page.locator(".knowledge-app").waitFor({ timeout: 20_000 });
  await page.getByLabel("笔记标题", { exact: true }).waitFor({ timeout: 20_000 });
  await settle(200);
}

/* ---------- 1. 320px reflow（WCAG 1.4.10） ---------- */

await group("1. 320px reflow（WCAG 1.4.10，禁双向滚动）", async () => {
  await page.setViewportSize({ width: 320, height: 256 });
  for (const [name, url] of [
    ["knowledge", knowledgeUrl],
    ["studio", `${origin}/studio`],
    ["home", `${origin}/`],
  ]) {
    await page.goto(url, { waitUntil: "networkidle" });
    await settle(300);
    await noHScroll(`320×256 ${name}`);
    await topbarFits(`320×256 ${name}`);
  }

  // 单行工具栏的次要操作仍可达，面板在矮窗内独立滚动。
  const options = await openWorkspaceOptions(page);
  assert(await options.getByRole("combobox", { name: "外观主题" }).isVisible());
  const optionsBox = await options.boundingBox();
  assert(
    optionsBox &&
      optionsBox.x >= 0 &&
      optionsBox.x + optionsBox.width <= 321 &&
      optionsBox.y + optionsBox.height <= 257,
  );
  await options.getByRole("button", { name: "打开命令面板", exact: true }).click();
  await page.getByRole("dialog", { name: "命令面板", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "命令面板", exact: true }).waitFor({ state: "hidden" });
  assert(
    await page
      .getByRole("button", { name: "工作区选项", exact: true })
      .evaluate((el) => el === document.activeElement),
  );

  // 对话框打开态
  await openKnowledge();
  await page.keyboard.press("Control+o");
  await page.locator("dialog.knowledge-switcher").waitFor({ state: "visible" });
  await settle(250);
  await noHScroll("320×256 knowledge 对话框打开");
  await page.keyboard.press("Escape");
  await page.locator("dialog.knowledge-switcher").waitFor({ state: "hidden" });

  // 抽屉打开态（知识库侧栏 + 工作区面板）
  await page.getByRole("button", { name: "打开笔记列表" }).click();
  await page.locator(".knowledge-app.show-sidebar").waitFor();
  await settle(300);
  await noHScroll("320×256 knowledge 抽屉打开");
  await page.getByRole("button", { name: "收起列表" }).click();
  await settle(300);

  await page.goto(`${origin}/studio`, { waitUntil: "networkidle" });
  await page.locator(".studio-dock-shell").waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "打开工作区面板" }).click();
  await page.locator("#studio-mobile-panels[data-open]").waitFor();
  await settle(300);
  await noHScroll("320×256 studio 面板抽屉打开");
  await page.keyboard.press("Escape");
  await settle(250);
  await noHScroll("320×256 studio 面板抽屉关闭");
});

/* ---------- 2. 400% 缩放等效（320px 视口 + 根字号 64px） ---------- */

await group("2. 400% 缩放等效（320px + root 64px 核心功能可达）", async () => {
  await page.setViewportSize({ width: 320, height: 256 });
  await openKnowledge();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "64px";
  });
  await settle(250);

  // 新建笔记按钮（移动端 FAB）可点击：点击后进入新笔记
  const fab = page.locator("button.knowledge-fab");
  await fab.scrollIntoViewIfNeeded();
  const fabBox = await fab.boundingBox();
  assert(fabBox !== null && fabBox.x >= -1 && fabBox.x + fabBox.width <= 320 + 1, "FAB 不在视口内");
  await fab.click();
  await page.waitForURL((url) => url.searchParams.get("note") !== noteId);

  // 搜索可点击：全局搜索对话框打开并可关闭
  const search = page.getByRole("button", { name: "打开全局搜索" });
  await search.click();
  await page.locator("dialog.studio-search-dialog").waitFor({ state: "visible" });
  await settle(200);
  await noHScroll("320px/64px 搜索对话框");
  await page.keyboard.press("Escape");
  await page.locator("dialog.studio-search-dialog").waitFor({ state: "hidden" });

  // 模式切换可点击：kb-main < 640 时分段控件收进 ⋯，仅 ⋯ 内视图模式可达
  await openKnowledge();
  await page.getByRole("button", { name: "更多写作工具" }).click();
  const menu = page.locator(".knowledge-tools-menu");
  await menu.getByRole("button", { name: "阅读", exact: true }).click();
  await page.locator(".knowledge-prose").waitFor({ state: "visible" });
  await menu.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("笔记正文").waitFor({ state: "visible" });
  await page.locator(".knowledge-prose").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "更多写作工具" }).click(); // 收起菜单

  // 文本不溢出
  await noHScroll("320px/64px knowledge");
  await topbarFits("320px/64px knowledge");
  for (const url of [`${origin}/studio`, `${origin}/`]) {
    await page.goto(url, { waitUntil: "networkidle" });
    await settle(300);
    await noHScroll(`320px/64px ${url}`);
  }
  await page.evaluate(() => {
    document.documentElement.style.removeProperty("font-size");
  });
});

/* ---------- 3. 连续拉伸探针（320→1920→320 + 三态切换） ---------- */

async function threeState(width) {
  const state = await page.evaluate(() => {
    const side = document.querySelector(".knowledge-sidebar");
    const menuButton = document.querySelector(".knowledge-menu");
    const inline = document.querySelector(".knowledge-context-inline");
    const rail = document.querySelector(".knowledge-document > .knowledge-context");
    return {
      sidebarPosition: getComputedStyle(side).position,
      sidebarOpacity: Number(getComputedStyle(side).opacity),
      menuDisplay: getComputedStyle(menuButton).display,
      inlineDisplay: getComputedStyle(inline).display,
      railDisplay: getComputedStyle(rail).display,
    };
  });
  if (width < BP_MD) {
    assert.equal(state.sidebarPosition, "absolute", `${width}px: 侧栏应为抽屉（absolute）`);
    assert(state.menuDisplay !== "none", `${width}px: 抽屉入口（打开笔记列表）应可见`);
    assert(
      state.sidebarOpacity < 0.1,
      `${width}px: 抽屉关闭时应离场（opacity=${state.sidebarOpacity}）`,
    );
    assert(state.inlineDisplay !== "none", `${width}px: 右栏应切换为标题下折叠段`);
    assert.equal(state.railDisplay, "none", `${width}px: 常驻右栏应收起`);
  } else if (width < BP_LG) {
    assert.notEqual(state.sidebarPosition, "absolute", `${width}px: 侧栏应常驻`);
    assert(state.menuDisplay === "none", `${width}px: 抽屉入口应隐藏`);
    assert(state.sidebarOpacity > 0.9, `${width}px: 侧栏应可见（opacity=${state.sidebarOpacity}）`);
    assert(state.inlineDisplay !== "none", `${width}px: 右栏应为标题下折叠段`);
    assert.equal(state.railDisplay, "none", `${width}px: 常驻右栏应隐藏`);
  } else {
    assert.notEqual(state.sidebarPosition, "absolute", `${width}px: 侧栏应常驻`);
    assert(state.menuDisplay === "none", `${width}px: 抽屉入口应隐藏`);
    assert(state.sidebarOpacity > 0.9, `${width}px: 侧栏应可见（opacity=${state.sidebarOpacity}）`);
    assert(state.inlineDisplay === "none", `${width}px: 折叠段应隐藏`);
    assert(state.railDisplay !== "none", `${width}px: 常驻右栏应显示`);
  }
}

await group("3. 连续拉伸 320→1920→320（无溢出 + 三态正确切换）", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openKnowledge();
  const widths = [320, 520, 700, 760, 960, 1200, 1500, 1920];
  for (const width of [...widths, ...[...widths].reverse()]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(320);
    await noHScroll(`拉伸 ${width}px`);
    await topbarFits(`拉伸 ${width}px`);
    await threeState(width);
  }

  // 抽屉语义：覆盖正文（overlay）而非挤开内容
  await page.setViewportSize({ width: 520, height: 900 });
  await settle(320);
  const mainWidth = () =>
    page.evaluate(() => document.querySelector(".knowledge-main").getBoundingClientRect().width);
  const closed = await mainWidth();
  await page.getByRole("button", { name: "打开笔记列表" }).click();
  await page.locator(".knowledge-app.show-sidebar").waitFor();
  await settle(320);
  const drawer = await page.evaluate(() => {
    const side = document.querySelector(".knowledge-sidebar");
    const backdrop = document.querySelector(".knowledge-backdrop");
    return {
      position: getComputedStyle(side).position,
      transform: getComputedStyle(side).transform,
      opacity: Number(getComputedStyle(side).opacity),
      backdrop: backdrop === null ? null : getComputedStyle(backdrop).display,
    };
  });
  assert.equal(drawer.position, "absolute", "抽屉应绝对定位覆盖正文");
  assert.equal(drawer.transform, "none", "抽屉打开应落位");
  assert(drawer.opacity > 0.9, `抽屉打开应可见（opacity=${drawer.opacity}）`);
  assert.equal(drawer.backdrop, "block", "抽屉打开应有压暗层");
  const open = await mainWidth();
  assert(Math.abs(open - closed) <= 1, `抽屉应覆盖而非挤开正文：${closed} → ${open}`);
  await page.getByRole("button", { name: "收起列表" }).click();
  await settle(320);
  assert.equal(await mainWidth(), open, "收起抽屉后正文宽度应还原");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settle(320);
});

/* ---------- 4. 容器查询断言（真实布局宽度跨阈值） ---------- */

await group("4. 容器查询降级（kb-side/kb-rail/kb-main/dock-panel/ui-body）", async () => {
  await openKnowledge();

  // kb-side < 220：卡片只留标题 + 相对时间
  const sideProbe = () =>
    page.evaluate(() => {
      const side = document.querySelector(".knowledge-sidebar");
      const card = document.querySelector(".knowledge-note-card");
      return {
        width: side.getBoundingClientRect().width,
        preview: card?.querySelector("p")
          ? getComputedStyle(card.querySelector("p")).display
          : null,
        chips: [...document.querySelectorAll(".knowledge-note-meta .knowledge-chip")].map(
          (chip) => getComputedStyle(chip).display,
        ),
      };
    });
  const setSideWidth = (width) =>
    page.evaluate((value) => {
      const side = document.querySelector(".knowledge-sidebar");
      if (value === null) side.style.removeProperty("--w-sidebar");
      else side.style.setProperty("--w-sidebar", value);
    }, width);
  await setSideWidth("300px");
  await settle(320);
  const sideWide = await sideProbe();
  assert(sideWide.width >= 220, `kb-side 基线宽度应 ≥220（${sideWide.width}）`);
  assert(sideWide.preview !== "none", "kb-side 基线应显示卡片预览行");
  await setSideWidth("200px");
  await settle(320);
  const sideNarrow = await sideProbe();
  assert(sideNarrow.width < 220, `kb-side 探针应跨过 220 阈值（${sideNarrow.width}）`);
  assert.equal(sideNarrow.preview, "none", "kb-side<220 应隐藏卡片预览行");
  assert(
    sideNarrow.chips.every((display) => display === "none"),
    "kb-side<220 应隐藏卡片标签",
  );
  await setSideWidth(null);
  await settle(320);

  // kb-rail < 180：小节计数隐藏 + 大纲缩进减半
  const railProbe = () =>
    page.evaluate(() => {
      const rail = document.querySelector(".knowledge-document > .knowledge-context");
      return {
        width: rail.getBoundingClientRect().width,
        counts: [...rail.querySelectorAll(".knowledge-context-heading span")].map(
          (span) => getComputedStyle(span).display,
        ),
        indent: [...rail.querySelectorAll("button[data-depth]")].map((button) => [
          Number(button.dataset.depth),
          Number.parseFloat(getComputedStyle(button).paddingLeft),
        ]),
      };
    });
  const setRailWidth = (width) =>
    page.evaluate((value) => {
      const rail = document.querySelector(".knowledge-document > .knowledge-context");
      if (value === null) rail.style.removeProperty("--w-rail");
      else rail.style.setProperty("--w-rail", value);
    }, width);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settle(250);
  await setRailWidth("240px");
  await settle(320);
  const railWide = await railProbe();
  assert(railWide.width >= 180, `kb-rail 基线宽度应 ≥180（${railWide.width}）`);
  assert(
    railWide.counts.length > 0 && railWide.counts.every((display) => display !== "none"),
    "kb-rail 基线应显示小节计数",
  );
  const deepIndents = railWide.indent.filter(([depth]) => depth >= 2);
  assert(deepIndents.length > 0, "大纲应有二级以上条目（缩进探针）");
  await setRailWidth("160px");
  await settle(320);
  const railNarrow = await railProbe();
  assert(railNarrow.width < 180, `kb-rail 探针应跨过 180 阈值（${railNarrow.width}）`);
  assert(
    railNarrow.counts.every((display) => display === "none"),
    "kb-rail<180 应隐藏小节计数",
  );
  for (const [depth, indent] of railNarrow.indent) {
    if (depth < 2) continue;
    const baseline = railWide.indent.find(([d]) => d === depth)?.[1];
    assert.equal(indent, baseline / 2, `kb-rail<180 大纲 depth=${depth} 缩进应减半`);
  }
  await setRailWidth(null);
  await settle(320);

  // kb-main < 640：工具条 icon-only + 分段收进 ⋯（视图模式仍可达）
  const mainProbe = () =>
    page.evaluate(() => {
      const main = document.querySelector(".knowledge-main");
      const segmented = document.querySelector(".knowledge-mode-controls .knowledge-segmented");
      const statusLine = document.querySelector(".knowledge-status-line");
      const iconButtons = [
        ...main.querySelectorAll(
          "button:has(> svg):not(.knowledge-overflow-menu button, .knowledge-tools-menu button, .knowledge-tag-chip)",
        ),
      ].map((button) => getComputedStyle(button).fontSize);
      return {
        width: main.getBoundingClientRect().width,
        segmented: segmented === null ? null : getComputedStyle(segmented).display,
        statusLine: statusLine === null ? null : getComputedStyle(statusLine).display,
        iconButtons,
      };
    });
  const setSidebarToken = (width) =>
    page.evaluate((value) => {
      if (value === null) document.documentElement.style.removeProperty("--w-sidebar");
      else document.documentElement.style.setProperty("--w-sidebar", value);
    }, width);
  await setSidebarToken("300px");
  await settle(320);
  const mainWide = await mainProbe();
  assert(mainWide.width >= 640, `kb-main 基线宽度应 ≥640（${mainWide.width}）`);
  assert.notEqual(mainWide.segmented, "none", "kb-main 基线应显示视图模式分段");
  assert(
    mainWide.iconButtons.length > 0 && mainWide.iconButtons.every((size) => size !== "0px"),
    "kb-main 基线工具条按钮应显示文字",
  );
  await setSidebarToken("900px");
  await settle(320);
  const mainNarrow = await mainProbe();
  assert(mainNarrow.width < 640, `kb-main 探针应跨过 640 阈值（${mainNarrow.width}）`);
  assert.equal(mainNarrow.segmented, "none", "kb-main<640 分段控件应收进 ⋯");
  assert.equal(mainNarrow.statusLine, "none", "kb-main<640 状态文案应隐藏（只留状态点）");
  assert(
    mainNarrow.iconButtons.length > 0 && mainNarrow.iconButtons.every((size) => size === "0px"),
    "kb-main<640 工具条按钮应 icon-only（文字字号归零）",
  );
  // ⋯ 内视图模式可用：点击可达编辑 / 阅读
  await page.getByRole("button", { name: "更多写作工具" }).click();
  const menu = page.locator(".knowledge-tools-menu");
  await menu.getByRole("button", { name: "阅读", exact: true }).click();
  await page.locator(".knowledge-prose").waitFor({ state: "visible" });
  await menu.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("笔记正文").waitFor({ state: "visible" });
  await page.locator(".knowledge-prose").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "更多写作工具" }).click(); // 收起菜单
  await setSidebarToken(null);
  await settle(320);

  // dock-panel < 420：面板按钮 icon-only（同一视口内宽/窄容器对照）
  await page.goto(`${origin}/studio`, { waitUntil: "networkidle" });
  await page.locator(".studio-dock-shell").waitFor({ timeout: 20_000 });
  await page.getByRole("tab", { name: "存储" }).click();
  await page.getByRole("tab", { name: "控制台" }).click();
  await settle(400);
  const dockProbe = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".studio-dock .dv-content-container")].map((container) => ({
        text: container.textContent.trim().slice(0, 12),
        width: container.getBoundingClientRect().width,
        buttons: [...container.querySelectorAll("button:has(> svg)")].map((button) => ({
          label: (button.getAttribute("aria-label") ?? button.textContent ?? "")
            .trim()
            .slice(0, 10),
          font: getComputedStyle(button).fontSize,
        })),
      })),
    );
  const dock = await dockProbe();
  const armed = dock.filter((box) => box.buttons.length > 0);
  const narrow = armed.filter((box) => box.width < 420);
  const wide = armed.filter((box) => box.width >= 420);
  assert(narrow.length > 0, "应存在窄 dock-panel（按钮降级探针）");
  assert(wide.length > 0, "应存在宽 dock-panel（按钮未降级对照）");
  for (const box of narrow)
    for (const button of box.buttons)
      assert.equal(button.font, "0px", `dock-panel<420（${box.text}）${button.label} 应 icon-only`);
  for (const box of wide)
    for (const button of box.buttons)
      assert.notEqual(
        button.font,
        "0px",
        `dock-panel≥420（${box.text}）${button.label} 应保留文字`,
      );
  // 容器拉宽 → 降级解除（真实布局宽度跨阈值）
  const widened = await page.evaluate(async () => {
    const target = [...document.querySelectorAll(".studio-dock .dv-content-container")].find(
      (container) => container.getBoundingClientRect().width < 420,
    );
    target.style.width = "520px";
    await new Promise((resolve) => setTimeout(resolve, 200));
    const state = {
      width: target.getBoundingClientRect().width,
      buttons: [...target.querySelectorAll("button:has(> svg)")].map(
        (button) => getComputedStyle(button).fontSize,
      ),
    };
    target.style.removeProperty("width");
    return state;
  });
  assert(widened.width >= 420, `dock-panel 探针应跨过 420 阈值（${widened.width}）`);
  assert(
    widened.buttons.length > 0 && widened.buttons.every((size) => size !== "0px"),
    "dock-panel≥420 后按钮文字应恢复",
  );

  // ui-body < 400：表单 label 上置堆叠
  await openKnowledge();
  await page.getByText("导入、导出与备份", { exact: true }).click();
  await page.getByRole("button", { name: "恢复 ZIP 备份", exact: true }).click();
  await page.getByRole("dialog", { name: "恢复备份", exact: true }).waitFor();
  const bodyProbe = (width) =>
    page.evaluate(async (value) => {
      const body = document.querySelector("dialog[open] .ui-dialog-body");
      const label = body.querySelector(
        "label:has(> input:not([type=radio], [type=checkbox]), > select, > textarea)",
      );
      if (value !== null) body.style.width = value;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const state = {
        width: body.getBoundingClientRect().width,
        display: getComputedStyle(label).display,
        direction: getComputedStyle(label).flexDirection,
      };
      body.style.removeProperty("width");
      return state;
    }, width);
  const bodyWide = await bodyProbe(null);
  assert(bodyWide.width >= 400, `ui-body 基线宽度应 ≥400（${bodyWide.width}）`);
  assert.notEqual(bodyWide.direction, "column", "ui-body 基线 label 应保持行内布局");
  const bodyNarrow = await bodyProbe("300px");
  assert(bodyNarrow.width < 400, `ui-body 探针应跨过 400 阈值（${bodyNarrow.width}）`);
  assert.equal(bodyNarrow.display, "flex", "ui-body<400 label 应变为堆叠容器");
  assert.equal(bodyNarrow.direction, "column", "ui-body<400 label 应上置堆叠");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "恢复备份" }).waitFor({ state: "hidden" });
});

/* ---------- 5. 矮窗与安全区 ---------- */

await group("5. 矮窗（1440×480）全屏 sheet + 安全区 max() 兜底", async () => {
  await openKnowledge();
  await page.getByText("导入、导出与备份", { exact: true }).click();
  await page.getByRole("button", { name: "恢复 ZIP 备份", exact: true }).click();
  await page.getByRole("dialog", { name: "恢复备份", exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 480 });
  await settle(350);
  const sheet = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open].ui-dialog");
    const rect = dialog.getBoundingClientRect();
    const body = dialog.querySelector(".ui-dialog-body");
    return {
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
        right: rect.right,
      },
      bodyPaddingBottom: Number.parseFloat(getComputedStyle(body).paddingBottom),
      bodyOverflowY: getComputedStyle(body).overflowY,
    };
  });
  assert(sheet.rect.x >= -1, `sheet 不应左溢出（x=${sheet.rect.x}）`);
  assert(sheet.rect.right <= 1440 + 1, `sheet 不应右溢出（right=${sheet.rect.right}）`);
  assert(sheet.rect.width >= 1440 - 2, `矮窗对话框应全宽（width=${sheet.rect.width}）`);
  assert(
    sheet.rect.height >= 450 && sheet.rect.height <= 480,
    `sheet 高度应占满矮窗（height=${sheet.rect.height}）`,
  );
  assert(
    sheet.rect.bottom <= 480 + 1 && sheet.rect.bottom >= 480 - 4,
    `sheet 应底对齐（bottom=${sheet.rect.bottom}）`,
  );
  assert(
    ["auto", "scroll"].includes(sheet.bodyOverflowY),
    `sheet 内容应可滚动（overflow-y=${sheet.bodyOverflowY}）`,
  );
  assert(
    sheet.bodyPaddingBottom >= 20,
    `对话框体应保留安全区 max() 下限（${sheet.bodyPaddingBottom}px）`,
  );
  await noHScroll("1440×480 对话框 sheet");
  await topbarFits("1440×480");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "恢复备份" }).waitFor({ state: "hidden" });

  // 安全区：env() 在桌面为 0，max() 应退到令牌下限（断言 padding 存在）
  await page.setViewportSize({ width: 320, height: 800 });
  await settle(350);
  const safe = await page.evaluate(() => {
    const nav = document.querySelector(".knowledge-mobile-nav");
    const titlebar = document.querySelector(".knowledge-tabs-bar");
    const px = (value) => Number.parseFloat(value);
    return {
      navTop: px(getComputedStyle(nav).paddingTop),
      navBottom: px(getComputedStyle(nav).paddingBottom),
      navLeft: px(getComputedStyle(nav).paddingLeft),
      navRight: px(getComputedStyle(nav).paddingRight),
      titlebarTop: px(getComputedStyle(titlebar).paddingTop),
      titlebarRight: px(getComputedStyle(titlebar).paddingRight),
    };
  });
  assert(safe.navTop >= 8, `底部导航 padding-top 应有 max() 下限（${safe.navTop}px）`);
  assert(safe.navBottom >= 8, `底部导航 padding-bottom 应有安全区兜底（${safe.navBottom}px）`);
  assert(
    safe.navLeft >= 12 && safe.navRight >= 12,
    `底部导航左右应有安全区兜底（${safe.navLeft}/${safe.navRight}px）`,
  );
  assert(safe.titlebarTop >= 8, `移动端标题栏 padding-top 应有安全区兜底（${safe.titlebarTop}px）`);
  assert(
    safe.titlebarRight >= 12,
    `移动端标题栏 padding-right 应有安全区兜底（${safe.titlebarRight}px）`,
  );
  await noHScroll("320×800 安全区检查");
});

/* ---------- 6. reduced-motion：形态过渡直达终端 ---------- */

await group("6. reduced-motion：形态过渡 duration ≤ 0.01ms 且直达终端", async () => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openKnowledge();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await settle(150);
  const durations = await page.evaluate(() => {
    const targets = {
      sidebar: document.querySelector(".knowledge-sidebar"),
      rail: document.querySelector(".knowledge-document > .knowledge-context"),
      inline: document.querySelector(".knowledge-context-inline"),
      toolsMenu: document.querySelector(".knowledge-tools-menu"),
    };
    return Object.fromEntries(
      Object.entries(targets).map(([name, element]) => [
        name,
        getComputedStyle(element).transitionDuration,
      ]),
    );
  });
  for (const [name, value] of Object.entries(durations)) {
    assert(
      parseDurationMs(value) <= 0.011,
      `${name} reduced-motion 过渡应终止于 0.01ms（${value}）`,
    );
  }
  // 跨断点不等过渡：形态应直接落位
  await page.setViewportSize({ width: 1024, height: 800 });
  await settle(60);
  let state = await page.evaluate(() => ({
    rail: getComputedStyle(document.querySelector(".knowledge-document > .knowledge-context"))
      .display,
    inline: getComputedStyle(document.querySelector(".knowledge-context-inline")).display,
  }));
  assert.equal(state.rail, "none", "reduced-motion 跨 bp-lg 应直达终端（右栏收起）");
  assert.notEqual(state.inline, "none", "reduced-motion 跨 bp-lg 应直达终端（折叠段显示）");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settle(60);
  state = await page.evaluate(() => ({
    rail: getComputedStyle(document.querySelector(".knowledge-document > .knowledge-context"))
      .display,
    inline: getComputedStyle(document.querySelector(".knowledge-context-inline")).display,
  }));
  assert.notEqual(state.rail, "none", "reduced-motion 回跨 bp-lg 应直达终端（右栏显示）");
  assert.equal(state.inline, "none", "reduced-motion 回跨 bp-lg 应直达终端（折叠段收起）");

  await page.goto(`${origin}/studio`, { waitUntil: "networkidle" });
  await page.locator(".studio-dock-shell").waitFor({ timeout: 20_000 });
  const drawerDurations = await page.evaluate(() =>
    [".studio-mobile-panel-surface", ".studio-mobile-panel-backdrop"].map(
      (selector) => getComputedStyle(document.querySelector(selector)).transitionDuration,
    ),
  );
  for (const value of drawerDurations) {
    assert(parseDurationMs(value) <= 0.011, `工作区抽屉 reduced-motion 过渡应终止（${value}）`);
  }
  await page.emulateMedia({ media: null, reducedMotion: "no-preference" });
});

/* ---------- 7. 浮标不遮挡 ---------- */

const intersects = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

await group("7. 「继续对话」浮标不遮挡知识库内容与移动端导航", async () => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openKnowledge();
  await page.getByRole("button", { name: "打开 AI 助手" }).click();
  await page.locator(".assistant-window").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "收起 AI 助手" }).click();
  const launcher = page.locator("button.assistant-launcher");
  await launcher.waitFor({ state: "visible" });
  assert((await launcher.textContent())?.includes("继续对话"), "浮标应携带「继续对话」文案");

  // 浮标安全区：right/bottom 取 max(--space-5, env())
  const insets = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector(".assistant-launcher"));
    return {
      right: Number.parseFloat(style.right),
      bottom: Number.parseFloat(style.bottom),
    };
  });
  assert(insets.right >= 20, `浮标右侧安全区应 ≥20px（${insets.right}px）`);
  assert(insets.bottom >= 20, `浮标底部安全区应 ≥20px（${insets.bottom}px）`);

  // 文档列底部 ≥64px 避让区（设计契约）
  const clearance = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.querySelector(".knowledge-content")).paddingBottom),
  );
  assert(clearance >= 64, `文档列底部避让区应 ≥64px（${clearance}px）`);

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await settle(350);
    await page.evaluate(() => {
      const content = document.querySelector(".knowledge-content");
      content.scrollTop = content.scrollHeight;
    });
    await settle(350);
    const overlap = await page.evaluate(() => {
      const launcherRect = document
        .querySelector(".assistant-launcher")
        .getBoundingClientRect()
        .toJSON();
      const probes = [...document.querySelectorAll(".knowledge-editor-footer")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((element) => ({
          label: element.className,
          rect: element.getBoundingClientRect().toJSON(),
        }));
      return { launcherRect, probes };
    });
    assert(overlap.probes.length > 0, `${viewport.width}px: 未找到文档底部元素探针`);
    for (const probe of overlap.probes) {
      assert(
        !intersects(probe.rect, overlap.launcherRect),
        `${viewport.width}px: 浮标遮挡了底部元素 ${probe.label}`,
      );
    }
    await noHScroll(`${viewport.width}px 浮标检查`);
  }

  // ≤bp-md：浮标抬升到移动导航之上（window.css：bottom = h-control-lg + space-7 + 安全区），
  // 不得遮挡底部导航与新建按钮。
  await page.setViewportSize({ width: 320, height: 800 });
  await settle(350);
  await launcher.waitFor({ state: "visible" });
  const mobile = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      return element === null ? null : element.getBoundingClientRect().toJSON();
    };
    const overlaps = (a, b) =>
      a !== null &&
      b !== null &&
      a.x < b.x + b.width &&
      b.x < a.x + a.width &&
      a.y < b.y + b.height &&
      b.y < a.y + a.height;
    const launcher = rect(".assistant-launcher");
    return {
      launcher,
      nav: overlaps(launcher, rect(".knowledge-mobile-nav")),
      fab: overlaps(launcher, rect(".knowledge-fab")),
    };
  });
  assert(mobile.launcher !== null, "320×800: 浮标应存在");
  assert(!mobile.nav, `320×800: 浮标不得遮挡底部导航（rect=${JSON.stringify(mobile.launcher)}）`);
  assert(!mobile.fab, `320×800: 浮标不得遮挡新建按钮（rect=${JSON.stringify(mobile.launcher)}）`);
  await noHScroll("320×800 浮标检查");
});

assert.deepEqual(errors, [], "页面不应有未捕获异常");

const failed = results.filter(([, status]) => status === "FAIL").length;
console.log(
  failed === 0
    ? `responsive verification PASSED（7 组断言全绿）`
    : `responsive verification FAILED（${failed}/7 组失败）`,
);
await browser.close();
