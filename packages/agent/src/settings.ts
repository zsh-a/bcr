import type { AgentEndpoint } from "./runtime";

/**
 * Host-local endpoint configuration.
 *
 * Held in memory only: a credential is never written to localStorage, workspace
 * metadata, an export or a repository. A reload asks for the key again. The
 * configuration is owned by the AgentHost and never shared between hosts.
 */
const EMPTY: AgentEndpoint = Object.freeze({ baseUrl: "", apiKey: "", model: "" });
export function createAgentSettings() {
  let current: AgentEndpoint | null = null;
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

  function configure(next: AgentEndpoint | null): void {
    const normalized =
      next && next.baseUrl.trim() && next.model.trim()
        ? {
            baseUrl: next.baseUrl.trim().replace(/\/+$/u, ""),
            apiKey: next.apiKey.trim(),
            model: next.model.trim(),
          }
        : null;
    if (JSON.stringify(normalized) === JSON.stringify(current)) return;
    current = normalized ? Object.freeze(normalized) : null;
    for (const listener of listeners) listener();
  }
  return { subscribe, getSnapshot, configure };
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
