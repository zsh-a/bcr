import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchEphemeralBrowser, ensureShots } from "./lib/browser.mjs";
import { openWorkspaceOptions, closeTopBar } from "./lib/topbar.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage(),
  errors = [],
  failedRequests = [],
  requests = [];
page.setDefaultTimeout(30000);
await page.emulateMedia({ reducedMotion: "reduce" });
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => requests.push(request.url()));
page.on("requestfailed", (request) =>
  failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
);
const shots = ensureShots();
let lastRead,
  lastReceipt,
  lastExport,
  lastList,
  completed = 0,
  sequence = 0;

await page.route("**/api/diagram-test/v1/chat/completions", async (route) => {
  const request = route.request().postDataJSON();
  for (const name of [
    "diagram_list",
    "diagram_read",
    "diagram_create",
    "diagram_patch",
    "diagram_layout",
    "diagram_export",
  ])
    assert.ok(
      request.tools.some((tool) => tool.function.name === name),
      `registered ${name}`,
    );
  const prompt = [...request.messages].reverse().find((message) => message.role === "user").content;
  const last = request.messages.at(-1),
    resumed = last?.role === "tool";
  let result;
  if (resumed) {
    result = JSON.parse(last.content);
    if (result.elements && Array.isArray(result.elements)) lastRead = result;
    if (result.status === "saved") lastReceipt = result;
    if (result.format === "svg") lastExport = result;
    if (Array.isArray(result.diagrams)) lastList = result;
  }
  const call = (name, args) => ({
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: `diagram_${++sequence}`,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  });
  let delta;
  if (!resumed)
    delta = call(
      prompt.includes("创建")
        ? "diagram_create"
        : prompt.includes("导出")
          ? "diagram_export"
          : prompt.includes("查找")
            ? "diagram_list"
            : "diagram_read",
      prompt.includes("创建")
        ? {
            requestId: "browser-create-once",
            title: "AI 流程图",
            graph: {
              nodes: [
                { id: "first", label: "输入" },
                { id: "second", label: "处理" },
              ],
              edges: [{ id: "first-second", source: "first", target: "second" }],
            },
          }
        : prompt.includes("导出")
          ? { format: "svg" }
          : {},
    );
  else if (lastRead === result && prompt.includes("修改"))
    delta = call("diagram_patch", {
      id: result.id,
      revision: result.revision,
      patch: prompt.includes("过期")
        ? { update: [{ id: "browser", label: "不应覆盖手动编辑" }] }
        : prompt.includes("连接")
          ? { update: [{ id: "worker-cache", source: "storage", label: "缓存同步" }] }
          : {
              update: [{ id: "browser", label: "浏览器客户端", width: 280 }],
              addNodes: [{ id: "cache", label: "缓存", type: "rectangle" }],
              addEdges: [{ id: "worker-cache", source: "worker", target: "cache", label: "命中" }],
            },
    });
  else if (lastRead === result && prompt.includes("布局"))
    delta = call("diagram_layout", {
      id: result.id,
      revision: result.revision,
      ids: ["browser", "worker", "storage"],
      direction: "DOWN",
    });
  else delta = { role: "assistant", content: `绘图操作完成 ${++completed}` };
  const done = !delta.tool_calls;
  await route.fulfill({
    contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ id: "drawing-test", model: "fake", choices: [{ delta, finish_reason: done ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
  });
});

async function menu(name) {
  await page.getByRole("button", { name: "图表操作", exact: true }).click();
  const popup = page.getByRole("menu", { name: "图表操作", exact: true });
  await popup.getByRole("menuitem", { name, exact: true }).click();
  await popup.waitFor({ state: "hidden" });
}
async function checkActionMenu(mobile = false) {
  const trigger = page.getByRole("button", { name: "图表操作", exact: true });
  await trigger.focus();
  await trigger.press("ArrowDown");
  const popup = page.getByRole("menu", { name: "图表操作", exact: true });
  await popup.waitFor();
  const box = await popup.boundingBox();
  assert.ok(box.width <= 260, "commands use the shared compact menu width");
  assert.ok(box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1);
  assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height + 1);
  for (const item of await popup.getByRole("menuitem").all()) {
    const aligned = await item.evaluate((element) => {
      const icon = element.querySelector("svg").getBoundingClientRect();
      const text = [...element.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
      );
      const range = document.createRange();
      range.selectNode(text);
      const label = range.getBoundingClientRect();
      return Math.abs(icon.y + icon.height / 2 - label.y - label.height / 2) < 3;
    });
    assert.ok(aligned, `menu icon and label must share a row: ${await item.textContent()}`);
    assert.ok((await item.boundingBox()).height >= (mobile ? 44 : 32));
  }
  await popup.press("End");
  assert.ok(
    await popup
      .getByRole("menuitem", { name: "删除图表", exact: true })
      .evaluate((element) => element === document.activeElement),
    "End navigates to the final command",
  );
  await page.screenshot({ path: `${shots}/diagram-actions-${page.viewportSize().width}.png` });
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "hidden" });
  assert.ok(await trigger.evaluate((element) => element === document.activeElement));
}
async function exported(name = "下载可编辑文件") {
  const pending = page.waitForEvent("download");
  await menu(name);
  const download = await pending;
  return { download, bytes: await readFile(await download.path()) };
}
async function drawing() {
  return JSON.parse((await exported()).bytes.toString());
}
async function saved() {
  await page.locator(".diagram-save-state").filter({ hasText: "已保存" }).waitFor();
}
async function drawRectangle(x = 300, y = 650) {
  await page.getByTestId("toolbar-rectangle").locator("..").click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 110, y + 64, { steps: 8 });
  await page.mouse.up();
  await page.getByTestId("toolbar-selection").locator("..").click();
  await saved();
}
let panel, input;
const approval = () => panel.getByRole("group", { name: "待确认的操作" });
async function send(prompt, needsApproval = false) {
  const count = completed;
  await input.fill(prompt);
  await input.press("Enter");
  if (needsApproval) await approval().waitFor();
  else await panel.getByText(`绘图操作完成 ${count + 1}`, { exact: true }).waitFor();
}
async function accept(name = "应用修改") {
  const count = completed;
  await approval().getByRole("button", { name, exact: true }).click();
  await panel.getByText(`绘图操作完成 ${count + 1}`, { exact: true }).waitFor();
}

try {
  await page.goto(`${origin}/diagram`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "系统架构", exact: false }).waitFor();
  assert.equal((await page.locator(".ui-app-toolbar").boundingBox()).y, 0);
  assert.equal(await page.locator(".studio-topbar").isVisible(), false);
  await page.screenshot({ path: `${shots}/diagram-welcome.png` });
  await page.getByRole("button", { name: "系统架构", exact: false }).click();
  await page.locator(".excalidraw").waitFor();
  await saved();
  await checkActionMenu();
  const originalUrl = page.url(),
    original = await drawing();
  assert.equal(original.type, "excalidraw");
  assert.ok(
    original.elements.some(
      (element) => element.type === "text" && element.originalText.includes("本地存储"),
    ),
  );
  assert.ok(
    original.elements
      .filter((element) => element.type === "arrow")
      .every((edge) => edge.startBinding && edge.endBinding),
  );
  assert.equal(new URL(page.url()).pathname, "/diagram");
  assert.equal(
    (
      await page.request.get(
        `${origin}/diagram-assets/fonts/Liberation/LiberationSans-Regular.woff2`,
      )
    ).status(),
    200,
    "fonts are available on the same origin",
  );
  assert.equal(
    requests.some((url) => url.includes("esm.run")),
    false,
    "no font CDN",
  );

  await page.getByLabel("图表名称", { exact: true }).fill("浏览器架构研究");
  await page.getByLabel("图表名称", { exact: true }).press("Enter");
  await saved();
  await drawRectangle();
  const beforeMove = await drawing(),
    beforeMoveIds = new Set(original.elements.map((element) => element.id));
  const toMove = beforeMove.elements.find(
    (element) => element.type === "rectangle" && !beforeMoveIds.has(element.id),
  );
  await page.mouse.click(325, 650);
  await page.keyboard.press("ArrowRight");
  await saved();
  const manual = await drawing(),
    originalIds = new Set(original.elements.map((element) => element.id));
  const manualShape = manual.elements.find(
    (element) => element.type === "rectangle" && !originalIds.has(element.id),
  );
  assert.ok(manualShape, "native manual drawing is saved");
  assert.ok(manualShape.x > toMove.x, "editing an existing native element is saved");
  await page.screenshot({ path: `${shots}/diagram-editor-light.png` });

  await page.getByRole("button", { name: "AI 绘图", exact: true }).click();
  panel = page.getByRole("dialog", { name: "AI 助手", exact: true });
  await panel.getByRole("button", { name: "接口", exact: true }).click();
  await panel.getByLabel("AI 接口地址").fill(`${origin}/api/diagram-test/v1`);
  await panel.getByLabel("AI 模型名称").fill("fake-model");
  await panel.getByRole("button", { name: "保存连接", exact: true }).click();
  await panel.getByRole("button", { name: "← 返回对话", exact: true }).click();
  input = panel.getByPlaceholder("提问、整理思路，或请我处理当前内容…");
  await send("读取当前画布");
  assert.ok(lastRead.elements.some((element) => element.id === manualShape.id));
  assert.equal(lastRead.title, "浏览器架构研究");
  await send("修改标签并增加缓存", true);
  assert.ok((await approval().textContent()).includes("浏览器客户端"));
  assert.ok((await approval().textContent()).includes("缓存"));
  assert.equal(lastReceipt, undefined, "approval preview does not write");
  await accept();
  assert.equal(lastReceipt.status, "saved");
  await panel.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
  let changed = await drawing();
  assert.ok(
    changed.elements.some(
      (element) => element.id === "label-browser" && element.originalText === "浏览器客户端",
    ),
  );
  assert.ok(changed.elements.some((element) => element.id === "cache"));
  const browserNode = changed.elements.find((element) => element.id === "browser"),
    browserLabel = changed.elements.find((element) => element.id === "label-browser");
  assert.equal(browserNode.width, 280);
  assert.ok(
    Math.abs(browserNode.x + browserNode.width / 2 - browserLabel.x - browserLabel.width / 2) < 1,
    "bound text follows resized native geometry",
  );
  assert.ok(
    changed.elements.some(
      (element) => element.id === "worker-cache" && element.endBinding.elementId === "cache",
    ),
  );
  assert.deepEqual(
    changed.elements.find((element) => element.id === manualShape.id),
    manualShape,
    "untargeted hand-drawn element is retained exactly",
  );

  await page.mouse.click(350, 740);
  await page.keyboard.press("Control+z");
  await saved();
  const undone = await drawing();
  assert.equal(
    undone.elements.some((element) => element.id === "cache" && !element.isDeleted),
    false,
    "one undo removes the AI batch",
  );
  assert.equal(
    undone.elements.find((element) => element.id === "label-browser" && !element.isDeleted)
      ?.originalText,
    "浏览器\n交互与展示",
  );
  assert.ok(undone.elements.some((element) => element.id === manualShape.id && !element.isDeleted));
  await page.mouse.click(350, 740);
  await page.keyboard.press("Control+Shift+z");
  await saved();
  assert.ok(
    (await drawing()).elements.some((element) => element.id === "cache" && !element.isDeleted),
  );

  await page.getByRole("button", { name: "AI 绘图", exact: true }).click();
  await send("整理局部布局", true);
  await accept();
  await send("导出当前 SVG");
  assert.ok(lastExport.content.includes("<svg"));
  assert.ok(lastExport.content.includes("浏览器客户端"));
  await panel.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
  const laidOut = await drawing();
  const positioned = (id) => laidOut.elements.find((element) => element.id === id);
  assert.ok(positioned("worker").y > positioned("browser").y);
  assert.ok(positioned("storage").y > positioned("worker").y);
  assert.deepEqual(
    positioned(manualShape.id),
    manualShape,
    "local layout retains unrelated native drawing",
  );

  await page.getByRole("button", { name: "AI 绘图", exact: true }).click();
  await send("修改过期的画布", true);
  // While approval is pending, a manual edit makes the prepared patch stale.
  await drawRectangle(300, 735);
  const beforeStale = await drawing();
  await accept();
  assert.ok((await panel.innerText()).includes("画布已变化"));
  await panel.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
  assert.deepEqual(
    (await drawing()).elements,
    beforeStale.elements,
    "stale AI writes do not replace manual edits",
  );

  await page.getByRole("button", { name: "从 Mermaid 插入", exact: true }).click();
  const code = page.getByRole("dialog", { name: "从 Mermaid 插入", exact: true });
  await code.getByLabel("Mermaid 代码").fill("flowchart LR\n  A[接收请求] --> B[读取缓存]");
  await code.getByRole("button", { name: "插入图形", exact: true }).click();
  await code.waitFor({ state: "hidden" });
  await saved();
  const withMermaid = await drawing();
  assert.ok(
    withMermaid.elements.some(
      (element) => element.type === "text" && element.originalText === "读取缓存",
    ),
  );
  assert.ok(withMermaid.elements.some((element) => element.id === manualShape.id));

  const svg = (await exported("导出 SVG")).bytes.toString();
  assert.ok(svg.includes("<svg"));
  assert.ok(svg.includes("浏览器客户端"));
  const png = (await exported("导出 PNG")).bytes;
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  await menu("复制笔记引用");
  const reference = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(reference.includes("[浏览器架构研究](/diagram?diagram="));

  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".excalidraw").waitFor();
  await saved();
  assert.equal(await page.getByLabel("图表名称").inputValue(), "浏览器架构研究");
  assert.equal(page.url(), originalUrl);
  const restored = await drawing();
  assert.ok(restored.elements.some((element) => element.id === "cache"));
  assert.ok(restored.elements.some((element) => element.id === manualShape.id));
  assert.equal(restored.elements.find((element) => element.id === manualShape.id).x, manualShape.x);

  // The Studio shell has a project lease. Use a separate same-origin writer fixture
  // to verify the drawing domain's durable version guard independently of that lease.
  const second = await context.newPage();
  second.on("pageerror", (error) => errors.push(error.message));
  await second.route("**/diagram-window-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Drawing storage fixture</title>",
    }),
  );
  await second.goto(`${origin}/diagram-window-fixture`);
  await second.evaluate(async (id) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("bcr-diagrams", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await navigator.locks.request(
      "bcr-diagrams-write",
      () =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction("records", "readwrite"),
            records = transaction.objectStore("records");
          const documentKey = `workspace/diagrams/${id}.v1`,
            indexKey = "workspace/diagrams.index.v1";
          const documentRequest = records.get(documentKey),
            indexRequest = records.get(indexKey);
          indexRequest.onsuccess = () => {
            const document = JSON.parse(documentRequest.result),
              index = JSON.parse(indexRequest.result);
            document.title = "其他窗口保存";
            document.revision = crypto.randomUUID();
            document.updatedAt = Date.now();
            index.items = index.items.map((item) =>
              item.id === id
                ? {
                    ...item,
                    title: document.title,
                    revision: document.revision,
                    updatedAt: document.updatedAt,
                  }
                : item,
            );
            records.put(JSON.stringify(document), documentKey);
            records.put(JSON.stringify(index), indexKey);
          };
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
        }),
    );
    db.close();
  }, new URL(originalUrl).searchParams.get("diagram"));
  await page.getByLabel("图表名称").fill("过期窗口的修改");
  await page.getByLabel("图表名称").press("Enter");
  await page.getByRole("alert").filter({ hasText: "其他窗口" }).waitFor();
  await second.close();
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".excalidraw").waitFor();
  await saved();
  assert.equal(await page.getByLabel("图表名称").inputValue(), "其他窗口保存");

  await openWorkspaceOptions(page);
  await page.getByRole("combobox", { name: "外观主题", exact: true }).selectOption("dark");
  await page.keyboard.press("Escape");
  await closeTopBar(page);
  await page.locator(".excalidraw.theme--dark").waitFor();
  await page.screenshot({ path: `${shots}/diagram-editor-dark.png` });
  for (const [width, height] of [
    [320, 720],
    [390, 844],
    [812, 375],
  ]) {
    await page.setViewportSize({ width, height });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "no horizontal page overflow",
    );
    assert.ok(
      await page.locator(".diagram-canvas").evaluate((element) => element.clientHeight > 100),
    );
    await checkActionMenu(width <= 720);
    if (width <= 720) {
      for (const name of ["我的图表", "AI 绘图", "图表操作"]) {
        const target = await page.getByRole("button", { name, exact: true }).boundingBox();
        assert.ok(target.width >= 44 && target.height >= 44, `${name} has a touch target`);
      }
      assert.ok((await page.getByLabel("图表名称", { exact: true }).boundingBox()).width >= 70);
      await menu("从 Mermaid 插入");
    } else {
      await page.getByRole("button", { name: "从 Mermaid 插入", exact: true }).click();
    }
    const box = await page
      .getByRole("dialog", { name: "从 Mermaid 插入", exact: true })
      .boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0, "dialog fits viewport");
    await page.screenshot({ path: `${shots}/diagram-mobile-${width}.png` });
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog", { name: "从 Mermaid 插入", exact: true })
      .waitFor({ state: "hidden" });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Import makes a separate drawing, keeping the original file and its embedded attachments.
  const importedScene = structuredClone(withMermaid);
  const importedArrow = importedScene.elements.find((element) => element.id === "worker-cache"),
    importedLabel = importedScene.elements.find((element) => element.id === "label-worker-cache");
  importedArrow.strokeColor = "#a04c32";
  importedArrow.strokeWidth = 3;
  importedLabel.id = "custom-bound-label";
  importedArrow.boundElements = importedArrow.boundElements.map((bound) =>
    bound.type === "text" ? { ...bound, id: importedLabel.id } : bound,
  );
  await page.locator('.diagram-app > input[type="file"]').setInputFiles({
    name: "导入图表.excalidraw",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedScene)),
  });
  await page.getByLabel("图表名称").filter({ visible: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="图表名称"]')?.value === "导入图表",
  );
  assert.notEqual(page.url(), originalUrl);
  assert.ok((await drawing()).elements.some((element) => element.id === "cache"));
  await page.getByRole("button", { name: "我的图表", exact: true }).click();
  assert.ok(
    await page
      .getByRole("dialog", { name: "我的图表", exact: true })
      .getByRole("button", { name: /其他窗口保存/ })
      .isVisible(),
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "我的图表", exact: true }).waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "AI 绘图", exact: true }).click();
  panel = page.getByRole("dialog", { name: "AI 助手", exact: true });
  input = panel.getByPlaceholder("提问、整理思路，或请我处理当前内容…");
  await send("修改连接的起点", true);
  await accept();
  await panel.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
  const rewired = await drawing(),
    edge = rewired.elements.find((element) => element.id === "worker-cache");
  assert.equal(edge.startBinding.elementId, "storage");
  assert.equal(edge.endBinding.elementId, "cache");
  assert.equal(edge.strokeColor, "#a04c32");
  assert.equal(edge.strokeWidth, 3);
  assert.equal(
    rewired.elements
      .find((element) => element.id === "worker")
      .boundElements?.some((bound) => bound.id === edge.id),
    false,
  );
  assert.ok(
    rewired.elements
      .find((element) => element.id === "storage")
      .boundElements.some((bound) => bound.id === edge.id),
  );
  assert.ok(edge.boundElements.some((bound) => bound.id === "custom-bound-label"));
  assert.equal(
    rewired.elements.find((element) => element.id === "custom-bound-label").originalText,
    "缓存同步",
  );

  // Shared tools can create a file while the editor is not active.
  await page.keyboard.press("Alt+0");
  await page.locator(".home-app-card").first().waitFor();
  await page.keyboard.press("Control+j");
  await panel.waitFor();
  await send("创建一张新图表", true);
  await accept("创建图表");
  const created = lastReceipt;
  assert.equal(new URL(page.url()).pathname, "/", "creation requires no active editor");
  await send("再次创建相同的图表", true);
  await accept("创建图表");
  assert.equal(lastReceipt.id, created.id);
  assert.equal(lastReceipt.revision, created.revision);
  await send("查找我的图表");
  assert.ok(lastList.diagrams.some((document) => document.id === created.id));
  await panel.getByRole("link", { name: "AI 流程图 ↗", exact: true }).last().click();
  await panel.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
  await page.locator(".excalidraw").waitFor();
  assert.ok((await drawing()).elements.some((element) => element.id === "first"));

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "命令面板", exact: true });
  await palette.getByRole("button", { name: /^打开 个人知识库/ }).click();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.locator(".knowledge-app .cm-content").fill(reference);
  const noteUrl = page.url();
  await page
    .locator('.knowledge-app [data-link-target^="/diagram?"]')
    .click({ modifiers: ["Control"] });
  await page.waitForURL(originalUrl);
  assert.equal(context.pages().length, 1, "a note reference stays in the existing workspace");
  await page.goBack();
  await page.waitForURL(noteUrl);
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page.getByRole("link", { name: "浏览器架构研究", exact: true }).click();
  await page.waitForURL(originalUrl);
  assert.equal(context.pages().length, 1);
  assert.deepEqual(errors, []);
  console.log(
    "diagram PASSED: native drawing, all six AI tools, approval/patch, undo/redo, stale revisions, Mermaid, exports, local fonts, refresh, conflict guards, note references and responsive dialogs",
  );
} catch (error) {
  console.error("Failed requests:", failedRequests.slice(-12));
  console.error((await page.locator("body").innerText()).slice(-10000));
  await page.screenshot({ path: `${shots}/diagram-failure.png` });
  throw error;
} finally {
  await browser.close();
}
