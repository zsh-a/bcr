#!/usr/bin/env bun
import { existsSync, createWriteStream, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Job, Project } from "@bcr/work-core";
import { json } from "./projects";
import { RunnerClient } from "./client";
import { defaultConfig, readConnection, serve, start, serviceOptions } from "./lifecycle";
import { dependencyDirectory, installation, release, workerEntry } from "./installation";

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    config: { type: "string" },
    host: { type: "string" },
    "api-url": { type: "string" },
    "preview-url": { type: "string" },
    "preview-port": { type: "string" },
    "install-browser": { type: "boolean" },
    version: { type: "boolean" },
    root: { type: "string" },
    state: { type: "string" },
    origin: { type: "string" },
    port: { type: "string" },
    url: { type: "string" },
    token: { type: "string" },
    target: { type: "string" },
    revision: { type: "string" },
    frames: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    scale: { type: "string" },
    input: { type: "string" },
    output: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean" },
  },
});
const configPath = resolve(values.config ?? defaultConfig());
const print = (value: unknown) =>
  process.stdout.write(`${JSON.stringify(value, null, values.json ? undefined : 2)}\n`);
try {
  const [command = "help", id] = positionals;
  if (command === "version" || values.version) print(release());
  else if (command === "init") {
    if (!id) throw new Error("指定新工程目录，例如 bcr-runner init ./gym-card");
    const destination = resolve(id);
    if (existsSync(destination)) throw new Error("工程目录已存在");
    cpSync(join(installation, "example"), destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    print({ directory: destination });
  } else if (command === "help" || values.help) {
    process.stdout.write(
      `BCR Works Runner\n\n  bcr-runner init ./gym-card\n  bcr-runner start --root ./projects --origin https://bcr.example.com\n  bcr-runner status|stop|doctor|version\n  bcr-runner doctor --install-browser\n  bcr-runner mcp [--config /path/to/connection.json]\n  bcr-runner serve --root ./projects --origin http://localhost:5199\n  bcr-runner token\n  bcr-runner list --json\n  bcr-runner inspect <work-id> --json\n  bcr-runner preview|validate|capture|render|archive <work-id> --target <target-id> [--frames 0,30] [--from 0 --to 89 --scale 0.5]\n  bcr-runner jobs [work-id]\n  bcr-runner job|cancel|preview-url <job-id>\n  bcr-runner reviews <work-id>\n  bcr-runner rpc <operation> --input ./request.json\n  bcr-runner download <job-id> <file-name> --output ./video.mp4\n\nLong operations return a durable job ID. Use job to poll; cancel explicitly.\nConnections default to the last local Runner. Override with --url and --token.\n`,
    );
  } else if (command === "serve" || command === "start") {
    const options = serviceOptions(values, readConnection(configPath));
    print(await (command === "serve" ? serve(configPath, options) : start(configPath, options)));
  } else if (command === "doctor") {
    const version = release();
    const dependencies = Object.entries(version.dependencies).map(([name, expected]) => {
      try {
        const path = dependencyDirectory(name);
        const actual = (json(join(path, "package.json")) as { version: string }).version;
        return { name, expected, actual, ok: actual === expected };
      } catch (error) {
        return { name, expected, ok: false, error: String(error) };
      }
    });
    const checks: Record<string, unknown> = {
      installation,
      worker: existsSync(workerEntry),
      bun: Bun.version,
      supportedPlatform: ["linux", "darwin"].includes(process.platform),
      release: version,
      dependencies,
      config: configPath,
    };
    if (values["install-browser"])
      checks.browser = await (await import("./browser")).prepareBrowser();
    const saved = readConnection(configPath);
    if (saved) {
      try {
        checks.service = await new RunnerClient(saved).catalog();
      } catch (error) {
        checks.service = { running: false, error: String(error) };
      }
    } else checks.service = { running: false };
    if (!checks.worker || !checks.supportedPlatform || dependencies.some((d) => !d.ok))
      process.exitCode = 1;
    print(checks);
  } else {
    const saved = readConnection(configPath);
    const url = values.url ?? saved?.url,
      token = values.token ?? saved?.token;
    if (command === "status" && (!url || !token)) {
      print({ running: false });
      process.exit(0);
    }
    if (!url || !token) throw new Error("请先启动 Runner，或提供 --url 与 --token");
    if (command === "token") process.stdout.write(`${token}\n`);
    else {
      const client = new RunnerClient({ url, token });
      const rpc = <T>(op: string, input: unknown = {}) => client.call<T>(op, input);
      if (command === "mcp") await (await import("./mcp")).startMcp(client);
      else if (command === "status") {
        try {
          print({ running: true, url, ...(await client.catalog()) });
        } catch (error) {
          print({ running: false, url, error: String(error) });
        }
      } else if (command === "stop") {
        await client.request("/shutdown", { method: "POST" });
        const deadline = Date.now() + 10000;
        let stopped = false;
        while (Date.now() < deadline) {
          try {
            await client.request("/health", { signal: AbortSignal.timeout(500) });
          } catch {
            stopped = true;
            break;
          }
          await Bun.sleep(100);
        }
        if (!stopped) throw new Error("停止超时；请检查服务日志");
        print({ running: false, url });
      } else if (command === "download") {
        const name = positionals[2];
        if (!id || !name || !values.output) throw new Error("需要 job-id、文件名和 --output");
        const response = await client.output(id, name);
        if (!response.body) throw new Error("产物为空");
        await pipeline(
          Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream),
          createWriteStream(values.output, { flags: "wx", mode: 0o600 }),
        );
        print({ output: values.output });
      } else if (["preview", "validate", "capture", "render", "archive"].includes(command)) {
        const project = await rpc<Project>("read", {
          id,
          ...(values.revision ? { revision: values.revision } : {}),
        });
        const target = values.target ?? project.targets[0]!.id;
        print(
          await rpc<Job>("render", {
            id,
            target,
            revision: project.revision,
            requestId: crypto.randomUUID(),
            kind: command === "render" ? "video" : command,
            ...(values.frames ? { frames: values.frames.split(",").map(Number) } : {}),
            ...(values.from ? { from: Number(values.from) } : {}),
            ...(values.to ? { to: Number(values.to) } : {}),
            ...(values.scale ? { scale: Number(values.scale) } : {}),
          }),
        );
      } else if (command === "rpc")
        print(await rpc(id!, values.input ? json(resolve(values.input)) : {}));
      else {
        const operation = {
          catalog: "catalog",
          list: "list",
          inspect: "read",
          jobs: "jobs",
          job: "job",
          cancel: "cancel",
          reviews: "reviews",
          "preview-url": "preview",
        }[command];
        if (!operation) throw new Error(`未知命令：${command}`);
        print(await rpc(operation, id ? { id } : {}));
      }
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
