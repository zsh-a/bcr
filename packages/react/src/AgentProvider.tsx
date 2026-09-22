import { createContext, useContext, type ReactNode } from "react";
import type { AgentHost } from "@bcr/agent";

const AgentContext = createContext<AgentHost | null>(null);
/** The embedding host owns storage, transport and lifetime; this only binds React. */
export function AgentProvider({ host, children }: { host: AgentHost; children: ReactNode }) {
  return <AgentContext.Provider value={host}>{children}</AgentContext.Provider>;
}
export function useAgentHost(): AgentHost {
  const host = useContext(AgentContext);
  if (!host) throw new Error("AgentProvider is required");
  return host;
}
