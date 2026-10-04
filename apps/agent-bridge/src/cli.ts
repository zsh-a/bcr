import { readFile, mkdir, writeFile, chmod, lstat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, basename } from "node:path";
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { file } from "bun";
import { startBridge, type BridgeConfig } from "./server";

const print = (value: string) => process.stdout.write(`${value}\n`);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    port: { type: "string" },
    origin: { type: "string" },
    out: { type: "string" },
    help: { type: "boolean" },
  },
});
const command = positionals[0] ?? "start";
const configPath =
  values.config ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "bcr", "bridge.json");
if (values.help) {
  print(
    "BCR Bridge\n  bun run bridge [start] [--origin http://localhost:5199] [--port 5209]\n  bun run bridge token browser|agent\n  bun run bridge upload ./prices.csv\n  bun run bridge download <download-url> --out ./publication.zip\nAll commands accept --config <path>. Downloads never overwrite an existing file.",
  );
} else {
  let config: BridgeConfig;
  try {
    const metadata = await lstat(configPath);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error("Bridge 配置必须是普通文件");
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
      throw new Error("Bridge 配置包含连接凭据，请将权限设置为 600");
    config = JSON.parse(await readFile(configPath, "utf8")) as BridgeConfig;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT" || command !== "start") throw error;
    config = {
      port: 5209,
      origin: "http://localhost:5199",
      browserToken: randomBytes(32).toString("hex"),
      agentToken: randomBytes(32).toString("hex"),
    };
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  }
  if (values.port !== undefined) config.port = Number(values.port);
  if (values.origin !== undefined) config.origin = values.origin;
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535)
    throw new Error("端口必须在 1024–65535 之间");
  const endpoint = `http://127.0.0.1:${config.port}`;
  if (command === "start") {
    // Persist explicit port/origin choices so file commands use the same endpoint.
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    await chmod(configPath, 0o600);
    const bridge = startBridge(config);
    print(
      `BCR MCP: ${bridge.endpoint}/mcp\n浏览器来源: ${config.origin}\n凭据文件: ${configPath}\n在 BCR「工作区选项 → 外部 Agent」连接。用 token browser / token agent 分别读取密钥。`,
    );
    const stop = () => {
      void bridge.close().then(() => process.exit(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } else if (command === "token") {
    if (!["browser", "agent"].includes(positionals[1] ?? ""))
      throw new Error("指定 token browser 或 token agent");
    print(positionals[1] === "browser" ? config.browserToken : config.agentToken);
  } else if (command === "upload") {
    const path = positionals[1];
    if (!path) throw new Error("指定待上传的文件");
    const source = file(path);
    const response = await fetch(`${endpoint}/files?name=${encodeURIComponent(basename(path))}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.agentToken}`, "Content-Type": source.type },
      body: source,
    });
    if (!response.ok) throw new Error(await response.text());
    print(await response.text());
  } else if (command === "download") {
    const url = new URL(positionals[1] ?? "");
    if (
      url.origin !== endpoint ||
      !/^\/files\/[a-f0-9-]{36}$/u.test(url.pathname) ||
      url.search ||
      url.hash ||
      !values.out
    )
      throw new Error("使用本机 Bridge 返回的下载地址，并指定 --out");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.agentToken}` },
      redirect: "error",
    });
    if (!response.ok || !response.body) throw new Error(await response.text());
    await pipeline(
      Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream),
      createWriteStream(values.out, { flags: "wx", mode: 0o600 }),
    );
    print(`已保存 ${values.out}`);
  } else throw new Error(`未知命令: ${command}`);
}
