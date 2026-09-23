import { createCredentialStore, type SettingsStorage } from "@bcr/agent";

// Resolve storage lazily: accessing window.localStorage itself can throw.
export function browserSettingsStorage(kind: "localStorage" | "sessionStorage"): SettingsStorage {
  return {
    getItem: (key) => window[kind].getItem(key),
    setItem: (key, value) => window[kind].setItem(key, value),
    removeItem: (key) => window[kind].removeItem(key),
  };
}
export function createBrowserCredentials() {
  return createCredentialStore({
    session: browserSettingsStorage("sessionStorage"),
    device: browserSettingsStorage("localStorage"),
  });
}
