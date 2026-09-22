import { createCapabilityRegistry } from "./capabilities";
import { createSurfaceRegistry } from "./surface";
import { createAgentSettings } from "./settings";
import { createConversations } from "./conversations";
import type { ConversationStorage } from "./conversationTypes";
import type { RunRound } from "./loop";

export type AgentHostServices = ReturnType<typeof createCapabilityRegistry> &
  ReturnType<typeof createSurfaceRegistry> & { settings: ReturnType<typeof createAgentSettings> };

/** Registries belong to a host, never to a module or a mounted chat view. */
export function createAgentHost(
  options: { storage?: ConversationStorage; runRound?: RunRound } = {},
) {
  const services: AgentHostServices = {
    ...createCapabilityRegistry(),
    ...createSurfaceRegistry(),
    settings: createAgentSettings(),
  };
  return { ...services, conversations: createConversations(services, options) };
}
export type AgentHost = ReturnType<typeof createAgentHost>;
