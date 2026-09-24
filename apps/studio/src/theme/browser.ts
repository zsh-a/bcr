import { createThemeStore, THEME_KEY } from "./store";

const media = window.matchMedia("(prefers-color-scheme: dark)");
export const themeStore = createThemeStore({
  read: () => localStorage.getItem(THEME_KEY),
  write: (value) => localStorage.setItem(THEME_KEY, value),
  systemDark: () => media.matches,
  apply: (resolved) => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  },
});
const systemChanged = () => themeStore.systemChanged();
const storageChanged = (event: StorageEvent) => {
  if (event.key === THEME_KEY || event.key === null) themeStore.storageChanged();
};
media.addEventListener("change", systemChanged);
window.addEventListener("storage", storageChanged);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    media.removeEventListener("change", systemChanged);
    window.removeEventListener("storage", storageChanged);
  });
