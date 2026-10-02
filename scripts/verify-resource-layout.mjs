import assert from "node:assert/strict";
import { launchEphemeralBrowser, collectPageErrors, ensureShots } from "./lib/browser.mjs";
import { openWorkspaceOptions, closeTopBar } from "./lib/topbar.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15_000);
await page.emulateMedia({ reducedMotion: "reduce" });
const errors = collectPageErrors(page);
const title = () => page.getByLabel("笔记标题", { exact: true });
const search = () => page.getByLabel("筛选笔记列表", { exact: true });
const list = () => page.getByRole("navigation", { name: "笔记列表", exact: true });
const results = () => list().locator(".knowledge-result");
const scope = () => page.getByRole("group", { name: "笔记范围", exact: true });
const noteInfo = () => page.getByRole("dialog", { name: "笔记信息", exact: true });
async function action(name) {
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function create(name, body) {
  const previous = page.url();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.waitForURL((url) => url.href !== previous);
  await title().fill(name);
  await page.getByLabel("笔记正文", { exact: true }).fill(body);
}
async function workspaceTheme(value) {
  await openWorkspaceOptions(page);
  await page.getByRole("combobox", { name: "外观主题", exact: true }).selectOption(value);
  await page.keyboard.press("Escape");
  await closeTopBar(page);
}
async function fits() {
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "resource layout does not overflow horizontally",
  );
  const toolbar = await page.locator(".knowledge-toolbar").boundingBox();
  assert(toolbar.height <= 57, "Knowledge has one compact toolbar");
}

try {
  await page.goto(`${origin}/knowledge`);
  await create("Alpha", "# Overview\n\nA body match for needle.");
  await create("needle", "# Exact title\n\nTitle matches outrank body matches.");
  await create("Zeta", "# Last visited\n\nA recent note.");
  assert.equal(await page.locator("aside.knowledge-context:visible").count(), 0);
  const resize = page.getByRole("separator", { name: "调整侧栏宽度", exact: true });
  for (let i = 0; i < 3; i++) await resize.press("ArrowLeft");
  await page.waitForTimeout(220);
  const sidebar = await page.locator(".knowledge-sidebar").boundingBox();
  assert(Math.abs(sidebar.width - 240) < 2, "sidebar reaches its compact 240px width");
  await search().fill("needle");
  await results().nth(1).waitFor();
  assert.equal(await results().first().getAttribute("aria-label"), "needle");
  assert.equal(await results().nth(1).getAttribute("aria-label"), "Alpha");
  assert.equal(await results().nth(1).locator("mark").innerText(), "needle");
  const input = await search().boundingBox();
  assert(
    input.width >= 110,
    "search remains usable when scope, query and clear controls are present",
  );
  await results().first().focus();
  await page.keyboard.press("End");
  assert.equal(
    await results()
      .nth(1)
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelector('[aria-label="笔记标题"]')?.value === "Alpha",
  );
  await search().press("Escape");
  assert.equal(await search().inputValue(), "");
  await scope().getByRole("button", { name: "最近", exact: true }).click();
  await results().first().waitFor();
  assert.equal(await results().first().getAttribute("aria-label"), "Alpha");
  await scope().getByRole("button", { name: "收藏", exact: true }).click();
  await page.getByText("还没有收藏笔记", { exact: true }).waitFor();
  await search().fill("unmatched");
  await search().press("Escape");
  assert.equal(
    await scope().getByRole("button", { name: "收藏", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await scope().getByRole("button", { name: "全部", exact: true }).click();
  await action("新建集合");
  await page.getByLabel("新知识集合名称", { exact: true }).fill("Research");
  await page.getByRole("button", { name: "创建集合", exact: true }).click();
  const collection = page.getByLabel("筛选笔记集合", { exact: true });
  const collectionId = await collection.inputValue();
  assert(collectionId, "new collection becomes the current scope");
  await search().fill("missing");
  await page
    .locator(".knowledge-list-empty-actions")
    .getByRole("button", { name: "清除搜索", exact: true })
    .click();
  assert.equal(
    await collection.inputValue(),
    collectionId,
    "clearing query preserves collection scope",
  );
  assert.equal(await search().evaluate((el) => el === document.activeElement), true);
  await page.getByRole("button", { name: "重置全部筛选", exact: true }).click();
  await page.getByRole("button", { name: "编辑笔记属性", exact: true }).click();
  await page.getByRole("button", { name: "添加标签", exact: true }).click();
  await page.getByLabel("笔记标签", { exact: true }).fill("Modern");
  await page.getByLabel("笔记标签", { exact: true }).press("Enter");
  await page
    .locator("aside.knowledge-context")
    .getByRole("button", { name: "关闭笔记信息", exact: true })
    .click();
  await page.getByRole("button", { name: "编辑笔记属性", exact: true }).click();
  await page.getByRole("button", { name: "移除标签 Modern", exact: true }).waitFor();
  await page.getByRole("button", { name: "收起上下文栏", exact: true }).click();
  await page.getByRole("button", { name: "进入专注模式", exact: true }).click();
  assert.equal(await page.locator(".knowledge-sidebar").isVisible(), false);
  assert.equal(await page.getByRole("button", { name: "编辑", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "切换笔记列表", exact: true }).click();
  assert.equal(await page.locator(".knowledge-app").getAttribute("data-sidebar"), "expanded");
  for (const theme of ["light", "dark"]) {
    await workspaceTheme(theme);
    await fits();
    await page.screenshot({ path: `${shots}/resource-knowledge-${theme}.png` });
  }
  for (const width of [320, 390, 812]) {
    await page.setViewportSize({ width, height: 844 });
    await fits();
    if (width <= 720) {
      assert.equal(await page.locator(".knowledge-sidebar").evaluate((el) => el.inert), true);
      await page.getByRole("button", { name: "切换笔记列表", exact: true }).click();
      await search().fill("needle");
      await search().press("Escape");
      assert.equal(await page.locator(".knowledge-sidebar").evaluate((el) => el.inert), false);
      await search().press("Escape");
      assert.equal(await page.locator(".knowledge-sidebar").evaluate((el) => el.inert), true);
    }
    await page.getByRole("button", { name: "展开上下文栏", exact: true }).click();
    await noteInfo().waitFor();
    assert(await noteInfo().evaluate((el) => el.matches(":modal")));
    await noteInfo()
      .getByRole("group", { name: "笔记信息视图" })
      .getByRole("button", { name: /^大纲/u })
      .click();
    await noteInfo().getByRole("button", { name: "Overview", exact: true }).click();
    await noteInfo().waitFor({ state: "hidden" });
    await page.screenshot({ path: `${shots}/resource-knowledge-${width}.png` });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/reader`);
  await page.locator(".reader-toolbar").waitFor();
  await page.getByRole("button", { name: "打开书库", exact: true }).click();
  const books = page.locator(".reader-library-quick");
  const bookSearch = books.getByLabel("筛选书名或作者", { exact: true });
  await bookSearch.fill("unmatched-reader-fixture");
  await books
    .locator(".reader-library-empty")
    .getByRole("button", { name: "清除搜索", exact: true })
    .click();
  assert.equal(await bookSearch.inputValue(), "");
  assert(await bookSearch.evaluate((el) => el === document.activeElement));
  await books.getByRole("button", { name: "收起书库", exact: true }).click();
  for (const theme of ["light", "dark"]) {
    await workspaceTheme(theme);
    const colors = await page.evaluate(() => {
      const toolbar = getComputedStyle(document.querySelector(".reader-toolbar"));
      const reading = getComputedStyle(document.querySelector(".reader-reading-scroll"));
      const global = getComputedStyle(document.documentElement);
      return {
        toolbar: toolbar.getPropertyValue("--color-text").trim(),
        global: global.getPropertyValue("--color-text").trim(),
        reading: reading.getPropertyValue("--color-text").trim(),
        paper: reading.getPropertyValue("--read-text").trim(),
      };
    });
    assert.equal(colors.toolbar, colors.global, "Reader chrome follows workspace theme");
    assert.equal(
      colors.reading,
      colors.paper,
      "Reader content follows its independent paper theme",
    );
  }
  await page.goto(`${origin}/diagram`);
  await page.getByRole("button", { name: "我的图表", exact: true }).click();
  const diagrams = page.getByRole("dialog", { name: "我的图表", exact: true });
  const drawingSearch = diagrams.getByLabel("搜索图表", { exact: true });
  await drawingSearch.fill("unmatched-diagram-fixture");
  await diagrams
    .locator(".diagram-library-empty")
    .getByRole("button", { name: "清除搜索", exact: true })
    .click();
  assert.equal(await drawingSearch.inputValue(), "");
  assert(await drawingSearch.evaluate((el) => el === document.activeElement));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: compact resources, ranked search, recent order, scoped clearing, properties, narrow context drawers and Reader theme boundaries",
  );
} finally {
  await browser.close();
}
