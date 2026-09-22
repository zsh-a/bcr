import { createContext, useContext, useState, type ReactNode } from "react";
import { createAgentHost, type AgentHost } from "@bcr/agent";

const AgentContext = createContext<AgentHost | null>(null);
export function AgentProvider({ children }: { children: ReactNode }) {
  const [host] = useState(createAgentHost);
  return <AgentContext.Provider value={host}>{children}</AgentContext.Provider>;
}
export function useAgentHost(): AgentHost {
  const host = useContext(AgentContext);
  if (!host) throw new Error("AgentProvider is required");
  return host;
}
