import { useSyncExternalStore } from "react";
import { useAgentHost } from "./AgentProvider";

export function useCredential(id: string) {
  const { credentials } = useAgentHost();
  return useSyncExternalStore(
    credentials.subscribe,
    () => credentials.get(id),
    () => credentials.get(id),
  );
}
