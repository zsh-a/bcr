import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { themeStore } from "./browser";
import { themePreference } from "./store";
import "./theme.css";

export function ThemePicker() {
  const { preference, error } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot);
  const Icon = preference === "system" ? Monitor : preference === "dark" ? Moon : Sun;
  return (
    <div className="studio-theme-picker">
      <Icon size={16} aria-hidden="true" />
      <select
        aria-label="外观主题"
        title="外观主题"
        value={preference}
        onChange={(event) => themeStore.set(themePreference(event.target.value))}
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
      {error && (
        <p role="status" className="studio-theme-error">
          {error}
        </p>
      )}
    </div>
  );
}
