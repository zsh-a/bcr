// Drives one real AI edit through the agent chat panel.
//
// Proves the whole path in a browser: the panel opens from the dock, a turn
// streams, the edit arrives as a card, and only "应用" writes — after which the
// previous body is recoverable. No real key, no network.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const shots = "scripts/shots";
await mkdir(shots, { recursive: true });

const REWRITE = "第二段（由助手改写）";
const requests = [];

// A real HTTP server, not `route.fulfill`: Playwright buffers a streamed route
// body, which would make a non-streaming implementation look identical.
const server = createServer((req, res) => {
  if (req.url !== "/v1/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  // The page is on another origin, so the browser sends a preflight first.
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
    if (body) requests.push(JSON.parse(body));
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "access-control-allow-origin": "*",
    });
    const send = (delta, finish) => {
      requests.length; // keep the closure honest about ordering
      res.write(
        `data: ${JSON.stringify({ id: "x", model: "fake", choices: [{ delta, finish_reason: finish }] })}\n\n`,
      );
    };
    send({ role: "assistant", content: "第二段" });
    await new Promise((r) => setTimeout(r, 500));
    send({ content: "（由助手改写）" });
    await new Promise((r) => setTimeout(r, 500));
    send({ content: "" }, "stop");
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const chatOrigin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const errors = [];
const agentWasm = [];

const page = await context.newPage();
page.on("pageerror", (error) => errors.push(String(error)));
page.on("request", (r) => {
  if (/agent_wasm.*\.wasm/u.test(r.url())) agentWasm.push(r.url());
});

await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "写第一篇笔记" }).click();

const editor = page.locator(".cm-content");
await editor.click();
await page.keyboard.type("第一段。\n\n第二段。\n\n第三段。");
await page.waitForTimeout(700);

// Select 第二段 so the assistant targets it rather than the cursor.
await page.evaluate(() => {
  const lines = [...document.querySelectorAll(".cm-content .cm-line")];
  const line = lines.find((l) => l.textContent?.includes("第二段"));
  const range = document.createRange();
  range.selectNodeContents(line);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
});
await page.locator(".cm-content").dispatchEvent("keyup", { key: "Shift" });
await page.waitForTimeout(300);

// The panel is not mounted until the user asks for it.
assert.deepEqual(agentWasm, [], "the agent module must not load on page open");
await page.getByRole("button", { name: "打开 AI 助手" }).click();
const panel = page.locator(".studio-agent-window");
await panel.waitFor({ timeout: 10_000 });

// It reports what it would edit.
const target = await panel.locator(".bcr-chat-target").textContent();
assert.ok(target?.includes("选中"), `panel should report the selection, got: ${target}`);

await panel.getByRole("button", { name: "接口", exact: true }).click();
await panel.getByLabel("AI 接口地址").fill(`${chatOrigin}/v1`);
await panel.getByLabel("AI 模型名称").fill("fake-model");
await panel.getByRole("button", { name: "保存到本次会话" }).click();
// Close the settings form so the thread is what the capture shows.
await panel.getByRole("button", { name: "接口", exact: true }).click();

await panel.getByPlaceholder("告诉 AI 要如何修改…").fill("改写得更简洁");
await page.keyboard.press("Enter");
// Streaming: the first chunk must be visible before the turn completes.
const streamed = panel.locator(".bcr-chat-text");
await streamed.first().waitFor({ timeout: 10_000 });
assert.ok(
  (await streamed.first().textContent())?.includes("第二段"),
  "text should appear while the turn is still running",
);
const card = panel.locator(".bcr-chat-card");
await card.waitFor({ timeout: 30_000 });

// The card is a proposal: the note is untouched until 应用.
assert.ok(
  !(await editor.textContent())?.includes("由助手改写"),
  "the card must not write to the note",
);
const diff = await card.locator(".bcr-chat-diff").textContent();
assert.ok(diff?.includes("第二段"), `diff should show the affected text: ${diff}`);

await panel.screenshot({ path: `${shots}/knowledge-agent-chat.png` });
await card.getByRole("button", { name: "应用", exact: true }).click();
await page.waitForTimeout(900);
const body = await editor.textContent();
assert.ok(body?.includes(REWRITE), `applied edit should reach the body: ${body}`);
assert.ok(body?.includes("第一段") && body?.includes("第三段"), "surrounding text must survive");
assert.ok(await card.locator("p[role='status']").first().isVisible(), "outcome");

// The pre-edit body is still recoverable.
await page.getByRole("button", { name: "笔记版本历史" }).click();
await page.waitForSelector(".knowledge-history-list", { timeout: 10_000 });
assert.ok(
  (await page.locator(".knowledge-history-list button").count()) > 0,
  "the previous body must be retained as a revision",
);

// The model got the instruction and only the targeted passage.
assert.equal(requests.length, 1, "exactly one turn");
const sent = JSON.stringify(requests[0]);
assert.ok(sent.includes("改写得更简洁"), "instruction reaches the model");
assert.ok(sent.includes("第二段"), "target passage is sent");
assert.ok(!sent.includes("第一段"), "untargeted text is not sent");

// Interacting with the document must not dismiss the assistant: pointing at
// what to change is the normal gesture while it is open.
await page.locator(".cm-content").click();
await page.waitForTimeout(600);
assert.equal(await panel.count(), 1, "clicking the document must not close the panel");

await panel.screenshot({ path: `${shots}/knowledge-agent-chat.png` });
assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
await browser.close();
server.close();
console.log("AI chat panel verification PASSED", { diff });
