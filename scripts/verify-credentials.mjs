import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

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

  await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "GitHub 同步设置", exact: true }).click();
  await page.getByLabel("GitHub 用户或组织").fill("test-owner");
  await page.getByLabel("GitHub 私有仓库").fill("notes");
  await page.getByLabel("GitHub Token", { exact: true }).fill("github-test-token");
  await page.getByLabel("GitHub Token 保存范围").selectOption("device");
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "连接已保存" }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "GitHub 同步设置", exact: true }).click();
  await page.getByRole("button", { name: "编辑连接", exact: true }).click();
  assert.equal(await page.getByLabel("GitHub Token", { exact: true }).count(), 0);
  await page.getByLabel("GitHub 私有仓库").fill("discarded-repo");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "编辑连接", exact: true }).click();
  assert.equal(await page.getByLabel("GitHub 私有仓库").inputValue(), "notes");
  assert.equal(await page.getByLabel("GitHub Token", { exact: true }).count(), 0);
  await page.getByLabel("GitHub 私有仓库").fill("other-notes");
  assert.equal(await page.getByLabel("GitHub Token", { exact: true }).inputValue(), "");
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "连接已保存" }).waitFor();
  assert.equal(
    await page.evaluate(
      () => Object.keys(localStorage).filter((key) => key.startsWith("bcr/credentials/")).length,
    ),
    0,
  );
  await page.getByRole("button", { name: "编辑连接", exact: true }).click();
  await page.getByLabel("GitHub Token", { exact: true }).fill("new-token");
  await page.getByLabel("GitHub Token 保存范围").selectOption("device");
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await page.getByText("管理连接", { exact: true }).click();
  await page.getByRole("button", { name: "清除 Token", exact: true }).click();
  await page.getByRole("button", { name: "确认清除", exact: true }).click();
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
