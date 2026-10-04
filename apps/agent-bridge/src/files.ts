import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { file } from "bun";
import { BridgeError, MAX_FILE_BYTES, record } from "@bcr/agent/bridge";
import type { BridgeBroker } from "./broker";

type Transfer = {
  id: string;
  connection: string;
  path: string;
  kind: "import" | "export";
  name: string;
  mime: string;
  size: number;
  ready: boolean;
  writing: boolean;
  expires: number;
};
/** Short-lived disk spools keep binary data out of MCP messages and cap memory usage. */
export class BridgeFiles {
  private transfers = new Map<string, Transfer>();
  private directory = mkdtemp(join(tmpdir(), "bcr-bridge-"));
  constructor(private readonly broker: BridgeBroker) {}
  private async create(kind: Transfer["kind"], name: string, mime: string) {
    await this.prune();
    const directory = await this.directory;
    if (this.transfers.size >= 4) throw new BridgeError("BUSY", "文件传输数量达到上限，请稍后重试");
    if (
      !name ||
      name.length > 500 ||
      /[\r\n]/u.test(name) ||
      name.includes(String.fromCharCode(0)) ||
      mime.length > 120 ||
      /[\r\n]/u.test(mime)
    )
      throw new BridgeError("INVALID_FILE", "文件名或类型无效");
    const id = randomUUID(),
      connection = this.broker.requireConnection();
    const transfer: Transfer = {
      id,
      connection,
      path: join(directory, id),
      kind,
      name,
      mime,
      size: 0,
      ready: false,
      writing: false,
      expires: Date.now() + 600_000,
    };
    this.transfers.set(id, transfer);
    return transfer;
  }
  private get(id: string) {
    const item = this.transfers.get(id);
    if (!item || item.expires < Date.now() || item.connection !== this.broker.requireConnection())
      throw new BridgeError("FILE_EXPIRED", "文件传输已过期，请重新导出");
    return item;
  }
  private async write(item: Transfer, request: Request) {
    if (item.ready || item.writing || !request.body)
      throw new BridgeError("INVALID_TRANSFER", "文件传输状态无效");
    item.writing = true;
    let size = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        done(size > MAX_FILE_BYTES ? new Error("文件超过 300 MiB 上限") : null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(request.body as unknown as import("node:stream/web").ReadableStream),
        limiter,
        createWriteStream(item.path, { flags: "wx", mode: 0o600 }),
        { signal: request.signal },
      );
      this.get(item.id);
      item.size = (await stat(item.path)).size;
      item.ready = true;
    } catch (error) {
      await this.remove(item.id);
      throw error;
    } finally {
      item.writing = false;
    }
  }
  async upload(request: Request, name: string) {
    if (!this.broker.catalog?.files || !this.broker.catalog.write)
      throw new BridgeError("FORBIDDEN", "文件导入未授权");
    const item = await this.create(
      "import",
      name,
      request.headers.get("content-type") ?? "application/octet-stream",
    );
    try {
      await this.write(item, request);
      return await this.broker.invoke(
        { kind: "file.import", transfer: item.id, name, mime: item.mime },
        request.signal,
      );
    } finally {
      await this.remove(item.id);
    }
  }
  async export(artifact: unknown, signal?: AbortSignal) {
    if (!this.broker.catalog?.files) throw new BridgeError("FORBIDDEN", "文件访问未授权");
    const value = record(artifact);
    if (typeof value.name !== "string" || typeof value.mime !== "string")
      throw new BridgeError("INVALID_FILE", "请使用导出工具返回的 artifact");
    const item = await this.create("export", value.name, value.mime);
    try {
      await this.broker.invoke({ kind: "file.export", transfer: item.id, artifact }, signal);
      if (!item.ready) throw new BridgeError("INVALID_TRANSFER", "文件尚未接收完成");
      return {
        id: item.id,
        name: item.name,
        mime: item.mime,
        size: item.size,
        expiresAt: item.expires,
      };
    } catch (error) {
      await this.remove(item.id);
      throw error;
    }
  }
  async transfer(id: string, request: Request) {
    const item = this.get(id);
    if (request.method === "POST" && item.kind === "export") {
      await this.write(item, request);
      return new Response(null, { status: 204 });
    }
    if (request.method === "GET" && item.kind === "import" && item.ready)
      return new Response(file(item.path), {
        headers: { "Content-Type": item.mime, "Content-Length": String(item.size) },
      });
    return new Response("Invalid transfer", { status: 409 });
  }
  download(id: string) {
    const item = this.get(id);
    if (item.kind !== "export" || !item.ready || !this.broker.catalog?.files)
      throw new BridgeError("FORBIDDEN", "文件尚未就绪或访问已撤销");
    return new Response(file(item.path), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(item.size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  private async remove(id: string) {
    const item = this.transfers.get(id);
    if (item) {
      this.transfers.delete(id);
      await rm(item.path, { force: true });
    }
  }
  async prune(all = false) {
    await Promise.all(
      [...this.transfers.values()]
        .filter((t) => all || t.expires < Date.now() || t.connection !== this.broker.connection)
        .map((t) => this.remove(t.id)),
    );
  }
  async close() {
    await this.prune(true);
    await rm(await this.directory, { recursive: true, force: true });
  }
}
