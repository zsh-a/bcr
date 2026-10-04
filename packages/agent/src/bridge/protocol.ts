import type { AgentToolSpec } from "../runtime";

export const BRIDGE_VERSION = 1;
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
export const MAX_FILE_BYTES = 300 * 1024 * 1024;
export type BridgeGrant = { capabilities: readonly string[]; write: boolean };
export type BridgeTool = AgentToolSpec & { capability: string };
export type BridgeCatalog = {
  workspace: string;
  label: string;
  tools: readonly BridgeTool[];
  files: boolean;
  write: boolean;
};
export type BridgeOperation =
  | { kind: "tool"; name: string; input: Record<string, unknown> }
  | { kind: "file.import"; transfer: string; name: string; mime: string }
  | { kind: "file.export"; transfer: string; artifact: unknown };
export type BridgeRequest = { type: "request"; id: string; operation: BridgeOperation };
export type BridgeResponse = {
  type: "result";
  id: string;
  result?: unknown;
  error?: { code: string; message: string };
};
export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BridgeError("INVALID_MESSAGE", "无效的 Bridge 消息");
  return value as Record<string, unknown>;
}
export function parseMessage(raw: string): Record<string, unknown> {
  if (new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES)
    throw new BridgeError("MESSAGE_TOO_LARGE", "Bridge 消息过大");
  return record(JSON.parse(raw));
}
export function decodeCatalog(value: unknown): BridgeCatalog {
  const v = record(value);
  if (
    typeof v.workspace !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/u.test(v.workspace) ||
    typeof v.label !== "string" ||
    v.label.length > 200 ||
    typeof v.files !== "boolean" ||
    typeof v.write !== "boolean" ||
    !Array.isArray(v.tools) ||
    v.tools.length > 128
  )
    throw new BridgeError("INVALID_CATALOG", "工作区工具目录无效");
  const names = new Set<string>();
  for (const item of v.tools) {
    const t = record(item);
    if (
      typeof t.name !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/u.test(t.name) ||
      t.name.startsWith("bcr_bridge_") ||
      names.has(t.name) ||
      typeof t.capability !== "string" ||
      t.capability.length > 100 ||
      typeof t.description !== "string" ||
      t.description.length > 16000 ||
      !["read_only", "low", "medium", "high"].includes(String(t.risk)) ||
      record(t.input_schema).type !== "object"
    )
      throw new BridgeError("INVALID_CATALOG", "工作区工具定义无效");
    names.add(t.name);
  }
  return v as unknown as BridgeCatalog;
}
export function bridgeUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Bridge 地址必须是本机 HTTP 地址，例如 http://127.0.0.1:5209");
  return url;
}
