import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { createKnowledgeGitHub } from "./fixtures/knowledge-github.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
async function settings(target) {
  await target.goto(origin, { waitUntil: "networkidle" });
  await target.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
  const panel = target.getByRole("dialog", { name: "AI 助手", exact: true });
  await panel.getByRole("button", { name: "接口", exact: true }).click();
  if (await panel.getByRole("button", { name: "编辑连接", exact: true }).count())
    await panel.getByRole("button", { name: "编辑连接", exact: true }).click();
  await panel.getByLabel("AI 接口地址").waitFor();
  return panel;
}
const save = async (panel) => {
  await panel.getByRole("button", { name: "保存连接", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "连接已保存" }).waitFor();
  await panel.getByRole("button", { name: "编辑连接", exact: true }).click();
};
try {
  let panel = await settings(page);
  await panel.getByLabel("AI 接口地址").fill("https://model.example.test/v1");
  await panel.getByLabel("AI 模型名称").fill("test-model");
  await panel.getByLabel("AI 接口密钥").fill("session-test-key");
  await panel.getByLabel("AI 密钥保存范围").selectOption("session");
  await save(panel);
  panel = await settings(page);
  assert.equal(
    await panel.getByLabel("AI 接口密钥").count(),
    0,
    "saved secret is not rendered into the input",
  );
  await panel.getByText("密钥已配置", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "替换密钥", exact: true }).click();
  assert.equal(await panel.getByLabel("AI 接口密钥").inputValue(), "");
  await panel.getByLabel("AI 接口密钥").fill("discard-this-key");
  await panel.getByRole("button", { name: "显示", exact: true }).click();
  assert.equal(await panel.getByLabel("AI 接口密钥").getAttribute("type"), "text");
  await panel.getByRole("button", { name: "保留原密钥", exact: true }).click();
  assert.equal(await panel.getByLabel("AI 模型名称").inputValue(), "test-model");
  const fresh = await context.newPage();
  // A storage-only same-origin page avoids opening the workspace's exclusive OPFS database twice.
  await fresh.route("**/credential-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Credential isolation test</title>",
    }),
  );
  await fresh.goto(`${origin}/credential-test`);
  assert.equal(
    await fresh.evaluate(
      () => Object.keys(sessionStorage).filter((key) => key.startsWith("bcr/credentials/")).length,
    ),
    0,
    "new tab cannot read the previous tab's session key",
  );
  await panel.getByLabel("AI 密钥保存范围").selectOption("device");
  await save(panel);
  assert.ok(
    await fresh.evaluate(() =>
      Object.keys(localStorage).some(
        (key) =>
          key.startsWith("bcr/credentials/") &&
          localStorage.getItem(key).includes("session-test-key"),
      ),
    ),
  );
  await fresh.close();
  panel = await settings(page);
  assert.equal(await panel.getByLabel("AI 接口密钥").count(), 0);
  await panel.getByLabel("AI 接口地址").fill("https://model.example.test/v1/");
  await panel.getByText("密钥已配置", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  await panel.getByRole("button", { name: "编辑连接", exact: true }).click();
  await panel.getByLabel("AI 密钥保存范围").selectOption("memory");
  await save(panel);
  assert.equal(
    await page.evaluate(
      () => Object.keys(localStorage).filter((key) => key.startsWith("bcr/credentials/")).length,
    ),
    0,
  );
  assert.equal(
    await page.evaluate(
      () => Object.keys(sessionStorage).filter((key) => key.startsWith("bcr/credentials/")).length,
    ),
    0,
  );
  panel = await settings(page);
  assert.equal(await panel.getByLabel("AI 接口密钥").inputValue(), "");
  assert.equal(await panel.getByLabel("AI 接口地址").inputValue(), "https://model.example.test/v1");
  await panel.getByLabel("AI 接口密钥").fill("device-test-key");
  await panel.getByLabel("AI 密钥保存范围").selectOption("device");
  await save(panel);
  await panel.getByLabel("AI 接口地址").fill("https://different.example.test/v1");
  assert.equal(await panel.getByLabel("AI 接口密钥").inputValue(), "");
  await save(panel);
  assert.equal(
    await page.evaluate(
      () => Object.keys(localStorage).filter((key) => key.startsWith("bcr/credentials/")).length,
    ),
    0,
  );
  await panel.getByLabel("AI 接口地址").fill("https://model.example.test/v1?key=unsafe");
  await panel.getByRole("button", { name: "保存连接", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "接口地址无效" }).waitFor();
  assert.ok(
    !(await page.evaluate(() => localStorage.getItem("bcr/agent-connection/v1"))).includes(
      "unsafe",
    ),
  );
  await panel.getByLabel("AI 接口地址").fill("/api/llm/v1");
  await save(panel);
  panel = await settings(page);
  assert.equal(await panel.getByLabel("AI 接口地址").inputValue(), "/api/llm/v1");
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  await panel.getByText("管理连接", { exact: true }).click();
  await panel.getByRole("button", { name: "删除连接", exact: true }).click();
  assert.notEqual(await page.evaluate(() => localStorage.getItem("bcr/agent-connection/v1")), null);
  await panel.getByRole("button", { name: "确认删除", exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem("bcr/agent-connection/v1")), null);

  // New knowledge sync UX: the dialog opens from the sync status popover.
  const syncSettings = async (target) => {
    const trigger = target.locator(".knowledge-status-trigger");
    const popover = target.locator(".knowledge-sync-popover");
    await trigger.click();
    if (!(await popover.evaluate((el) => el.matches(":popover-open")))) await trigger.click();
    await popover.getByRole("button", { name: "同步设置…", exact: true }).click();
    const dialog = target.getByRole("dialog", { name: "同步设置", exact: true });
    await dialog.waitFor();
    return dialog;
  };
  const github = createKnowledgeGitHub();
  github.state.defaultBranch = "trunk";
  await context.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const result = await github.handle(request.url(), request.method(), request.postDataJSON());
    await route.fulfill({ status: result.status, json: result.json });
  });
  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  let sync = await syncSettings(page);
  await sync.getByLabel("GitHub 仓库地址").fill("https://github.com/test-owner/notes");
  await sync.getByLabel("GitHub Token", { exact: true }).fill("github-test-token");
  await sync.getByLabel("记住此设备").check();
  await sync.getByRole("button", { name: "连接并同步", exact: true }).click();
  await sync.getByRole("status").filter({ hasText: "已与 GitHub 同步" }).waitFor();
  assert.ok(github.state.requests.some((request) => request.path === "/git/ref/heads/trunk"));
  await sync.getByLabel("自动同步", { exact: true }).check();
  await page.reload({ waitUntil: "networkidle" });
  sync = await syncSettings(page);
  assert.equal(await sync.getByLabel("自动同步", { exact: true }).isChecked(), true);
  // The stored token is never rendered into an input: SecretField shows a masked
  // 密钥已配置 row instead, so the token input does not exist at all.
  assert.equal(await sync.getByLabel("GitHub Token", { exact: true }).count(), 0);
  await sync.getByText("密钥已配置", { exact: true }).waitFor();
  await sync.getByLabel("GitHub 仓库地址").fill("test-owner/discarded-repo");
  await sync.getByRole("button", { name: "关闭同步设置", exact: true }).click();
  sync = await syncSettings(page);
  // The dialog keeps its children mounted, so closing keeps the unsaved draft…
  assert.equal(await sync.getByLabel("GitHub 仓库地址").inputValue(), "test-owner/discarded-repo");
  // …but the draft never touches the stored connection.
  assert.equal(
    await sync.locator(".bcr-connection-summary strong").textContent(),
    "test-owner/notes",
  );
  await page.reload({ waitUntil: "networkidle" });
  sync = await syncSettings(page);
  assert.equal(await sync.getByLabel("GitHub 仓库地址").inputValue(), "test-owner/notes");
  assert.equal(await sync.getByLabel("GitHub Token", { exact: true }).count(), 0);
  await sync.getByLabel("GitHub 仓库地址").fill("test-owner/other-notes");
  assert.equal(await sync.getByLabel("GitHub Token", { exact: true }).inputValue(), "");
  assert.equal(
    await sync.getByRole("button", { name: "连接并同步", exact: true }).isDisabled(),
    true,
  );
  await sync.getByLabel("GitHub Token", { exact: true }).fill("new-token");
  github.state.private = false;
  await sync.getByRole("button", { name: "连接并同步", exact: true }).click();
  await sync.getByRole("alert").filter({ hasText: "请使用私有仓库" }).waitFor();
  assert.equal(
    await page.evaluate(
      () => Object.keys(localStorage).filter((key) => key.startsWith("bcr/credentials/")).length,
    ),
    1,
  );
  github.state.private = true;
  await sync.getByRole("button", { name: "连接并同步", exact: true }).click();
  await sync.getByRole("status").filter({ hasText: "已与 GitHub 同步" }).waitFor();
  assert.equal(await sync.getByLabel("自动同步", { exact: true }).isChecked(), false);
  assert.equal(
    await page.evaluate(
      () => Object.keys(localStorage).filter((key) => key.startsWith("bcr/credentials/")).length,
    ),
    0,
  );
  await sync.getByLabel("记住此设备").check();
  await sync.getByRole("button", { name: "连接并同步", exact: true }).click();
  await sync.getByRole("status").filter({ hasText: "已与 GitHub 同步" }).waitFor();
  await sync.getByRole("button", { name: "清除 Token", exact: true }).click();
  await sync.getByRole("button", { name: "确认清除", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => Object.keys(localStorage).filter((key) => key.startsWith("bcr/credentials/")).length,
    ),
    0,
  );

  panel = await settings(page);
  await panel.getByLabel("AI 接口地址").fill("/api/llm/v1");
  await panel.getByLabel("AI 模型名称").fill("test");
  await panel.getByLabel("AI 接口密钥").fill("never-persisted");
  await panel.getByLabel("AI 密钥保存范围").selectOption("device");
  await page.evaluate(() => {
    const set = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem").value;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("bcr/credentials/"))
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await panel.getByRole("button", { name: "保存连接", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "存储操作失败" }).waitFor();
  assert.equal(await panel.getByRole("status").filter({ hasText: "连接已保存" }).count(), 0);
  await page.setViewportSize({ width: 375, height: 812 });
  await panel.getByLabel("AI 密钥保存范围").scrollIntoViewIfNeeded();
  assert.ok(await panel.getByLabel("AI 密钥保存范围").isVisible());
  await mkdir("scripts/shots", { recursive: true });
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => {
      const footer = document.querySelector(".bcr-connection-footer");
      return footer && footer.getBoundingClientRect().bottom <= window.innerHeight;
    });
    const footer = panel.getByRole("button", { name: "保存连接", exact: true });
    const box = await footer.boundingBox();
    await page.screenshot({ path: `scripts/shots/connection-${viewport.width}.png` });
    assert.ok(
      box && box.y >= 0 && box.y + box.height <= viewport.height,
      `save action stays inside viewport: ${JSON.stringify({ box, viewport })}`,
    );
    assert.ok(
      await panel
        .locator(".bcr-connection-body")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "settings must not scroll horizontally",
    );
  }
  await panel.getByLabel("AI 模型名称").fill("unsaved-model");
  await panel.getByLabel("AI 模型名称").press("Escape");
  await panel.getByRole("button", { name: "放弃修改", exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "接口",
    null,
    { timeout: 3000 },
  );
  assert.equal(
    await panel
      .getByRole("button", { name: "接口", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "credential persistence PASSED: metadata, session/device consent, target binding, deletion and storage failure",
  );
} finally {
  await browser.close();
}
