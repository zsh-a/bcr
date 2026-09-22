import { useSyncExternalStore } from "react";
import {
  agentConfigured,
  agentEndpoint,
  agentSnapshot,
  configureAgent,
  subscribeAgent,
  type AgentEndpoint,
} from "@bcr/agent";

export interface AgentService {
  readonly endpoint: AgentEndpoint;
  readonly configured: boolean;
  readonly setEndpoint: (endpoint: AgentEndpoint | null) => void;
}

/** Shared endpoint configuration; credentials remain in page memory. */
export function useAgent(): AgentService {
  const endpoint = useSyncExternalStore(subscribeAgent, agentSnapshot);
  return {
    endpoint,
    configured: agentConfigured(agentEndpoint()),
    setEndpoint: configureAgent,
  };
}
