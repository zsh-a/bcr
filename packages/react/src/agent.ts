import { useSyncExternalStore } from "react";
import { agentConfigured, type AgentEndpoint } from "@bcr/agent";
import { useAgentHost } from "./AgentProvider";

export interface AgentService {
  readonly endpoint: AgentEndpoint;
  readonly configured: boolean;
  readonly setEndpoint: (endpoint: AgentEndpoint | null) => void;
}

/** Shared endpoint configuration; credentials remain in page memory. */
export function useAgent(): AgentService {
  const { settings } = useAgentHost();
  const endpoint = useSyncExternalStore(settings.subscribe, settings.getSnapshot);
  return {
    endpoint,
    configured: agentConfigured(endpoint),
    setEndpoint: settings.configure,
  };
}
