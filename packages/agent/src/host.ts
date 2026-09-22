import { createCapabilityRegistry } from "./capabilities";
import { createSurfaceRegistry } from "./surface";
import { createAgentSettings } from "./settings";

/** Registries belong to a host, never to a module or a mounted chat view. */
export function createAgentHost() {
  return {
    ...createCapabilityRegistry(),
    ...createSurfaceRegistry(),
    settings: createAgentSettings(),
  };
}
export type AgentHost = ReturnType<typeof createAgentHost>;
