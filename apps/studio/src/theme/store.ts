export type ThemePreference = "system" | "light" | "dark";
export const THEME_KEY = "bcr/theme";
export function themePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function createThemeStore(options: {
  read: () => string | null;
  write: (value: ThemePreference) => void;
  systemDark: () => boolean;
  apply: (resolved: "light" | "dark") => void;
}) {
  function read() {
    try {
      return themePreference(options.read());
    } catch {
      return "system" as const;
    }
  }
  function resolve(preference: ThemePreference) {
    return preference === "system" ? (options.systemDark() ? "dark" : "light") : preference;
  }
  const preference = read();
  let snapshot = { preference, resolved: resolve(preference), error: "" };
  const listeners = new Set<() => void>();
  function update(preference: ThemePreference, error = "") {
    const resolved = resolve(preference);
    if (
      snapshot.preference === preference &&
      snapshot.resolved === resolved &&
      snapshot.error === error
    )
      return;
    snapshot = { preference, resolved, error };
    options.apply(resolved);
    for (const listener of listeners) listener();
  }
  options.apply(snapshot.resolved);
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (preference: ThemePreference) => {
      let error = "";
      try {
        options.write(preference);
      } catch {
        error = "主题已切换，但无法保存；刷新后可能恢复原设置。";
      }
      update(preference, error);
    },
    systemChanged: () => update(snapshot.preference, snapshot.error),
    storageChanged: () => update(read()),
  };
}
