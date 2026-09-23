import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
if (process.env.BCR_AGENT_LIVE !== "1")
  throw new Error("Set BCR_AGENT_LIVE=1 to opt in to real local model requests.");
const dir = await mkdtemp(join(tmpdir(), "bcr-agent-live-"));
const appUrl = process.env.BCR_APP_URL ?? "http://127.0.0.1:5201";
const endpoint = appUrl + "/api/llm/v1";
const model = process.env.BCR_AGENT_MODEL ?? "mimo-v2.6-pro";
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const report = {
  endpoint,
  transport: "Studio same-origin proxy; live model",
  model,
  tests: [],
  requests: [],
  errors: [],
};
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => report.errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") report.errors.push(m.text());
});
page.on("request", (r) => {
  if (r.url() === endpoint + "/chat/completions" && r.method() === "POST") {
    const data = r.postDataJSON();
    report.requests.push({
      model: data.model,
      stream: data.stream,
      tools: data.tools?.map((t) => t.function.name) ?? [],
      messages: data.messages,
    });
  }
});
page.on("response", (r) => {
  if (r.url() === endpoint + "/chat/completions") console.log("HTTP", r.status());
});
async function check(name, action) {
  if (process.env.TEST_FILTER && !new RegExp(process.env.TEST_FILTER).test(name)) return;
  const started = Date.now();
  console.log("START", name);
  try {
    const detail = await action();
    report.tests.push({ name, status: "passed", ms: Date.now() - started, detail });
    console.log("PASS", name, JSON.stringify(detail));
  } catch (e) {
    report.tests.push({ name, status: "failed", ms: Date.now() - started, error: String(e) });
    console.log("FAIL", name, String(e));
    throw e;
  }
}
try {
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "AI 助手", exact: true });
  await panel.getByRole("button", { name: "接口", exact: true }).click();
  await panel.getByLabel("AI 接口地址").fill("/api/llm/v1");
  await panel.getByLabel("AI 模型名称").fill(model);
  await panel.getByRole("button", { name: "保存连接", exact: true }).click();
  await panel.getByRole("button", { name: "← 返回对话", exact: true }).click();
  const input = panel.getByPlaceholder("提问、整理思路，或请我处理当前内容…");
  const approval = panel.getByRole("group", { name: "待确认的操作" });
  async function send(prompt) {
    const before = await panel.locator(".is-agent").count();
    await input.fill(prompt);
    await input.press("Enter");
    await page.waitForFunction((n) => document.querySelectorAll(".is-agent").length > n, before);
  }
  async function finish() {
    await page.waitForFunction(() => {
      const stop = [...document.querySelectorAll(".bcr-chat-composer button")].find(
        (b) => b.textContent === "停止",
      );
      return !stop || stop.disabled;
    });
    return (await panel.locator(".is-agent").last().innerText()).trim();
  }
  await check("browser streaming conversation", async () => {
    await send("请记住本轮测试口令 BLUE-742。只回复 LIVE_AGENT_OK，不要调用工具。");
    const text = await finish();
    assert.match(text, /LIVE_AGENT_OK/);
    assert.equal(report.requests.at(-1).model, model);
    assert.equal(report.requests.at(-1).stream, true);
    return text;
  });
  await check("multi-turn context", async () => {
    await send("刚才让你记住的测试口令是什么？只输出口令，不要调用工具。");
    const text = await finish();
    assert.match(text, /BLUE-742/);
    return text;
  });
  await panel.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
  await page.getByRole("button", { name: /个人知识库/ }).click();
  await page.getByRole("button", { name: "写第一篇笔记" }).click();
  const title = "MIMO实测-" + Date.now();
  const original = "本次虚构项目代号是琥珀灯塔，验收编号是 AMBER-59317。此笔记只用于自动化测试。";
  await page.getByLabel("笔记标题").fill(title);
  const editor = page.locator(".cm-content");
  await editor.fill(original);
  await page.waitForFunction(() =>
    document
      .querySelector('.knowledge-editor [role="status"]')
      ?.textContent?.includes("已保存到本机"),
  );
  await page.keyboard.press("Alt+Digit1");
  await page.waitForURL(/\/studio(?:\?|$)/);
  await page.keyboard.press("Control+j");
  await panel.waitFor();
  await check("cross-domain search and read real persisted note", async () => {
    const start = report.requests.length;
    await send(
      `调用 knowledge_find_notes 查找标题为“${title}”的笔记，然后必须调用 knowledge_read_note 读取该笔记正文。告诉我其中的项目代号和验收编号，附笔记链接。不要猜测。`,
    );
    const text = await finish();
    assert.match(text, /AMBER-59317/);
    assert.match(text, /琥珀灯塔/);
    const messages = report.requests.slice(start).flatMap((r) => r.messages);
    const names = messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.tool_calls ?? [])
      .map((t) => t.function.name);
    assert.ok(names.includes("knowledge_find_notes"));
    assert.ok(names.includes("knowledge_read_note"));
    assert.ok(!report.requests.slice(start).some((r) => r.tools.includes("apply_text_edit")));
    return { text, tools: [...new Set(names)] };
  });
  await panel.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
  await page.getByRole("button", { name: "打开命令面板", exact: true }).click();
  await page.getByPlaceholder("输入命令…").fill("个人知识库");
  await page.getByRole("button", { name: /^打开 个人知识库/ }).click();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+j");
  await check("edit approval and durable persistence", async () => {
    await send(
      "请调用 apply_text_edit，在当前光标处插入且只插入：\nLIVE_EDIT_826\n。调用一次即可，等待我批准。",
    );
    await approval.waitFor();
    assert.equal(await editor.textContent(), original, "no writes before approval");
    assert.match(await approval.innerText(), /LIVE_EDIT_826/);
    await approval.getByRole("button", { name: "应用修改" }).click();
    const text = await finish();
    await page.waitForFunction(() =>
      document
        .querySelector('.knowledge-editor [role="status"]')
        ?.textContent?.includes("已保存到本机"),
    );
    assert.match(await editor.textContent(), /LIVE_EDIT_826/);
    return { text, body: await editor.textContent() };
  });
  const saved = await editor.textContent();
  await check("refused edit never writes", async () => {
    await send(
      "请调用 apply_text_edit 在当前光标处插入 DENIED_EDIT_934。只调用一次；如果我拒绝，不要重试。",
    );
    await approval.waitFor();
    assert.equal(await editor.textContent(), saved);
    await approval.getByRole("button", { name: "放弃", exact: true }).click();
    const text = await finish();
    assert.equal(await editor.textContent(), saved);
    return text;
  });
  await check("workspace switch invalidates pending edit", async () => {
    await send(
      "请调用 apply_text_edit 在当前光标处插入 STALE_EDIT_271。只调用一次，如果失败请停止不要重试。",
    );
    await approval.waitFor();
    await page.keyboard.press("Alt+Digit1");
    await page.waitForURL(/\/studio(?:\?|$)/);
    await approval.getByRole("button", { name: "应用修改" }).click();
    const text = await finish();
    assert.equal(await editor.textContent(), saved);
    assert.match(await panel.locator(".bcr-chat-activity").last().innerText(), /已取消/);
    return text;
  });
  await check("disabled capability omitted from actual model request", async () => {
    await panel.locator(".bcr-chat-capabilities summary").click();
    await panel.getByRole("checkbox", { name: "启用知识库", exact: true }).uncheck();
    await panel.locator(".bcr-chat-capabilities summary").click();
    const start = report.requests.length;
    await send("只回复 CAPABILITY_OFF_OK，不调用工具。");
    const text = await finish();
    assert.match(text, /CAPABILITY_OFF_OK/);
    assert.ok(
      report.requests.slice(start).every((r) => !r.tools.some((n) => n.startsWith("knowledge_"))),
    );
    return text;
  });
  await check("cancel generation and recover conversation", async () => {
    await send("请生成一篇至少一万字的虚构海洋探险故事，从第一章开始详细写，不要调用工具。");
    await panel.getByRole("button", { name: "停止", exact: true }).waitFor();
    await panel.getByRole("button", { name: "停止", exact: true }).click();
    await finish();
    await send("已取消长文，现在只回复 CANCEL_RECOVERED，不调用工具。");
    const text = await finish();
    assert.match(text, /CANCEL_RECOVERED/);
    return text;
  });
  await page.screenshot({ path: dir + "/assistant.png" });
  await check("reload preserves approved content", async () => {
    await page.goto(appUrl + "/knowledge", { waitUntil: "networkidle" });
    await editor.waitFor();
    assert.equal(await editor.textContent(), saved);
    return await editor.textContent();
  });
} catch (e) {
  report.failure = String(e);
  console.log("BODY", (await page.locator("body").innerText()).slice(-5000));
  await page.screenshot({ path: dir + "/failure.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(
    dir + "/" + (process.env.REPORT_NAME ?? "report") + ".json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(
    "REPORT",
    dir + "/report.json",
    "REQUESTS",
    report.requests.length,
    "ERRORS",
    JSON.stringify(report.errors),
  );
}
