/** Deliberately separate from conversation/workspace storage and exports. */
export type CredentialScope = "memory" | "session" | "device";
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface CredentialSnapshot {
  readonly value: string;
  readonly scope: CredentialScope;
  readonly error: string | null;
}
export function createCredentialStore(
  storage: { session?: SettingsStorage; device?: SettingsStorage } = {},
) {
  const cache = new Map<string, CredentialSnapshot>();
  const listeners = new Set<() => void>();
  const key = (id: string) => `bcr/credentials/v1/${encodeURIComponent(id)}`;
  function get(id: string): CredentialSnapshot {
    const existing = cache.get(id);
    if (existing) return existing;
    let result: CredentialSnapshot = { value: "", scope: "memory", error: null };
    try {
      for (const scope of ["session", "device"] as const) {
        const raw = storage[scope]?.getItem(key(id));
        if (!raw) continue;
        const data: unknown = JSON.parse(raw);
        if (
          !data ||
          typeof data !== "object" ||
          !("version" in data) ||
          data.version !== 1 ||
          !("value" in data) ||
          typeof data.value !== "string"
        )
          throw new Error("Invalid credential record");
        result = { value: data.value, scope, error: null };
        break;
      }
    } catch {
      result = { value: "", scope: "memory", error: "无法恢复凭据，请重新填写；未覆盖原存储。" };
    }
    cache.set(id, result);
    return result;
  }
  function save(id: string, value: string, scope: CredentialScope): CredentialSnapshot {
    if (!["memory", "session", "device"].includes(scope)) throw new Error("无效的凭据保存范围");
    let failed = false;
    // Always attempt both removals. A downgrade must not leave the old device copy silently.
    for (const adapter of [storage.session, storage.device]) {
      try {
        adapter?.removeItem(key(id));
      } catch {
        failed = true;
      }
    }
    const trimmed = value.trim();
    if (!failed && trimmed && scope !== "memory") {
      try {
        const adapter = storage[scope];
        if (!adapter) throw new Error("Storage unavailable");
        adapter.setItem(key(id), JSON.stringify({ version: 1, value: trimmed }));
      } catch {
        failed = true;
      }
    }
    const result: CredentialSnapshot = {
      value: trimmed,
      scope: failed || !trimmed ? "memory" : scope,
      error: failed
        ? "凭据仅本页可用：存储操作失败，旧副本可能未清除。请检查浏览器权限或清除本站数据后重试。"
        : null,
    };
    cache.set(id, result);
    for (const listener of listeners) listener();
    return result;
  }
  return {
    get,
    save,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type CredentialStore = ReturnType<typeof createCredentialStore>;

/** Credential binding uses the complete normalized endpoint, not just the host. */
export function normalizeEndpointUrl(value: string): string {
  const input = value.trim();
  const relative = input.startsWith("/") && !input.startsWith("//");
  const url = new URL(input, relative ? "https://bcr.invalid" : undefined);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("接口地址必须为 HTTP(S) 或同源路径，不能包含账号、密码、查询参数或片段。");
  return (relative ? url.pathname : `${url.origin}${url.pathname}`).replace(/\/+$/u, "") || "/";
}
