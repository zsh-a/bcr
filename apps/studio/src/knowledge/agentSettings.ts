import type { AgentEndpoint } from "./agentRuntime";

/**
 * The model endpoint for this browser session.
 *
 * Held in memory only, for the same reason the GitHub token is: `docs/KNOWLEDGE-SYNC.md`
 * promises that credentials are never written to localStorage, workspace metadata,
 * an export or a repository. A reload asks for the key again.
 *
 * A module singleton (like `workspaceKnowledge`) rather than React state, because
 * the settings are shared by the note editor and must outlive switching notes.
 */
let current: AgentEndpoint | null = null;
const listeners = new Set<() => void>();

const EMPTY: AgentEndpoint = { baseUrl: "", apiKey: "", model: "" };

export function agentEndpoint(): AgentEndpoint | null {
  return current;
}

/** The same signature as `useSyncExternalStore`, so the editor can subscribe directly. */
export function subscribeAgentEndpoint(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A stable snapshot: `useSyncExternalStore` compares by identity, so keep one object per state. */
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
