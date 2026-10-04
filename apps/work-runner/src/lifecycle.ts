import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { atomic, hash, json } from "./projects";
import { RunnerClient, type Connection } from "./client";
import { cliEntry } from "./installation";
import { startRunner, type RunnerConfig } from "./server";

export const defaultConfig = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "bcr", "work-runner.json");
export type ServiceOptions = Omit<RunnerConfig, "token" | "onShutdown">;
export type SavedConnection = Connection & {
  instanceId?: string;
  pid?: number;
  options?: ServiceOptions;
  log?: string;
};
export function readConnection(path: string): SavedConnection | undefined {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new Error("Runner 配置必须为权限 600 的普通文件");
  return json(path) as SavedConnection;
}
function lease(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    const record = JSON.parse(readFileSync(path, "utf8")) as
      | number
      | { pid: number; birth: string };
    const pid = typeof record === "number" ? record : record.pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`无效的 Runner 锁：${path}`);
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
    }
    if (alive && typeof record !== "number") {
      const birth = processBirth(pid);
      // Container restarts and PID reuse must not turn a dead owner's lease into a live one.
      if (birth && birth !== record.birth) alive = false;
    }
    if (alive) throw new Error(`Runner 已在运行或正在启动：${path}`);
    unlinkSync(path);
  }
  const fd = openSync(path, "wx", 0o600);
  const owner = JSON.stringify({ pid: process.pid, birth: processBirth(process.pid) });
  writeFileSync(fd, owner);
  closeSync(fd);
  return () => {
    if (existsSync(path) && readFileSync(path, "utf8") === owner) unlinkSync(path);
  };
}
function processBirth(pid: number) {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[19]}`;
    }
    return execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}
export function serviceOptions(
  values: Record<string, string | boolean | undefined>,
  saved?: SavedConnection,
): ServiceOptions {
  const rootValue = values.root ?? saved?.options?.root;
  if (typeof rootValue !== "string") throw new Error("请通过 --root 显式选择工程目录");
  const root = resolve(rootValue);
  const state = resolve(
    String(
      values.state ??
        (saved?.options?.root === root ? saved.options.state : undefined) ??
        join(
          process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"),
          "bcr/work-runner",
          hash(root).slice(0, 16),
        ),
    ),
  );
  return {
    ...saved?.options,
    root,
    state,
    origin: String(values.origin ?? saved?.options?.origin ?? "http://localhost:5199"),
    ...(values.port !== undefined ? { port: Number(values.port) } : {}),
    ...(values.host ? { host: String(values.host) } : {}),
    ...(values["preview-port"] !== undefined
      ? { previewPort: Number(values["preview-port"]) }
      : {}),
    ...(values["api-url"] ? { apiUrl: String(values["api-url"]) } : {}),
    ...(values["preview-url"] ? { previewUrl: String(values["preview-url"]) } : {}),
  };
}
export async function serve(configPath: string, options: ServiceOptions) {
  const unlockConfig = lease(`${configPath}.lock`);
  let unlockState: (() => void) | undefined;
  try {
    unlockState = lease(join(options.state, "runner.lock"));
    const tokenPath = join(options.state, "token");
    const token = existsSync(tokenPath)
      ? readFileSync(tokenPath, "utf8")
      : randomBytes(32).toString("hex");
    atomic(tokenPath, token);
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void runner.close().then(() => process.exit(0));
    };
    const runner = startRunner({ ...options, token, onShutdown: stop });
    const connection: SavedConnection = {
      url: runner.url,
      token,
      instanceId: runner.service.instanceId,
      pid: process.pid,
      options,
      log: join(options.state, "runner.log"),
    };
    try {
      atomic(configPath, JSON.stringify(connection));
    } catch (error) {
      await runner.close();
      throw error;
    }
    process.on("exit", () => {
      unlockState?.();
      unlockConfig();
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);
    return {
      url: runner.url,
      ...runner.service.catalog(),
      state: options.state,
      config: configPath,
    };
  } catch (error) {
    unlockState?.();
    unlockConfig();
    throw error;
  }
}
export async function start(configPath: string, options: ServiceOptions) {
  const unlock = lease(`${configPath}.starting`);
  try {
    const saved = readConnection(configPath);
    if (saved) {
      let catalog;
      try {
        catalog = await new RunnerClient(saved).catalog();
      } catch {
        /* A stopped service may retain its configuration. */
      }
      if (catalog) {
        if (JSON.stringify(saved.options) !== JSON.stringify(options))
          throw new Error("Runner 正在运行；请先 stop，再修改启动配置");
        return { running: true, url: saved.url, ...catalog };
      }
    }
    mkdirSync(options.state, { recursive: true, mode: 0o700 });
    const log = join(options.state, "runner.log"),
      fd = openSync(log, "a", 0o600);
    const args = [
      cliEntry,
      "serve",
      "--config",
      configPath,
      "--root",
      options.root,
      "--state",
      options.state,
      "--origin",
      options.origin,
    ];
    for (const [flag, value] of Object.entries({
      port: options.port,
      host: options.host,
      "preview-port": options.previewPort,
      "api-url": options.apiUrl,
      "preview-url": options.previewUrl,
    }))
      if (value !== undefined) args.push(`--${flag}`, String(value));
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ["ignore", fd, fd],
      cwd: options.state,
    });
    closeSync(fd);
    let failed: string | undefined;
    child.on("error", (error) => {
      failed = error.message;
    });
    child.unref();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (failed || child.exitCode !== null)
        throw new Error(`Runner 启动失败：${failed ?? child.exitCode}；查看 ${log}`);
      const current = readConnection(configPath);
      if (current && current.pid === child.pid && current.instanceId) {
        // The listener is local even when advertised URLs point at a reverse proxy.
        const port = options.port ?? 5210;
        const connection =
          options.apiUrl && port ? { ...current, url: `http://127.0.0.1:${port}` } : current;
        try {
          const catalog = await new RunnerClient(connection).catalog();
          if (catalog.instanceId === current.instanceId)
            return { running: true, url: current.url, ...catalog, log, config: configPath };
        } catch {
          /* Retry until ready. */
        }
      }
      await Bun.sleep(100);
    }
    child.kill("SIGTERM");
    throw new Error(`Runner 启动超时；查看 ${log}`);
  } finally {
    unlock();
  }
}
