import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  BridgeError,
  BRIDGE_VERSION,
  MAX_MESSAGE_BYTES,
  decodeCatalog,
  parseMessage,
  type BridgeCatalog,
  type BridgeOperation,
} from "@bcr/agent/bridge";

export interface BrowserPeer {
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
}
export function sameToken(value: string | null, token: string): boolean {
  if (!value || value.length !== token.length) return false;
  const a = Buffer.from(value),
    b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

/** Transport bookkeeping only. Domain data and authorization remain in the browser. */
export class BridgeBroker {
  private peer: BrowserPeer | undefined;
  private pinnedWorkspace: string | undefined;
  private pending = new Map<string, Pending>();
  private lastSeen = 0;
  connection = "";
  catalog: BridgeCatalog | undefined;
  onDisconnect: (() => void) | undefined;
  onCatalog: (() => void) | undefined;
  constructor(
    private readonly token: string,
    private readonly timeout = 180_000,
  ) {}
  get connected() {
    return !!this.peer;
  }
  owns(peer: BrowserPeer) {
    return this.peer === peer;
  }
  private send(peer: BrowserPeer, data: string) {
    try {
      peer.send(data);
    } catch {
      this.detach(peer);
      peer.close(1011, "Transport failed");
    }
  }
  receive(peer: BrowserPeer, raw: string) {
    try {
      const message = parseMessage(raw);
      if (peer !== this.peer) {
        if (
          message.type !== "hello" ||
          message.version !== BRIDGE_VERSION ||
          !sameToken(typeof message.token === "string" ? message.token : null, this.token)
        )
          throw new BridgeError("UNAUTHORIZED", "连接密钥无效");
        if (this.peer) throw new BridgeError("WORKSPACE_BUSY", "已有工作区连接，请先在原窗口断开");
        const catalog = decodeCatalog(message.catalog);
        if (this.pinnedWorkspace && catalog.workspace !== this.pinnedWorkspace)
          throw new BridgeError(
            "WORKSPACE_MISMATCH",
            "此服务已绑定其他工作区；切换工作区请重启服务",
          );
        this.pinnedWorkspace = catalog.workspace;
        this.peer = peer;
        this.catalog = catalog;
        this.connection = randomUUID();
        this.lastSeen = Date.now();
        this.send(peer, JSON.stringify({ type: "ready", connection: this.connection }));
        this.onCatalog?.();
        return;
      }
      this.lastSeen = Date.now();
      if (message.type === "catalog") {
        const catalog = decodeCatalog(message.catalog);
        if (catalog.workspace !== this.pinnedWorkspace)
          throw new BridgeError("WORKSPACE_MISMATCH", "工作区身份发生变化");
        this.catalog = catalog;
        this.onCatalog?.();
      } else if (message.type === "result" && typeof message.id === "string") {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        pending.cleanup();
        if (message.error && typeof message.error === "object") {
          const error = message.error as { code?: unknown; message?: unknown };
          pending.reject(
            new BridgeError(
              typeof error.code === "string" ? error.code : "TOOL_ERROR",
              typeof error.message === "string" ? error.message : "工具执行失败",
            ),
          );
        } else pending.resolve(message.result);
      } else if (message.type !== "pong")
        throw new BridgeError("INVALID_MESSAGE", "未知的 Bridge 消息");
    } catch (error) {
      this.send(
        peer,
        JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      peer.close(1008, "Rejected");
      this.detach(peer);
    }
  }
  detach(peer: BrowserPeer) {
    if (peer !== this.peer) return;
    this.peer = undefined;
    this.catalog = undefined;
    this.connection = "";
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(
        new BridgeError(
          "WORKSPACE_DISCONNECTED",
          "浏览器工作区已断开。写入结果可能未知，请保留原 requestId 重试。",
        ),
      );
    }
    this.pending.clear();
    this.onDisconnect?.();
    this.onCatalog?.();
  }
  heartbeat() {
    if (!this.peer) return;
    if (Date.now() - this.lastSeen > 35000) {
      const peer = this.peer;
      this.detach(peer);
      peer.close(1001, "Heartbeat timeout");
    } else this.send(this.peer, '{"type":"ping"}');
  }
  requireConnection() {
    if (!this.peer)
      throw new BridgeError("WORKSPACE_DISCONNECTED", "请在 BCR 的外部 Agent 面板连接工作区");
    return this.connection;
  }
  async invoke(operation: BridgeOperation, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    this.requireConnection();
    if (this.pending.size >= 8) throw new BridgeError("BUSY", "工作区正在处理较多请求，请稍后重试");
    if (operation.kind === "tool") {
      const tool = this.catalog?.tools.find((t) => t.name === operation.name);
      if (!tool || (!this.catalog?.write && tool.risk !== "read_only"))
        throw new BridgeError("FORBIDDEN", "工具未授权或已不可用");
    } else if (!this.catalog?.files || (operation.kind === "file.import" && !this.catalog.write))
      throw new BridgeError("FORBIDDEN", "文件操作未授权");
    const id = randomUUID(),
      peer = this.peer!;
    const data = JSON.stringify({ type: "request", id, operation });
    if (Buffer.byteLength(data) > MAX_MESSAGE_BYTES)
      throw new BridgeError("MESSAGE_TOO_LARGE", "工具输入过大");
    return new Promise((resolve, reject) => {
      const cancel = (code: string, message: string) => {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        p.cleanup();
        if (this.peer === peer) this.send(peer, JSON.stringify({ type: "cancel", id }));
        reject(new BridgeError(code, message));
      };
      const abort = () => cancel("CANCELLED", "请求已取消；写入结果请通过原 requestId 核对");
      const timer = setTimeout(
        () => cancel("TIMEOUT", "工作区响应超时；写入结果请通过原 requestId 核对"),
        this.timeout,
      );
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        },
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.send(peer, data);
    });
  }
  close() {
    if (this.peer) {
      const peer = this.peer;
      this.detach(peer);
      peer.close(1001, "Server stopped");
    }
  }
}
