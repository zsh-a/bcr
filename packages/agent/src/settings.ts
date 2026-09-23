import type { AgentEndpoint } from "./runtime";
import {
  createCredentialStore,
  normalizeEndpointUrl,
  type CredentialScope,
  type CredentialStore,
  type SettingsStorage,
} from "./credentials";

/**
 * Host-local endpoint configuration.
 *
 * Browser persistence is optional and injected by the host. Connection metadata
 * and credentials never enter conversation/workspace storage or exports.
 */
const EMPTY: AgentEndpoint = Object.freeze({ baseUrl: "", apiKey: "", model: "" });
export function createAgentSettings(
  storage?: SettingsStorage,
  credentials: CredentialStore = createCredentialStore(),
) {
  let current: AgentEndpoint | null = null;
  let persistence = {
    scope: "memory" as CredentialScope,
    error: null as string | null,
    needsKey: false,
  };
  const profileKey = "bcr/agent-connection/v1";
  const credentialId = (url: string) => `agent:${url}`;
  try {
    const raw = storage?.getItem(profileKey);
    if (raw) {
      const profile = JSON.parse(raw);
      if (
        profile.version !== 1 ||
        typeof profile.baseUrl !== "string" ||
        typeof profile.model !== "string" ||
        typeof profile.requiresKey !== "boolean"
      )
        throw new Error("Invalid connection");
      const baseUrl = normalizeEndpointUrl(profile.baseUrl);
      const credential = credentials.get(credentialId(baseUrl));
      current = Object.freeze({ baseUrl, model: profile.model, apiKey: credential.value });
      persistence = {
        scope: credential.scope,
        error: credential.error,
        needsKey: profile.requiresKey && !credential.value,
      };
    }
  } catch {
    persistence.error = "无法恢复模型连接，请重新配置；未覆盖原存储。";
  }
  const listeners = new Set<() => void>();

  /** The same contract as `useSyncExternalStore`, so consumers can subscribe directly. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /** A stable snapshot; `useSyncExternalStore` compares by identity. */
  function getSnapshot(): AgentEndpoint {
    return current ?? EMPTY;
  }

  function configure(next: AgentEndpoint | null, scope: CredentialScope = "memory"): void {
    const normalized =
      next && next.baseUrl.trim() && next.model.trim()
        ? {
            baseUrl: normalizeEndpointUrl(next.baseUrl),
            apiKey: next.apiKey.trim(),
            model: next.model.trim(),
          }
        : null;
    let error: string | null = null;
    if (current && current.baseUrl !== normalized?.baseUrl) {
      error = credentials.save(credentialId(current.baseUrl), "", "memory").error;
      // Never carry an existing secret to a different endpoint through programmatic callers.
      if (normalized && normalized.apiKey === current.apiKey) normalized.apiKey = "";
    }
    const credential = normalized
      ? credentials.save(credentialId(normalized.baseUrl), normalized.apiKey, scope)
      : null;
    error = error ?? credential?.error ?? null;
    try {
      if (normalized)
        storage?.setItem(
          profileKey,
          JSON.stringify({
            version: 1,
            baseUrl: normalized.baseUrl,
            model: normalized.model,
            requiresKey: !!normalized.apiKey,
          }),
        );
      else storage?.removeItem(profileKey);
    } catch {
      error = error ?? "连接仅本页可用：无法保存接口地址和模型，请检查浏览器存储权限。";
    }
    const nextPersistence = {
      scope: credential?.scope ?? ("memory" as CredentialScope),
      error,
      needsKey: false,
    };
    if (
      JSON.stringify(normalized) === JSON.stringify(current) &&
      JSON.stringify(nextPersistence) === JSON.stringify(persistence)
    )
      return;
    persistence = nextPersistence;
    current = normalized ? Object.freeze(normalized) : null;
    for (const listener of listeners) listener();
  }
  return { subscribe, getSnapshot, configure, getPersistenceSnapshot: () => persistence };
}

/**
 * Whether a turn can be attempted.
 *
 * A key is not required: local servers (Ollama, LM Studio, llama.cpp) accept
 * unauthenticated requests, and the runtime omits the `Authorization` header
 * when no key is set. A base URL and a model are still needed.
 */
export function agentConfigured(endpoint: AgentEndpoint | null): endpoint is AgentEndpoint {
  return endpoint !== null && endpoint.baseUrl.length > 0 && endpoint.model.length > 0;
}
