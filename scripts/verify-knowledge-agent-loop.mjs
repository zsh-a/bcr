// Drives the real agent loop: the model calls a read-only tool, sees its result,
// then proposes a write that waits for approval before anything is written.
//
// No real key, no network.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const shots = "scripts/shots";
await mkdir(shots, { recursive: true });

const requests = [];

/**
 * Two scripted rounds:
 *  1. a tool call to `read_selection` (a surface tool, run automatically)
 *  2. a tool call to `apply_text_edit` (a write, held for approval)
 */
const server = createServer((req, res) => {
  if (req.url !== "/v1/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
    });
    res.end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    const parsed = JSON.parse(body);
    requests.push(parsed);
    const round = requests.length;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "access-control-allow-origin": "*",
    });
    const send = (chunk) => {
      res.write(`data: ${JSON.stringify({ id: "x", model: "fake", choices: [chunk] })}\n\n`);
    };
    if (round === 1) {
      send({ delta: { role: "assistant", content: "先看原文" } });
      send({
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_read",
              type: "function",
              function: { name: "read_selection", arguments: "{}" },
            },
          ],
        },
      });
    } else {
      send({ delta: { role: "assistant", content: "改好了" } });
      send({
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_edit",
              type: "function",
              function: {
                name: "apply_text_edit",
                arguments: JSON.stringify({ replacement: "第二段（由工具改写）" }),
              },
            },
          ],
        },
      });
    }
    send({ delta: { content: "" }, finish_reason: "tool_calls" });
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const chatOrigin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const errors = [];

const page = await context.newPage();
page.on("pageerror", (error) => errors.push(String(error)));

await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "写第一篇笔记" }).click();
const editor = page.locator(".cm-content");
await editor.click();
await page.keyboard.type("第一段。\n\n第二段。\n\n第三段。");
await page.waitForTimeout(700);
await page.evaluate(() => {
  const line = [...document.querySelectorAll(".cm-content .cm-line")].find((l) =>
    l.textContent?.includes("第二段"),
  );
  const range = document.createRange();
  range.selectNodeContents(line);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
});
await page.locator(".cm-content").dispatchEvent("keyup", { key: "Shift" });
await page.waitForTimeout(300);

await page.getByRole("button", { name: "打开 AI 助手" }).click();
const panel = page.locator(".studio-agent-window");
await panel.waitFor({ timeout: 10_000 });
await panel.getByRole("button", { name: "接口", exact: true }).click();
await panel.getByLabel("AI 接口地址").fill(`${chatOrigin}/v1`);
await panel.getByLabel("AI 模型名称").fill("fake-model");
await panel.getByRole("button", { name: "保存到本次会话" }).click();
await panel.getByRole("button", { name: "接口", exact: true }).click();

await panel.getByPlaceholder("告诉 AI 要如何修改…").fill("改写第二段");
await page.keyboard.press("Enter");

// The loop runs the surface's read tool, then holds the write for approval.
const approval = panel.locator("[aria-label='待确认的修改']");
await approval.waitFor({ timeout: 30_000 });
assert.ok(
  !(await editor.textContent())?.includes("由工具改写"),
  "a write must not land before the user approves",
);
// Two rounds: the tool call, then the resume that produced the proposal.
assert.equal(requests.length, 2, `expected a resume after the tool call, got ${requests.length}`);

await panel.screenshot({ path: `${shots}/knowledge-agent-loop.png` });
await approval.getByRole("button", { name: "应用", exact: true }).click();
await page.waitForTimeout(900);

const body = await editor.textContent();
assert.ok(body?.includes("第二段（由工具改写）"), `approved write should land: ${body}`);
assert.ok(body?.includes("第一段") && body?.includes("第三段"), "surrounding text must survive");

await page.getByRole("button", { name: "笔记版本历史" }).click();
await page.waitForSelector(".knowledge-history-list", { timeout: 10_000 });
assert.ok(
  (await page.locator(".knowledge-history-list button").count()) > 0,
  "the previous body must be retained as a revision",
);

assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
await browser.close();
server.close();
console.log("AI agent loop verification PASSED", { rounds: requests.length });
