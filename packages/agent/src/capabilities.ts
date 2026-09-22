import type { AgentTool } from "./runtime";

/** A domain contributes tools and optional context without owning the chat UI. */
export interface AgentCapability {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly domain?: string;
  /** Shared capabilities remain usable when their domain is not the active page. */
  readonly scope?: "workspace" | "shared";
  readonly tools: readonly AgentTool[];
  readonly available?: () => boolean;
  readonly context?: () => string | null;
}

export function createCapabilityRegistry() {
  const capabilities = new Map<string, AgentCapability>();
  const listeners = new Set<() => void>();
  let snapshot: readonly AgentCapability[] = [];

  function emit(): void {
    snapshot = [...capabilities.values()];
    for (const listener of listeners) listener();
  }

  function registerAgentCapability(capability: AgentCapability): () => void {
    if (!capability.id.trim()) throw new Error("Agent capability id is required");
    if (capabilities.has(capability.id))
      throw new Error(`Duplicate agent capability: ${capability.id}`);
    capabilities.set(capability.id, capability);
    emit();
    return () => {
      if (capabilities.get(capability.id) === capability) {
        capabilities.delete(capability.id);
        emit();
      }
    };
  }

  function agentCapabilities(): readonly AgentCapability[] {
    return snapshot;
  }

  function availableAgentCapabilities(
    workspaceId: string,
    disabled: readonly string[] = [],
  ): readonly AgentCapability[] {
    return snapshot.filter(
      (capability) =>
        !disabled.includes(capability.id) &&
        (capability.available?.() ?? true) &&
        (capability.scope !== "workspace" || capability.domain === workspaceId),
    );
  }

  function subscribeAgentCapabilities(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    registerAgentCapability,
    agentCapabilities,
    availableAgentCapabilities,
    subscribeAgentCapabilities,
  };
}
