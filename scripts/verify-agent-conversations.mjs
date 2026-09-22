// Host ownership, IME, streaming scroll, recovery and storage isolation in the real app.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";

const origin = process.env.BASE_URL ?? "http://127.0.0.1:5199";
const requests = [];
const server = createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    const request = JSON.parse(body);
    requests.push(request);
    const prompt = request.messages.at(-1).content;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (text, finish = null) =>
      res.write(
        `data: ${JSON.stringify({ id: "test", model: "test", choices: [{ delta: { content: text }, finish_reason: finish }] })}\n\n`,
      );
    if (prompt.includes("slow")) {
      send(Array.from({ length: 50 }, (_, n) => `第 ${n} 行，阅读时不应被拉回底部。\n\n`).join(""));
      let tick = 0;
      const timer = setInterval(() => {
        if (++tick < 30) send(`流式片段 ${tick}\n\n`);
        else {
          clearInterval(timer);
          send("流式完成", "stop");
          res.end("data: [DONE]\n\n");
        }
      }, 120);
      res.on("close", () => clearInterval(timer));
    } else {
      send(`已收到：${prompt}`, "stop");
      res.end("data: [DONE]\n\n");
    }
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
async function open(target) {
  await target.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
  return target.getByRole("dialog", { name: "AI 助手", exact: true });
}
async function savedDraft(target, draft) {
  await target.waitForFunction(async (text) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("bcr-agent", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const archive = await new Promise((resolve) => {
      const request = db.transaction("sessions").objectStore("sessions").get("archive");
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return archive?.conversations.some((item) => item.draft === text);
  }, draft);
}
try {
  await page.goto(origin, { waitUntil: "networkidle" });
  let panel = await open(page);
  await panel.getByRole("button", { name: "接口", exact: true }).click();
  await panel.getByLabel("AI 接口地址").fill(endpoint);
  await panel.getByLabel("AI 模型名称").fill("test");
  await panel.getByLabel("AI 接口密钥").fill("test-memory-only-key");
  await panel.getByRole("button", { name: "保存到本次会话" }).click();
  await panel.getByRole("button", { name: "接口", exact: true }).click();
  let input = panel.getByRole("textbox", { name: "发送给 AI 助手的消息" });
  await input.fill("中文输入");
  await input.dispatchEvent("compositionstart");
  await input.press("Enter");
  assert.equal(requests.length, 0, "IME confirmation must not submit");
  await input.dispatchEvent("compositionend");
  await input.press("Shift+Enter");
  assert.match(await input.inputValue(), /\n/);
  await input.fill("slow");
  const first = await panel.getByLabel("切换对话").inputValue();
  await input.press("Enter");
  await panel.getByText("第 49 行", { exact: false }).waitFor();
  const viewport = panel.getByRole("region", { name: "对话记录" });
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await panel.getByRole("button", { name: "回到最新消息" }).waitFor();
  assert.ok(
    await viewport.evaluate((element) => element.scrollTop < 10),
    "streaming must respect reading position",
  );
  await panel.getByRole("button", { name: "回到最新消息" }).click();
  assert.ok(
    await viewport.evaluate(
      (element) => element.scrollHeight - element.scrollTop - element.clientHeight < 50,
    ),
  );
  await panel.getByRole("button", { name: "新建对话" }).click();
  const second = await panel.getByLabel("切换对话").inputValue();
  assert.notEqual(first, second);
  await input.fill("第二个对话的草稿");
  await panel.getByRole("button", { name: "查看任务" }).waitFor();
  await panel.getByRole("button", { name: "关闭 AI 助手" }).click();
  panel = await open(page);
  await panel.getByRole("button", { name: "查看任务" }).click();
  await panel.getByRole("button", { name: "发送", exact: true }).waitFor();
  assert.match(await panel.locator(".is-agent").innerText(), /流式完成/);
  await panel.getByLabel("切换对话").selectOption(second);
  assert.equal(await input.inputValue(), "第二个对话的草稿");
  assert.equal(await panel.locator(".bcr-chat-turn").count(), 0);
  await panel.getByRole("button", { name: "靠右停靠助手" }).click();
  const dock = await panel.boundingBox();
  assert.equal(dock.x + dock.width, 1440 - 12);
  await panel.getByRole("button", { name: "展开助手窗口" }).click();
  assert.equal(await input.inputValue(), "第二个对话的草稿");
  await savedDraft(page, "第二个对话的草稿");
  await page.reload({ waitUntil: "networkidle" });
  panel = await open(page);
  input = panel.getByRole("textbox", { name: "发送给 AI 助手的消息" });
  await panel.getByLabel("切换对话").selectOption(second);
  assert.equal(await input.inputValue(), "第二个对话的草稿");
  await panel.getByLabel("切换对话").selectOption(first);
  assert.match(await panel.locator(".is-agent").innerText(), /流式完成/);
  assert.equal(requests.length, 1, "restoring history must not replay tasks");
  await panel.getByRole("button", { name: "接口", exact: true }).click();
  assert.equal(
    await panel.getByLabel("AI 接口密钥").inputValue(),
    "",
    "credentials stay in memory only",
  );
  await panel.getByRole("button", { name: "接口", exact: true }).click();
  // Two tabs reading the same version: the second writer must surface a conflict.
  await savedDraft(page, "第二个对话的草稿");
  // Use an independent adapter (as another tab would) without acquiring the
  // unrelated workspace's exclusive SQLite/OPFS writer lock a second time.
  await input.fill("主页面的新草稿");
  await savedDraft(page, "主页面的新草稿");
  const conflict = await page.evaluate(
    async (path) => {
      const { createAgentStorage } = await import(path);
      const writer = createAgentStorage();
      const stale = createAgentStorage();
      const archive = await writer.load();
      const old = await stale.load();
      await writer.save(archive);
      try {
        await stale.save(old);
        return false;
      } catch {
        return true;
      }
    },
    `/@fs${new URL("../packages/react/src/agentStorage.ts", import.meta.url).pathname}`,
  );
  assert.equal(conflict, true, "stale storage adapters cannot overwrite newer archives");
  await savedDraft(page, "主页面的新草稿");
  for (const size of [
    { width: 375, height: 812 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForFunction(() => {
      const frame = document.querySelector(".assistant-window").getBoundingClientRect();
      return frame.x >= 0 && frame.right <= innerWidth && frame.bottom <= innerHeight;
    });
    const frame = await panel.boundingBox();
    const composer = await input.boundingBox();
    assert.ok(frame.x >= 0 && frame.x + frame.width <= size.width);
    assert.ok(
      composer.y >= frame.y && composer.y + composer.height <= frame.y + frame.height,
      "composer remains inside the window",
    );
  }
  assert.deepEqual(errors, []);
  await page.evaluate(
    async (path) => {
      const { mountResults } = await import(path);
      const container = document.createElement("div");
      container.id = "renderer-fixture";
      document.body.append(container);
      mountResults(container);
    },
    `/@fs${new URL("../packages/agent-ui/tests/results.fixture.tsx", import.meta.url).pathname}`,
  );
  const fixture = page.locator("#renderer-fixture");
  await fixture.getByText("预览不可用，完整结果仍保留在技术详情中。").first().waitFor();
  assert.equal(await fixture.getByText("预览不可用，完整结果仍保留在技术详情中。").count(), 2);
  assert.equal(await fixture.getByText("invalid payload rendered").count(), 0);
  for (const kind of ["broken", "invalid", "validator", "unknown"]) {
    const card = fixture.getByRole("region", { name: `工具 ${kind}`, exact: true });
    await card.getByText("技术详情", { exact: true }).click();
    assert.match(await card.locator("pre").innerText(), new RegExp(`retained-${kind}`));
  }
  assert.deepEqual(errors, []);
  console.log("Agent conversations verification PASSED", { requests: requests.length });
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
