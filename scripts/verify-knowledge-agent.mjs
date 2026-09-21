// Drives one real AI edit against a fake OpenAI-compatible endpoint.
//
// Proves the whole path in a browser: the wasm runtime loads, a turn runs, the
// proposal is reviewed, and only on accept does the note change — plus that the
// previous body is recoverable afterwards. No real key, no network.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const shots = "scripts/shots";
await mkdir(shots, { recursive: true });

const REWRITE = "第二段（已被 AI 改写）";
const received = [];

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [];
// The wasm module asks the endpoint for SSE. Answering it here keeps the test
// hermetic and lets us assert what the model was actually asked.
await context.route("**/chat/completions", async (route) => {
  const body = JSON.parse(route.request().postData() ?? "{}");
  received.push(body);
  const chunks = [
    { choices: [{ delta: { role: "assistant", content: REWRITE } }] },
    { choices: [{ delta: { content: "" }, finish_reason: "stop" }] },
  ];
  await route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream" },
    body:
      chunks.map((c) => `data: ${JSON.stringify({ id: "x", model: "fake", ...c })}\n\n`).join("") +
      "data: [DONE]\n\n",
  });
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(String(error)));
// The agent module must not be fetched until AI is actually used: the knowledge
// base is offline-first and this binary is ~3.5 MiB. The sqlite and kernels
// modules load at startup by design, so only the agent module is tracked.
const wasmRequests = [];
page.on("request", (request) => {
  if (/agent_wasm.*\.wasm$|\.wasm\?.*agent_wasm/u.test(request.url()))
    wasmRequests.push(request.url());
});

await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "写第一篇笔记" }).click();

// Seed a note with three paragraphs and put the caret in the second one.
const editor = page.locator(".cm-content");
await editor.click();
await page.keyboard.type("第一段。\n\n第二段。\n\n第三段。");
await page.waitForTimeout(700);

// Select "第二段。" — the single edit should replace only this range.
await page.evaluate(() => {
  const paragraphs = [...document.querySelectorAll(".cm-content .cm-line")];
  const target = paragraphs.find((p) => p.textContent?.includes("第二段"));
  const range = document.createRange();
  range.selectNodeContents(target);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
});
await page.locator(".cm-content").dispatchEvent("keyup", { key: "Shift" });
await page.waitForTimeout(200);

// Configure the endpoint (memory only) and ask for a rewrite.
await page.getByRole("button", { name: "AI 接口设置" }).click();
await page.getByLabel("AI 接口地址").fill(`${origin}/v1`);
await page.getByLabel("AI 模型名称").fill("fake-model");
await page.getByRole("button", { name: "保存到本次会话" }).click();
assert.deepEqual(wasmRequests, [], "the wasm module must not load before an edit is requested");

await page.getByLabel("告诉 AI 如何编辑这段正文").fill("改写得更简洁");
await page.getByRole("button", { name: "改写", exact: true }).click();
await page.waitForSelector(".knowledge-agent-preview", { timeout: 30_000 });

const diff = await page.locator(".knowledge-agent-diff").textContent();
const bodyBeforeAccept = await editor.textContent();

// Nothing is written before the user accepts.
assert.ok(!bodyBeforeAccept?.includes("已被 AI 改写"), "preview must not touch the note");

await page.getByRole("button", { name: "应用到笔记" }).click();
await page.waitForTimeout(800);
assert.ok(
  (await editor.textContent())?.includes(REWRITE),
  `accepted edit should reach the body, got: ${await editor.textContent()}`,
);
// The edit was a range replacement, not a whole-document rewrite.
const body = await editor.textContent();
assert.ok(body?.includes("第一段") && body?.includes("第三段"), "surrounding text must survive");

// The pre-edit body is recoverable from history.
await page.getByRole("button", { name: "笔记版本历史" }).click();
await page.waitForSelector(".knowledge-history-list", { timeout: 10_000 });
const revisions = await page.locator(".knowledge-history-list button").count();
assert.ok(revisions > 0, "the previous body must be retained as a revision");

// The endpoint received the instruction, the title context, and only the
// selected passage — not the whole note.
assert.equal(received.length, 1, "exactly one turn");
const sent = JSON.stringify(received[0]);
assert.ok(sent.includes("改写得更简洁"), "instruction reaches the model");
assert.ok(sent.includes("第二段"), "target passage is sent");
assert.ok(!sent.includes("第一段"), "untargeted text is not sent");

await page.screenshot({ path: `${shots}/knowledge-agent.png`, fullPage: true });
assert.ok(wasmRequests.length > 0, "the wasm module must load once an edit runs");
assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
await browser.close();
console.log("AI note edit verification PASSED", { revisions, diff, wasm: wasmRequests.length });
