// Exercises the single global assistant, window controls and real domain tools with a mock model.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const requests = [];
let failNext = false;
let failResume = false;
const server = createServer((req, res) => {
  if (req.url !== "/v1/chat/completions") return void res.writeHead(404).end();
  if (req.method === "OPTIONS") {
    res
      .writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
      })
      .end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const request = JSON.parse(body);
    requests.push(request);
    if (failNext) {
      failNext = false;
      res
        .writeHead(503, { "content-type": "application/json", "access-control-allow-origin": "*" })
        .end(JSON.stringify({ error: { message: "gateway temporarily unavailable" } }));
      return;
    }
    const latest =
      [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const resumed = request.messages.at(-1)?.role === "tool";
    if (resumed && failResume) {
      failResume = false;
      res
        .writeHead(503, { "content-type": "application/json", "access-control-allow-origin": "*" })
        .end(JSON.stringify({ error: { message: "failed after tool receipt" } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "access-control-allow-origin": "*" });
    const send = (delta, finish_reason) =>
      res.write(
        `data: ${JSON.stringify({ id: "test", model: "fake", choices: [{ delta, finish_reason }] })}\n\n`,
      );
    if (!resumed && (latest.includes("跨域查询") || latest.includes("修改当前笔记"))) {
      const query = latest.includes("跨域查询");
      send({ role: "assistant", content: query ? "正在检索笔记。" : "准备修改当前内容。" });
      send(
        {
          tool_calls: [
            {
              index: 0,
              id: `call_${requests.length}`,
              type: "function",
              function: {
                name: query ? "knowledge_find_notes" : "apply_text_edit",
                arguments: JSON.stringify(
                  query ? { query: "跨域验证" } : { replacement: "\n已确认的补充内容。" },
                ),
              },
            },
          ],
        },
        "tool_calls",
      );
    } else {
      send(
        {
          role: "assistant",
          content: resumed
            ? "本次操作已处理。"
            : latest === "你好"
              ? "**你好**，我可以帮你。"
              : "记得上一轮。",
        },
        "stop",
      );
    }
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
  assert.equal(
    new URL(page.url()).pathname,
    "/",
    "opening the assistant must preserve the workspace",
  );
  const panel = page.getByRole("dialog", { name: "AI 助手", exact: true });
  await panel.waitFor();
  assert.equal(await page.locator(".bcr-chat").count(), 1);
  await panel.getByRole("button", { name: "接口", exact: true }).click();
  await panel.getByLabel("AI 接口地址").fill(endpoint);
  await panel.getByLabel("AI 模型名称").fill("fake-model");
  await panel.getByRole("button", { name: "保存到本次会话" }).click();
  await panel.getByRole("button", { name: "接口", exact: true }).click();
  const input = panel.getByPlaceholder("提问、整理思路，或请我处理当前内容…");
  failNext = true;
  await input.fill("你好");
  await input.press("Enter");
  await panel.getByRole("alert").filter({ hasText: "本次请求未完成" }).waitFor();
  await panel.getByRole("button", { name: "重试", exact: true }).click();
  await panel.locator(".assistant-markdown strong").filter({ hasText: "你好" }).waitFor();
  const first = requests[0];
  assert.ok(
    first.tools.some((tool) => tool.function.name === "knowledge_find_notes"),
    "shared knowledge works before opening the editor",
  );

  // Pointer drag and resize, then expand/restore the same live conversation.
  const before = await panel.boundingBox();
  const grip = await panel.getByRole("button", { name: "拖动 AI 助手" }).boundingBox();
  await page.mouse.move(grip.x + 45, grip.y + 20);
  await page.mouse.down();
  await page.mouse.move(grip.x - 155, grip.y - 80, { steps: 8 });
  await page.mouse.up();
  const moved = await panel.boundingBox();
  assert.ok(moved.x < before.x - 150 && moved.y < before.y - 50, "drag changes window position");
  const resize = await panel.getByRole("button", { name: "调整助手窗口大小" }).boundingBox();
  await page.mouse.move(resize.x + 8, resize.y + 8);
  await page.mouse.down();
  await page.mouse.move(resize.x + 104, resize.y + 56, { steps: 8 });
  await page.mouse.up();
  const resized = await panel.boundingBox();
  assert.ok(resized.width > moved.width + 80 && resized.height > moved.height + 30);
  await panel.getByRole("button", { name: "展开助手窗口", exact: true }).click();
  assert.ok((await panel.boundingBox()).width > 1300);
  await panel.getByRole("button", { name: "还原助手窗口", exact: true }).click();
  assert.deepEqual(await panel.boundingBox(), resized);
  await panel.getByRole("button", { name: "收起 AI 助手", exact: true }).click();
  await page.getByRole("button", { name: "展开 AI 助手", exact: true }).click();
  await panel.locator(".assistant-markdown strong").filter({ hasText: "你好" }).waitFor();
  await panel.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();

  // Opening in a domain preserves the route and adds that domain's edit tools.
  await page.getByRole("button", { name: /个人知识库/ }).click();
  await page.getByRole("button", { name: "写第一篇笔记" }).click();
  await page.getByLabel("笔记标题").fill("跨域验证笔记");
  const editor = page.locator(".cm-content");
  await editor.fill("跨域验证：来自知识库的内容。");
  await page.waitForTimeout(700);
  assert.equal(await page.locator(".bcr-agent").count(), 0, "legacy inline AI editor is removed");
  const knowledgeUrl = page.url();
  await page.keyboard.press("Control+j");
  await panel.waitFor();
  assert.equal(page.url(), knowledgeUrl);
  await panel.locator(".bcr-chat-target strong").filter({ hasText: "个人知识库" }).waitFor();
  assert.ok(!(await panel.textContent()).includes("在光标处插入"));
  await input.fill("修改当前笔记");
  await input.press("Enter");
  const approval = panel.getByRole("group", { name: "待确认的操作" });
  await approval.waitFor();
  assert.ok(!(await editor.textContent()).includes("已确认"));
  await approval.getByRole("button", { name: "应用修改" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('.knowledge-editor [role="status"]')
      ?.textContent?.includes("已保存到本机"),
  );
  await panel.getByText("本次操作已处理。", { exact: false }).waitFor();
  await page.waitForTimeout(700);
  assert.ok((await editor.textContent()).includes("已确认的补充内容"));

  failResume = true;
  await input.fill("跨域查询后模拟网络失败");
  await input.press("Enter");
  const failedMessage = panel.locator(".is-agent").last();
  await failedMessage.getByRole("alert").waitFor();
  assert.equal(await failedMessage.getByRole("button", { name: "重试", exact: true }).count(), 0);
  assert.ok(await failedMessage.getByLabel("工具 knowledge_find_notes").count());
  assert.ok((await failedMessage.locator("pre").textContent()).includes("跨域验证笔记"));

  // Approval targets are frozen; a workspace switch must not redirect a pending write.
  const savedBody = await editor.textContent();
  await input.fill("再次修改当前笔记");
  await input.press("Enter");
  await approval.waitFor();

  // Switching workspaces preserves the window and history; knowledge remains callable.
  await page.keyboard.press("Alt+Digit1");
  await page.waitForURL(/\/studio(?:\?|$)/);
  await panel.locator(".bcr-chat-target strong").filter({ hasText: "Studio" }).waitFor();
  assert.ok(
    (await approval.textContent()).includes("跨域验证笔记"),
    "approval keeps its original target label",
  );
  await approval.getByRole("button", { name: "应用修改" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".bcr-chat-activity")?.textContent?.includes("已取消"),
  );
  await page.waitForTimeout(350);
  assert.equal(
    await editor.textContent(),
    savedBody,
    "switching workspaces invalidates a pending edit",
  );
  await input.fill("跨域查询知识库里的笔记");
  await input.press("Enter");
  await page.waitForFunction(() =>
    document
      .querySelector(".bcr-chat-activity")
      ?.textContent?.includes("knowledge_find_notes · 已完成"),
  );
  await panel.getByRole("button", { name: "发送", exact: true }).waitFor();
  await page.waitForTimeout(350);
  const crossDomain = requests.findLast((request) =>
    request.messages.some(
      (message) => message.role === "tool" && message.content?.includes("跨域验证笔记"),
    ),
  );
  assert.ok(crossDomain, "shared knowledge tool reads actual saved notes from another workspace");
  assert.ok(
    !crossDomain.tools.some((tool) => tool.function.name === "apply_text_edit"),
    "old workspace edit tool is not offered",
  );
  assert.ok(
    crossDomain.messages.some(
      (message) => message.role === "assistant" && message.content?.includes("你好"),
    ),
    "conversation survives domain changes",
  );

  await panel.locator(".bcr-chat-capabilities summary").click();
  await panel.getByRole("checkbox", { name: "启用知识库", exact: true }).uncheck();
  await panel.locator(".bcr-chat-capabilities summary").click();
  await input.fill("只做普通对话");
  await input.press("Enter");
  await panel.getByText("记得上一轮。", { exact: true }).waitFor();
  assert.ok(!requests.at(-1).tools.some((tool) => tool.function.name.startsWith("knowledge_")));
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({ path: "scripts/shots/assistant-floating.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const mobile = await panel.boundingBox();
  assert.ok(
    mobile.x >= 0 &&
      mobile.y >= 0 &&
      mobile.x + mobile.width <= 390 &&
      mobile.y + mobile.height <= 844,
  );
  await page.screenshot({ path: "scripts/shots/assistant-floating-mobile.png" });
  await input.focus();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "展开 AI 助手", exact: true }).waitFor();
  await page.keyboard.press("Control+j");
  await panel.waitFor();
  await page.goto(`${origin}/assistant`, { waitUntil: "networkidle" });
  await panel.waitFor();
  assert.equal(
    await page.locator(".bcr-chat").count(),
    1,
    "direct route opens the same global host architecture",
  );
  assert.deepEqual(errors, []);
  console.log("Global assistant verification PASSED", { requests: requests.length });
} catch (error) {
  console.error(await page.locator(".bcr-chat").innerText());
  console.error("Last request", JSON.stringify(requests.at(-1)));
  throw error;
} finally {
  await browser.close();
  server.close();
}
