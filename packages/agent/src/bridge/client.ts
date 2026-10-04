import type { AgentCapability } from "../capabilities";
import { executeAgentTool } from "../execution";
import { requiresApproval } from "../tools";
import {
  BRIDGE_VERSION,
  MAX_MESSAGE_BYTES,
  bridgeUrl,
  parseMessage,
  record,
  type BridgeCatalog,
  type BridgeGrant,
  type BridgeRequest,
  type BridgeResponse,
} from "./protocol";

export type BridgeFileAccess = {
  capability: string | readonly string[];
  read: (artifact: unknown) => Promise<Blob>;
  import: (blob: Blob, name: string, signal: AbortSignal) => Promise<unknown>;
};
export type BridgeActivity = {
  id: string;
  name: string;
  status: "running" | "completed" | "error";
  at: number;
};
export type BridgeState = {
  status: "disconnected" | "connecting" | "connected";
  message: string;
  tools: number;
  pending: number;
  activity: readonly BridgeActivity[];
};

/** One explicitly authorized connection to the actual browser workspace. No model or chat state. */
export class BrowserBridge {
  private socket: WebSocket | undefined;
  private session: AbortController | undefined;
  private listeners = new Set<() => void>();
  private snapshot: BridgeState = {
    status: "disconnected",
    message: "尚未连接",
    tools: 0,
    pending: 0,
    activity: [],
  };
  private running = new Map<string, AbortController>();
  private unsubscribe: (() => void) | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  constructor(
    private readonly options: {
      capabilities: () => readonly AgentCapability[];
      subscribe: (listener: () => void) => () => void;
      workspace: string;
      label: string;
      files?: BridgeFileAccess;
    },
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(value: Partial<BridgeState>) {
    this.snapshot = { ...this.snapshot, ...value };
    for (const fn of this.listeners) fn();
  }
  private activity(id: string, name: string, status: BridgeActivity["status"]) {
    this.update({
      activity: [
        { id, name, status, at: Date.now() },
        ...this.snapshot.activity.filter((a) => a.id !== id),
      ].slice(0, 20),
    });
  }
  disconnect(message = "已断开连接") {
    this.session?.abort();
    this.session = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    clearInterval(this.heartbeat);
    for (const c of this.running.values()) c.abort();
    this.running.clear();
    this.socket?.close(1000, "Disconnected");
    this.socket = undefined;
    this.update({
      status: "disconnected",
      message,
      tools: 0,
      pending: 0,
      activity: this.snapshot.activity.map((a) =>
        a.status === "running" ? { ...a, status: "error" } : a,
      ),
    });
  }
  connect(address: string, token: string, grant: BridgeGrant) {
    const base = bridgeUrl(address);
    if (!/^[a-f0-9]{64}$/u.test(token)) throw new Error("请输入启动 Bridge 时生成的连接密钥");
    if (!grant.capabilities.length) throw new Error("至少选择一项能力");
    this.disconnect();
    const scope = { capabilities: [...grant.capabilities], write: grant.write };
    const session = new AbortController();
    this.session = session;
    const endpoint = new URL("/bridge", base);
    endpoint.protocol = "ws:";
    const socket = new WebSocket(endpoint);
    this.socket = socket;
    let connection = "",
      lastSeen = Date.now();
    const tools = () =>
      this.options
        .capabilities()
        .filter(
          (c) =>
            scope.capabilities.includes(c.id) && c.scope === "shared" && (c.available?.() ?? true),
        )
        .flatMap((c) =>
          c.tools
            .filter((t) => scope.write || !requiresApproval(t.spec))
            .map((t) => ({ tool: t, capability: c.id })),
        );
    const files = () =>
      this.options.files &&
      this.options
        .capabilities()
        .some(
          (c) =>
            [this.options.files!.capability].flat().includes(c.id) &&
            scope.capabilities.includes(c.id) &&
            c.scope === "shared" &&
            (c.available?.() ?? true),
        )
        ? this.options.files
        : undefined;
    const catalog = (): BridgeCatalog => ({
      workspace: this.options.workspace,
      label: this.options.label,
      write: scope.write,
      files: !!files(),
      tools: tools().map(({ tool, capability }) => ({ ...tool.spec, capability })),
    });
    const send = (value: unknown) => {
      if (session.signal.aborted || socket.readyState !== WebSocket.OPEN) return;
      const data = JSON.stringify(value);
      if (new TextEncoder().encode(data).length > MAX_MESSAGE_BYTES)
        throw new Error("工具结果过大，请使用分页读取或文件导出");
      socket.send(data);
    };
    const transfer = async (id: string, init: RequestInit, signal: AbortSignal) => {
      if (!/^[a-f0-9-]{36}$/u.test(id)) throw new Error("文件传输身份无效");
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      headers.set("X-BCR-Connection", connection);
      const response = await fetch(new URL(`/transfers/${id}`, base), {
        ...init,
        signal,
        headers,
      });
      if (!response.ok) throw new Error(`文件传输失败 (${response.status})`);
      return response;
    };
    const execute = async (request: BridgeRequest) => {
      const abort = new AbortController(),
        signal = AbortSignal.any([session.signal, abort.signal]);
      this.running.set(request.id, abort);
      this.update({ pending: this.running.size });
      const op = request.operation,
        name = op.kind === "tool" ? op.name : op.kind;
      this.activity(request.id, name, "running");
      try {
        let result: unknown;
        if (op.kind === "tool") {
          const selected = tools().find((t) => t.tool.spec.name === op.name);
          if (!selected) throw new Error("该工具不在本次授权范围内");
          result = await executeAgentTool(
            selected.tool,
            JSON.stringify(record(op.input)),
            { callId: request.id, signal },
            {
              authorize: () => {
                if (!tools().some((t) => t.tool === selected.tool)) throw new Error("能力已关闭");
              },
              approve: async () => scope.write,
            },
          );
        } else {
          const access = files();
          if (!access) throw new Error("文件访问未授权");
          if (op.kind === "file.export") {
            const blob = await access.read(op.artifact);
            signal.throwIfAborted();
            if (files() !== access) throw new Error("文件访问已撤销");
            await transfer(op.transfer, { method: "POST", body: blob }, signal);
            result = { size: blob.size, mime: blob.type };
          } else if (op.kind === "file.import" && scope.write) {
            const response = await transfer(op.transfer, { method: "GET" }, signal);
            const blob = (await response.blob()).slice(0, undefined, op.mime);
            signal.throwIfAborted();
            if (files() !== access) throw new Error("文件访问已撤销");
            result = await access.import(blob, op.name, signal);
          } else throw new Error("文件导入未授权");
        }
        signal.throwIfAborted();
        send({ type: "result", id: request.id, result } satisfies BridgeResponse);
        this.activity(request.id, name, "completed");
      } catch (error) {
        send({
          type: "result",
          id: request.id,
          error: {
            code: signal.aborted ? "CANCELLED" : "TOOL_ERROR",
            message: error instanceof Error ? error.message : String(error),
          },
        } satisfies BridgeResponse);
        this.activity(request.id, name, "error");
      } finally {
        this.running.delete(request.id);
        this.update({ pending: this.running.size });
      }
    };
    this.update({ status: "connecting", message: "正在连接本机服务…" });
    socket.onopen = () => {
      try {
        send({ type: "hello", version: BRIDGE_VERSION, token, catalog: catalog() });
      } catch {
        this.disconnect("无法提供工作区工具目录");
      }
    };
    socket.onmessage = (event) => {
      if (session.signal.aborted) return;
      try {
        const message = parseMessage(String(event.data));
        lastSeen = Date.now();
        if (message.type === "ready" && typeof message.connection === "string") {
          connection = message.connection;
          this.update({
            status: "connected",
            message: scope.write ? "已连接 · 允许编辑" : "已连接 · 只读",
            tools: tools().length,
          });
          this.unsubscribe = this.options.subscribe(() => {
            try {
              send({ type: "catalog", catalog: catalog() });
              this.update({ tools: tools().length });
            } catch {
              this.disconnect("工作区工具目录已不可用");
            }
          });
        } else if (message.type === "request" && connection && typeof message.id === "string") {
          if (this.running.size >= 8 || this.running.has(message.id))
            throw new Error("并发请求过多");
          const operation = record(message.operation);
          if (!["tool", "file.import", "file.export"].includes(String(operation.kind)))
            throw new Error("无效的 Bridge 操作");
          void execute(message as unknown as BridgeRequest);
        } else if (message.type === "cancel" && typeof message.id === "string")
          this.running.get(message.id)?.abort();
        else if (message.type === "ping") send({ type: "pong" });
        else if (message.type === "error") this.disconnect(String(message.message));
      } catch {
        this.disconnect("Bridge 消息无效，已断开");
      }
    };
    socket.onerror = () => {
      if (!session.signal.aborted)
        this.disconnect("无法连接，请确认本机 Bridge 已启动且来源地址一致");
    };
    socket.onclose = () => {
      if (!session.signal.aborted)
        this.disconnect("连接已断开，请重新连接；未完成写入请按原 requestId 重试");
    };
    this.heartbeat = setInterval(() => {
      if (Date.now() - lastSeen > 35000) this.disconnect("连接超时，请重新连接");
    }, 5000);
  }
}
