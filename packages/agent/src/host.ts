import { createCapabilityRegistry } from "./capabilities";
import { createSurfaceRegistry } from "./surface";

/** Registries belong to a host, never to a module or a mounted chat view. */
export function createAgentHost() {
  return { ...createCapabilityRegistry(), ...createSurfaceRegistry() };
}
export type AgentHost = ReturnType<typeof createAgentHost>;
