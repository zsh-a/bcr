import { createCapabilityRegistry } from "./capabilities";
import { createSurfaceRegistry } from "./surface";
import { createAgentSettings } from "./settings";
import { createConversations } from "./conversations";
import type { ConversationStorage } from "./conversationTypes";
import type { RunRound } from "./loop";
import { createCredentialStore, type CredentialStore, type SettingsStorage } from "./credentials";

export type AgentHostServices = ReturnType<typeof createCapabilityRegistry> &
  ReturnType<typeof createSurfaceRegistry> & {
    settings: ReturnType<typeof createAgentSettings>;
    credentials: CredentialStore;
  };

/** Registries belong to a host, never to a module or a mounted chat view. */
export function createAgentHost(
  options: {
    storage?: ConversationStorage;
    runRound?: RunRound;
    settingsStorage?: SettingsStorage;
    credentials?: CredentialStore;
  } = {},
) {
  const credentials = options.credentials ?? createCredentialStore();
  const services: AgentHostServices = {
    ...createCapabilityRegistry(),
    ...createSurfaceRegistry(),
    credentials,
    settings: createAgentSettings(options.settingsStorage, credentials),
  };
  return { ...services, conversations: createConversations(services, options) };
}
export type AgentHost = ReturnType<typeof createAgentHost>;
