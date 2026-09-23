import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let receipt;
let completed = 0;
try {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/api/agent-test/v1/chat/completions", async (route) => {
    const request = route.request().postDataJSON();
    assert.ok(request.tools.some((tool) => tool.function.name === "knowledge_create_note"));
    assert.ok(request.tools.some((tool) => tool.function.name === "knowledge_update_note"));
    const resumed = request.messages.at(-1)?.role === "tool";
    if (resumed) {
      const result = JSON.parse(request.messages.at(-1).content);
      if (result.status === "saved") receipt = result;
    }
    const prompt = [...request.messages]
      .reverse()
      .find((message) => message.role === "user").content;
    const updating = prompt.includes("更新");
    const delta = resumed
      ? { role: "assistant", content: `处理完成 ${++completed}` }
      : {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `write_${completed}`,
              type: "function",
              function: {
                name: updating ? "knowledge_update_note" : "knowledge_create_note",
                arguments: JSON.stringify(
                  updating
                    ? {
                        id: receipt.id,
                        revision: receipt.revision,
                        body: "经确认更新后的正文。",
                        tags: ["已更新"],
                      }
                    : {
                        requestId: "browser-create-once",
                        title: "跨域创建的笔记",
                        body: "跨域创建的正文。",
                        tags: ["验证"],
                      },
                ),
              },
            },
          ],
        };
    await route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ id: "test", model: "fake", choices: [{ delta, finish_reason: resumed ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "AI 助手", exact: true });
  await panel.getByRole("button", { name: "接口", exact: true }).click();
  await panel.getByLabel("AI 接口地址").fill(`${origin}/api/agent-test/v1`);
  await panel.getByLabel("AI 模型名称").fill("fake-model");
  await panel.getByRole("button", { name: "保存到本次会话" }).click();
  await panel.getByRole("button", { name: "接口", exact: true }).click();
  const input = panel.getByPlaceholder("提问、整理思路，或请我处理当前内容…");
  const approval = panel.getByRole("group", { name: "待确认的操作" });
  async function send(prompt) {
    await input.fill(prompt);
    await input.press("Enter");
    await approval.waitFor();
  }
  async function resolve(accept) {
    const next = completed + 1;
    await approval
      .getByRole("button", { name: accept ? /创建笔记|保存修改/ : "放弃", exact: true })
      .click();
    await panel.getByText(`处理完成 ${next}`, { exact: true }).waitFor();
  }
  await send("创建笔记但先放弃");
  assert.ok((await approval.textContent()).includes("跨域创建的正文。"));
  assert.equal(receipt, undefined);
  await resolve(false);
  assert.equal(receipt, undefined);
  await send("创建笔记");
  await resolve(true);
  assert.equal(receipt.status, "saved");
  const created = receipt;
  await send("再次创建笔记，重用同一个请求");
  await resolve(true);
  assert.equal(receipt.id, created.id);
  assert.equal(receipt.revision, created.revision);
  await send("更新笔记");
  assert.ok((await approval.textContent()).includes("跨域创建的正文。"));
  assert.ok((await approval.textContent()).includes("经确认更新后的正文。"));
  await mkdir("scripts/shots", { recursive: true });
  await approval.getByRole("button", { name: "保存修改" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "scripts/shots/agent-review-desktop.png" });
  await approval.getByText("查看完整内容", { exact: true }).click();
  assert.ok(await approval.getByRole("region", { name: "完整变更内容" }).isVisible());
  await approval.getByText("查看完整内容", { exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => {
    const frame = document.querySelector(".assistant-window").getBoundingClientRect();
    return frame.x >= 0 && frame.right <= innerWidth;
  });
  const box = await panel.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 376, "mobile panel stays within viewport");
  await page.screenshot({ path: "scripts/shots/agent-review-mobile.png" });
  await page.setViewportSize({ width: 812, height: 375 });
  await approval.getByRole("button", { name: "保存修改" }).scrollIntoViewIfNeeded();
  assert.ok(await approval.getByRole("button", { name: "保存修改" }).isVisible());
  await resolve(true);
  assert.equal(receipt.body, "经确认更新后的正文。");
  assert.notEqual(receipt.revision, created.revision);
  assert.equal(new URL(page.url()).pathname, "/", "shared writes require no open knowledge editor");
  await page.setViewportSize({ width: 1280, height: 900 });
  await panel.getByRole("link", { name: "跨域创建的笔记 ↗", exact: true }).last().click();
  await panel.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".cm-content")?.textContent?.includes("经确认更新后的正文。"),
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() =>
    document.querySelector(".cm-content")?.textContent?.includes("经确认更新后的正文。"),
  );
  assert.equal(await page.getByLabel("笔记标题").inputValue(), "跨域创建的笔记");
  assert.deepEqual(errors, []);
  console.log(
    "knowledge agent writes PASSED: approval, denial, deduplication, update, mobile and durable save",
  );
} finally {
  await browser.close();
}
