import assert from "node:assert/strict";
import { launchEphemeralBrowser, collectPageErrors, ensureShots } from "./lib/browser.mjs";
import { createKnowledgeGitHub } from "./fixtures/knowledge-github.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await launchEphemeralBrowser();
const shots = ensureShots();
const fixture = createKnowledgeGitHub();
const errors = [];
const devices = [];
async function device() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  /** @type {{status: number, requests: number, hold: Promise<void> | null}} */
  const control = { status: 0, requests: 0, hold: null };
  await context.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    control.requests++;
    if (control.hold) {
      const hold = control.hold;
      control.hold = null;
      await hold;
    }
    if (control.status)
      return route.fulfill({
        status: control.status,
        headers,
        contentType: "application/json",
        body: "{}",
      });
    const result = await fixture.handle(
      request.url(),
      request.method(),
      request.postData() ? request.postDataJSON() : undefined,
    );
    await route.fulfill({
      status: result.status,
      headers,
      contentType: "application/json",
      body: JSON.stringify(result.json),
    });
  });
  const page = await context.newPage();
  await page.clock.install();
  page.setDefaultTimeout(15_000);
  const pageErrors = collectPageErrors(page);
  errors.push(pageErrors);
  await page.goto(`${origin}/knowledge`);
  await page.getByRole("navigation", { name: "笔记列表", exact: true }).waitFor();
  const result = { context, page, control };
  devices.push(result);
  return result;
}
const status = (d) => d.page.locator(".knowledge-status-line");
const popover = (d) => d.page.locator(".knowledge-sync-popover");
async function open(d) {
  if (!(await popover(d).isVisible())) await d.page.locator(".knowledge-status-trigger").click();
  await popover(d).waitFor();
}
async function close(d) {
  await d.page.keyboard.press("Escape");
  await popover(d).waitFor({ state: "hidden" });
}
async function dismiss(d) {
  const button = d.page.getByRole("button", { name: "关闭提示", exact: true });
  if (await button.isVisible()) await button.click();
}
async function edit(d, text) {
  const body = d.page.getByLabel("笔记正文", { exact: true });
  await body.press("ControlOrMeta+a");
  await d.page.keyboard.insertText(text);
  await d.page.waitForFunction(
    () => !document.querySelector(".knowledge-status-line")?.textContent?.includes("保存中"),
  );
}
async function connect(d, remember = false, enableAuto = false) {
  await open(d);
  await popover(d)
    .getByRole("button", { name: /^(设置同步|同步设置…)$/u })
    .click();
  await d.page.getByLabel("GitHub 仓库地址", { exact: true }).fill("alice/notes");
  await d.page.getByLabel("GitHub Token", { exact: true }).fill("fixture-only-token");
  if (remember) await d.page.getByLabel("记住此设备", { exact: true }).check();
  await d.page.getByRole("button", { name: "连接并同步", exact: true }).click();
  await d.page
    .locator(".knowledge-sync")
    .getByRole("status")
    .filter({ hasText: "已与 GitHub 同步" })
    .waitFor();
  const success = d.page.getByRole("region", { name: "连接完成", exact: true });
  await success.waitFor();
  assert.equal(
    await d.page.locator(".knowledge-sync").getByLabel("自动同步", { exact: true }).isChecked(),
    false,
  );
  if (enableAuto) {
    await success.getByRole("button", { name: "开启自动同步", exact: true }).click();
    await success.getByText("自动同步已开启", { exact: false }).waitFor();
    assert.equal(
      await d.page.locator(".knowledge-sync").getByLabel("自动同步", { exact: true }).isChecked(),
      true,
    );
    assert.ok(
      (await d.page.evaluate(() => localStorage.getItem("bcr/knowledge-auto-sync"))).endsWith(
        ":main",
      ),
    );
  }
  await d.page.getByRole("button", { name: "完成", exact: true }).click();
  await d.page
    .getByRole("button", { name: "关闭同步设置", exact: true })
    .waitFor({ state: "hidden" });
}
async function auto(d, enabled) {
  await open(d);
  await popover(d).getByLabel("自动同步", { exact: true }).setChecked(enabled);
  await close(d);
}
async function manual(d, text = "已同步") {
  await open(d);
  const requested = d.page.waitForRequest((request) =>
    request.url().startsWith("https://api.github.com/"),
  );
  await popover(d).locator("button.ui-btn-primary").click();
  await requested;
  await status(d).filter({ hasText: text }).waitFor();
}
async function tick(d, milliseconds) {
  await d.page.clock.fastForward(milliseconds);
}
try {
  const memory = await device();
  await memory.page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await memory.page.getByLabel("笔记标题", { exact: true }).fill("同步体验回归");
  await edit(memory, "共同正文");
  await connect(memory, false, true);
  await memory.page.reload();
  await status(memory).filter({ hasText: "需要补充 Token" }).waitFor();
  await open(memory);
  assert.equal(await popover(memory).getByLabel("自动同步", { exact: true }).isChecked(), true);
  assert.equal(
    await popover(memory).getByRole("button", { name: "补充 Token", exact: true }).count(),
    1,
  );
  const withoutToken = memory.control.requests;
  await close(memory);
  await edit(memory, "刷新后继续编辑，缺少 Token 时明确暂停。");
  await tick(memory, 5_000);
  assert.equal(
    memory.control.requests,
    withoutToken,
    "missing credentials never schedule requests",
  );
  await open(memory);
  await tick(memory, 250);
  await memory.page.screenshot({
    path: `${shots}/knowledge-sync-needs-token.png`,
    animations: "disabled",
  });
  await close(memory);

  const main = await device();
  await connect(main, true, true);
  await dismiss(main);
  await open(main);
  await popover(main)
    .locator(".knowledge-sync-result")
    .filter({ hasText: "上传 0 项，接收 1 项" })
    .waitFor();
  const changedTime = await popover(main)
    .locator("dl > div")
    .filter({ has: main.page.locator("dt", { hasText: "内容更新" }) })
    .locator("time")
    .getAttribute("datetime");
  const checkedTime = await popover(main)
    .locator("dl > div")
    .filter({ has: main.page.locator("dt", { hasText: "最近成功检查" }) })
    .locator("time")
    .getAttribute("datetime");
  await close(main);
  const beforePeriodic = main.control.requests;
  const periodicRequest = main.page.waitForRequest((request) =>
    request.url().startsWith("https://api.github.com/"),
  );
  await tick(main, 31_000);
  await periodicRequest;
  await status(main).filter({ hasText: "已同步" }).waitFor();
  assert.ok(main.control.requests > beforePeriodic, "periodic checks actually request the remote");
  await open(main);
  await popover(main)
    .locator(".knowledge-sync-result")
    .filter({ hasText: "检查完成，没有新改动" })
    .waitFor();
  assert.equal(
    await popover(main)
      .locator("dl > div")
      .filter({ has: main.page.locator("dt", { hasText: "内容更新" }) })
      .locator("time")
      .getAttribute("datetime"),
    changedTime,
  );
  assert.notEqual(
    await popover(main)
      .locator("dl > div")
      .filter({ has: main.page.locator("dt", { hasText: "最近成功检查" }) })
      .locator("time")
      .getAttribute("datetime"),
    checkedTime,
  );
  await close(main);
  assert.equal(
    await main.page.locator(".knowledge-notice").count(),
    0,
    "periodic successful checks are quiet",
  );
  await tick(main, 2_100);
  const beforeFocus = main.control.requests;
  const focusRequest = main.page.waitForRequest((request) =>
    request.url().startsWith("https://api.github.com/"),
  );
  await main.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await focusRequest;
  await main.page.waitForFunction(() =>
    document.querySelector(".knowledge-status-line")?.textContent?.includes("已同步"),
  );
  assert.ok(main.control.requests > beforeFocus);
  assert.equal(await main.page.locator(".knowledge-notice").count(), 0, "focus checks are quiet");
  await auto(main, false);
  await manual(main);
  await main.page.locator(".knowledge-notice").filter({ hasText: "已经是最新内容" }).waitFor();
  await close(main);
  await dismiss(main);

  let release;
  main.control.hold = new Promise((resolve) => {
    release = resolve;
  });
  await open(main);
  await tick(main, 250);
  await popover(main).getByRole("button", { name: "立即同步", exact: true }).click();
  await status(main).filter({ hasText: "正在同步" }).waitFor();
  await popover(main).getByRole("status").filter({ hasText: "正在读取远端内容" }).waitFor();
  await edit(main, "同步期间继续写作，新修改应保留待同步。");
  release();
  await status(main).filter({ hasText: "待同步" }).waitFor();
  await manual(main);
  await close(main);
  await dismiss(main);

  await auto(main, true);
  main.control.status = 503;
  await manual(main, "等待重试");
  const failed = main.control.requests;
  await close(main);
  await main.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await edit(main, "网络暂时失败时，继续编辑也不能绕过重试等待。");
  await tick(main, 8_000);
  assert.equal(main.control.requests, failed, "focus and edits obey the retry deadline");
  main.control.status = 0;
  await tick(main, 3_100);
  await status(main).filter({ hasText: "已同步" }).waitFor();
  assert.ok(main.control.requests > failed, "transient failures resume automatically");
  assert.equal(
    await main.page.locator(".knowledge-notice").count(),
    0,
    "successful automatic retry is quiet",
  );

  main.control.status = 401;
  await manual(main, "需要补充 Token");
  await close(main);
  const unauthorized = main.control.requests;
  await main.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await tick(main, 61_000);
  assert.equal(
    main.control.requests,
    unauthorized,
    "invalid authorization pauses automatic requests",
  );
  main.control.status = 0;
  await open(main);
  await popover(main).getByRole("button", { name: "补充 Token", exact: true }).click();
  assert.equal(
    await main.page.getByRole("region", { name: "连接完成", exact: true }).isVisible(),
    false,
    "a previous connection success never masks a subsequent authorization failure",
  );
  await main.page.getByRole("button", { name: "替换密钥", exact: true }).click();
  await main.page.getByLabel("GitHub Token", { exact: true }).fill("fixture-replacement-token");
  await main.page.getByRole("button", { name: "连接并同步", exact: true }).click();
  await main.page
    .locator(".knowledge-sync")
    .getByRole("status")
    .filter({ hasText: "已与 GitHub 同步" })
    .waitFor();
  await main.page.getByRole("button", { name: "完成", exact: true }).click();
  await main.page
    .getByRole("button", { name: "关闭同步设置", exact: true })
    .waitFor({ state: "hidden" });
  await status(main).filter({ hasText: "已同步" }).waitFor();

  main.control.status = 403;
  await manual(main, "同步需检查");
  await close(main);
  const forbidden = main.control.requests;
  await tick(main, 61_000);
  assert.equal(main.control.requests, forbidden, "permission failures do not poll repeatedly");
  main.control.status = 0;
  await manual(main);
  await close(main);
  await dismiss(main);

  await main.context.setOffline(true);
  await status(main).filter({ hasText: "等待联网" }).waitFor();
  const offline = main.control.requests;
  await edit(main, "离线编辑内容；恢复联网后自动补齐。");
  await tick(main, 5_000);
  assert.equal(main.control.requests, offline);
  await main.page.setViewportSize({ width: 390, height: 844 });
  await open(main);
  const bounds = await popover(main).boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await tick(main, 250);
  await main.page.screenshot({
    path: `${shots}/knowledge-sync-offline-mobile.png`,
    animations: "disabled",
  });
  await close(main);
  await main.page.setViewportSize({ width: 1440, height: 1000 });
  await main.context.setOffline(false);
  await status(main).filter({ hasText: "已同步" }).waitFor();
  await auto(main, false);

  const other = await device();
  await connect(other, true);
  await edit(main, "同一行本机改写");
  await edit(other, "同一行远端改写");
  await manual(other);
  await close(other);
  await manual(main, "冲突待处理");
  const conflicts = main.page.getByRole("dialog", { name: "处理冲突", exact: true });
  await conflicts.getByRole("button", { name: "保留双方", exact: true }).click();
  await conflicts.getByText("没有待处理的冲突。", { exact: true }).waitFor();
  await main.page.getByRole("button", { name: "关闭处理冲突", exact: true }).click();
  await main.page
    .getByRole("button", { name: "关闭处理冲突", exact: true })
    .waitFor({ state: "hidden" });
  await manual(main);
  await close(main);
  await manual(other);
  await close(other);
  assert.ok(
    (
      await other.page.getByRole("navigation", { name: "笔记列表", exact: true }).textContent()
    ).includes("远端副本"),
  );
  const remoteNotes = Object.entries(fixture.files()).filter(([path]) =>
    path.startsWith("knowledge/notes/"),
  );
  assert.equal(remoteNotes.length, 2);
  assert.ok(remoteNotes.some(([, text]) => text.includes("同一行本机改写")));
  assert.ok(remoteNotes.some(([, text]) => text.includes("同一行远端改写")));
  // A second conflict can be edited directly; closing and previewing retain its draft.
  await edit(main, "第二轮本机改写");
  await edit(other, "第二轮远端改写");
  await manual(other);
  await close(other);
  await manual(main, "冲突待处理");
  await conflicts.getByRole("button", { name: "编辑合并", exact: true }).click();
  const mergeBody = conflicts.getByRole("textbox", { name: /^合并正文：/u });
  assert.equal(
    await mergeBody.inputValue(),
    "第二轮本机改写",
    "new conflict starts from its own local version",
  );
  const combined = "手动整理：本机与远端的观点均已纳入。";
  await mergeBody.fill(combined);
  await conflicts.getByRole("button", { name: "本机 / 远端对比", exact: true }).click();
  await conflicts.getByRole("button", { name: "合并结果", exact: true }).click();
  assert.equal(
    await conflicts.locator(".knowledge-diff-flow").evaluate((node) =>
      Array.from(node.childNodes)
        .filter((child) => child.nodeName !== "DEL")
        .map((child) => child.textContent)
        .join(""),
    ),
    combined,
  );
  await conflicts.getByRole("button", { name: "编辑合并", exact: true }).click();
  assert.equal(await mergeBody.inputValue(), combined);
  await main.page.keyboard.press("Escape");
  await conflicts.waitFor({ state: "hidden" });
  await open(main);
  await popover(main).getByRole("button", { name: "查看冲突", exact: true }).click();
  assert.equal(await mergeBody.inputValue(), combined, "closing the dialog keeps the merge draft");
  await main.page.setViewportSize({ width: 390, height: 844 });
  const editorBounds = await mergeBody.boundingBox();
  assert.ok(editorBounds.x >= 0 && editorBounds.x + editorBounds.width <= 391);
  await mergeBody.fill("");
  assert.equal(
    await conflicts.getByRole("button", { name: "保存合并结果", exact: true }).isEnabled(),
    true,
  );
  await mergeBody.fill(combined);
  await tick(main, 250);
  await main.page.screenshot({
    path: `${shots}/knowledge-sync-manual-merge-mobile.png`,
    animations: "disabled",
  });
  await conflicts.getByRole("button", { name: "保存合并结果", exact: true }).click();
  await conflicts.getByText("没有待处理的冲突。", { exact: true }).waitFor();
  await main.page.getByRole("button", { name: "关闭处理冲突", exact: true }).click();
  await conflicts.waitFor({ state: "hidden" });
  await main.page.setViewportSize({ width: 1440, height: 1000 });
  await manual(main);
  await popover(main)
    .locator(".knowledge-sync-result")
    .filter({ hasText: "上传 1 项，接收 0 项" })
    .waitFor();
  await close(main);
  await manual(other);
  await close(other);
  assert.equal(await other.page.getByLabel("笔记正文", { exact: true }).innerText(), combined);
  const mergedFiles = Object.entries(fixture.files()).filter(([path]) =>
    path.startsWith("knowledge/notes/"),
  );
  assert.equal(mergedFiles.length, 2, "manual resolution updates one note without adding copies");
  assert.ok(mergedFiles.some(([, text]) => text.includes(combined)));
  assert.deepEqual(errors.flat(), []);
  console.log(
    "PASS: sync UX — onboarding, check results, credential recovery, quiet checks, phases, backoff, offline, mobile, keep-both and editable merges across devices",
  );
} catch (error) {
  for (let index = 0; index < devices.length; index++) {
    const { page } = devices[index];
    console.error(
      index,
      await page
        .locator("body")
        .innerText()
        .catch(() => "unavailable"),
    );
    await page
      .screenshot({ path: `${shots}/knowledge-sync-ux-failure-${index}.png` })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
