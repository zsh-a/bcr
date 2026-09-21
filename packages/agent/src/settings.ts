import type { AgentEndpoint } from "./runtime";

/**
 * The model endpoint for this browser session.
 *
 * Held in memory only: a credential is never written to localStorage, workspace
 * metadata, an export or a repository. A reload asks for the key again. The
 * configuration is a module singleton with an external-store interface, so any
 * consumer can read it without the host passing it down.
 */
let current: AgentEndpoint | null = null;
const listeners = new Set<() => void>();
const EMPTY: AgentEndpoint = { baseUrl: "", apiKey: "", model: "" };

export function agentEndpoint(): AgentEndpoint | null {
  return current;
}

/** The same contract as `useSyncExternalStore`, so consumers can subscribe directly. */
export function subscribeAgent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A stable snapshot; `useSyncExternalStore` compares by identity. */
export function agentSnapshot(): AgentEndpoint {
  return current ?? EMPTY;
}

export function configureAgent(next: AgentEndpoint | null): void {
  const normalized =
    next && next.baseUrl.trim() && next.model.trim()
      ? {
          baseUrl: next.baseUrl.trim().replace(/\/+$/u, ""),
          apiKey: next.apiKey.trim(),
          model: next.model.trim(),
        }
      : null;
  if (JSON.stringify(normalized) === JSON.stringify(current)) return;
  current = normalized;
  for (const listener of listeners) listener();
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
