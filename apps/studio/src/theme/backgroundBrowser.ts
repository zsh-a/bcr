import { BACKGROUND_KEY, createBackgroundStore } from "./background";

export const backgroundStore = createBackgroundStore({
  read: () => localStorage.getItem(BACKGROUND_KEY),
  write: (raw) => {
    if (raw === null) localStorage.removeItem(BACKGROUND_KEY);
    else localStorage.setItem(BACKGROUND_KEY, raw);
  },
  apply: (value) => {
    const root = document.documentElement;
    root.toggleAttribute("data-background", !!value);
    if (value) {
      root.style.setProperty("--workspace-image", `url("${value.image}")`);
      root.style.setProperty("--workspace-shade", `${value.shade}%`);
    } else {
      root.style.removeProperty("--workspace-image");
      root.style.removeProperty("--workspace-shade");
    }
  },
});
const storageChanged = (event: StorageEvent) => {
  if (event.key === BACKGROUND_KEY || event.key === null) backgroundStore.reload();
};
window.addEventListener("storage", storageChanged);
if (import.meta.hot)
  import.meta.hot.dispose(() => window.removeEventListener("storage", storageChanged));
