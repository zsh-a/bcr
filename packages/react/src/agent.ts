import { useSyncExternalStore } from "react";
import { agentConfigured, type AgentEndpoint, type CredentialScope } from "@bcr/agent";
import { useAgentHost } from "./AgentProvider";

export interface AgentService {
  readonly endpoint: AgentEndpoint;
  readonly configured: boolean;
  readonly setEndpoint: (endpoint: AgentEndpoint | null, scope?: CredentialScope) => void;
  readonly persistence: { scope: CredentialScope; error: string | null; needsKey: boolean };
}

/** Host-owned settings; persistence is an explicit embedding policy. */
export function useAgent(): AgentService {
  const { settings } = useAgentHost();
  const endpoint = useSyncExternalStore(settings.subscribe, settings.getSnapshot);
  const persistence = useSyncExternalStore(settings.subscribe, settings.getPersistenceSnapshot);
  return {
    endpoint,
    configured: agentConfigured(endpoint) && !persistence.needsKey,
    persistence,
    setEndpoint: settings.configure,
  };
}
