import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startBridge } from "../src/server.ts";
import { verifyWorks } from "./works.mjs";
import { verifyLocalWorks } from "./local-works.mjs";
import {
  launchEphemeralBrowser,
  collectPageErrors,
  ensureShots,
} from "../../../scripts/lib/browser.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const config = {
  port: 0,
  origin,
  browserToken: randomBytes(32).toString("hex"),
  agentToken: randomBytes(32).toString("hex"),
};
const bridge = startBridge(config);
const directory = await mkdtemp(join(tmpdir(), "bcr-bridge-test-"));
const configPath = join(directory, "bridge.json");
await writeFile(
  configPath,
  JSON.stringify({ ...config, port: Number(new URL(bridge.endpoint).port) }),
  { mode: 0o600 },
);
const cli = async (...args) =>
  (
    await promisify(execFile)(
      "bun",
      ["apps/agent-bridge/src/cli.ts", ...args, "--config", configPath],
      { timeout: 30000 },
    )
  ).stdout.trim();
const headers = { Authorization: `Bearer ${config.agentToken}` };
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const page = await context.newPage(),
  errors = collectPageErrors(page),
  clients = [];
page.setDefaultTimeout(30000);
const panel = page.getByRole("dialog", { name: "外部 Agent", exact: true });
const openPanel = async (p) => {
  await p.locator(".ui-app-toolbar").first().waitFor();
  if (!(await p.getByRole("button", { name: "工作区选项", exact: true }).isVisible()))
    await p.keyboard.press("Alt+Backquote");
  await p.getByRole("button", { name: "工作区选项", exact: true }).click();
  await p.getByRole("button", { name: /^外部 Agent/u }).click();
};
const connect = async (write = false) => {
  await panel.getByLabel("Bridge 服务地址").fill(bridge.endpoint);
  await panel.getByLabel("Bridge 连接密钥").fill(config.browserToken);
  await panel.getByRole("checkbox", { name: /允许编辑与导入/u }).setChecked(write);
  await panel.getByRole("button", { name: "连接工作区", exact: true }).click();
  await panel
    .getByRole("status")
    .filter({ hasText: write ? "已连接 · 允许编辑" : "已连接 · 只读" })
    .waitFor();
};
const invoke = async (client, name, args = {}, expectError = false) => {
  const result = await client.callTool({ name, arguments: args }, { timeout: 120000 });
  if (expectError) assert(result.isError, JSON.stringify(result));
  else assert(!result.isError, JSON.stringify(result));
  return result.structuredContent ?? JSON.parse(result.content.find((c) => c.type === "text").text);
};
try {
  assert.equal(await cli("token", "browser"), config.browserToken);
  assert.equal(await cli("token", "agent"), config.agentToken);
  assert.equal((await fetch(`${bridge.endpoint}/mcp`)).status, 401);
  assert.equal(
    (
      await fetch(`${bridge.endpoint}/status`, {
        headers: { ...headers, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${bridge.endpoint}/status`, { headers: { ...headers, Host: "evil.example" } }))
      .status,
    403,
  );
  assert.equal(
    (
      await fetch(`${bridge.endpoint}/status`, {
        headers: { Authorization: `Bearer ${config.browserToken}` },
      })
    ).status,
    401,
  );
  await page.goto(`${origin}/works`);
  await page.getByRole("button", { name: "新建作品", exact: true }).waitFor();
  await openPanel(page);
  await connect();
  for (const mode of ["legacy", "auto"]) {
    const client = new Client(
      { name: `bcr-test-${mode}`, version: "1.0.0" },
      { versionNegotiation: { mode } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${bridge.endpoint}/mcp`), {
        requestInit: { headers },
      }),
    );
    clients.push(client);
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert(names.includes("work_read") && names.includes("knowledge_read_note"), names.join(","));
    assert(!names.includes("work_commit"));
    assert(!names.includes("diagram_list"), "unselected capabilities stay private");
    assert.equal((await invoke(client, "bcr_bridge_status")).write, false);
    await invoke(client, "work_list");
  }
  assert.equal(
    (
      await fetch(`${bridge.endpoint}/files?name=test.txt`, {
        method: "POST",
        headers,
        body: "no write",
      })
    ).status,
    403,
  );
  const client = clients[1];
  console.log("PASS: legacy and modern MCP clients, read-only grants and HTTP authentication");
  await panel.getByRole("button", { name: "断开连接" }).click();
  await panel.getByRole("status").filter({ hasText: "已断开连接" }).waitFor();
  await connect(true);
  const writeTools = (await client.listTools()).tools.map((t) => t.name);
  assert(writeTools.includes("work_commit"));
  const invalid = await client.callTool({ name: "work_commit", arguments: { title: 123 } });
  assert(invalid.isError, "MCP validates the published JSON Schema before dispatch");
  const args = {
    requestId: "mcp-create-work",
    revision: null,
    title: "外部 Agent 作品",
    entry: "index.html",
    put: [{ path: "index.html", text: "<h1>通过工作区文件创作</h1>" }],
  };
  const created = await invoke(client, "work_commit", args);
  assert.deepEqual(
    await invoke(clients[0], "work_commit", args),
    created,
    "retry across clients is idempotent",
  );
  console.log("PASS: work creation and retry across independent MCP clients");
  await page.getByRole("button", { name: "关闭外部 Agent 面板" }).click();
  await page.goto(`${origin}/works?work=${created.id}`);
  // Navigation reload revokes the browser session; reconnect explicitly to the same stored workspace.
  await openPanel(page);
  await connect(true);
  await panel.getByRole("button", { name: "关闭外部 Agent 面板" }).click();
  const data = join(directory, "data.csv");
  const csv = "title,value\nExample,10.50\n";
  await writeFile(data, csv);
  const { artifact } = JSON.parse(await cli("upload", data));
  const updated = await invoke(client, "work_commit", {
    id: created.id,
    revision: created.revision,
    requestId: "mcp-file-import",
    put: [{ path: "data.csv", artifact }],
  });
  const imported = await invoke(client, "work_read", {
    id: created.id,
    revision: updated.revision,
    path: "data.csv",
  });
  assert.deepEqual(imported.artifact, artifact);
  const sourceFile = await invoke(client, "bcr_bridge_download", { artifact: imported.artifact });
  assert.equal(await (await fetch(sourceFile.url, { headers })).text(), csv);
  const exported = await invoke(client, "work_export", {
    id: created.id,
    revision: updated.revision,
    format: "archive",
  });
  const file = await invoke(client, "bcr_bridge_download", { artifact: exported.artifact });
  assert.equal((await fetch(file.url)).status, 401);
  const downloaded = await fetch(file.url, { headers });
  assert(downloaded.ok, await downloaded.clone().text());
  const bytes = new Uint8Array(await downloaded.arrayBuffer());
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes.length, exported.artifact.size);
  const output = join(directory, "work.zip");
  await cli("download", file.url, "--out", output);
  assert.deepEqual(new Uint8Array(await readFile(output)), bytes);
  await assert.rejects(cli("download", file.url, "--out", output), /EEXIST/u);
  assert.deepEqual(new Uint8Array(await readFile(output)), bytes, "existing files are preserved");
  const note = await invoke(client, "knowledge_create_note", {
    requestId: "mcp-note",
    title: "外部助手笔记",
    body: "通过同一个工作区保存。",
  });
  assert.equal(note.status, "saved");
  await openPanel(page);
  await page.screenshot({ path: `${ensureShots()}/external-agent-bridge.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: `${ensureShots()}/external-agent-bridge-mobile.png` });
  await panel.getByRole("button", { name: "断开连接" }).click();
  assert.equal((await invoke(client, "bcr_bridge_status")).connected, false);
  assert.equal((await fetch(file.url, { headers })).status, 409);
  for (const checkbox of await panel.locator(".external-agent-grants input").all())
    await checkbox.setChecked(true);
  await connect(true);
  const allTools = (await client.listTools()).tools.map((t) => t.name);
  assert(
    allTools.includes("diagram_list") && allTools.includes("workspace_search"),
    allTools.join(","),
  );
  await invoke(client, "diagram_list");
  await panel.getByRole("button", { name: "断开连接" }).click();
  for (const checkbox of await panel.locator(".external-agent-grants input").all())
    await checkbox.setChecked((await checkbox.locator("..").textContent()).includes("作品与文件"));
  await connect(true);
  assert(!(await client.listTools()).tools.some((t) => t.name === "knowledge_read_note"));
  await panel.getByRole("button", { name: "关闭外部 Agent 面板" }).click();
  await verifyWorks({ client, invoke, page, browser, cli, directory, origin, openPanel, connect });
  await verifyLocalWorks({ client, invoke, page, directory, origin, openPanel });
  await panel.getByRole("button", { name: "断开连接" }).click();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: authenticated MCP legacy/modern clients, scoped read/write, request replay, dirty drafts, revisions, work previews and edits, binary import/export, knowledge writes, disconnect revocation and mobile layout",
  );
} catch (error) {
  await page.screenshot({ path: `${ensureShots()}/external-agent-failure.png` }).catch(() => {});
  console.error(error);
  console.error("Browser diagnostics", {
    url: page.url(),
    errors,
    text: (await page.locator("body").innerText()).slice(-4000),
  });
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map((c) => c.close()));
  await browser.close();
  await bridge.close();
  await rm(directory, { recursive: true, force: true });
}
