import { useEffect, useState, useSyncExternalStore } from "react";

export interface AppInstallation {
  manifestUrl: string;
  startUrl: string;
  scope: string;
}
interface NativeInstallPrompt extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
}
let pending: { identity: string; event: NativeInstallPrompt } | null = null;
let installedIdentity: string | null = null;
let captured = false;
let revision = 0;
const listeners = new Set<() => void>();
const publish = () => {
  revision++;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Capture before React mounts. Only a dedicated document may consume its prompt. */
export function captureAppInstallPrompt(identity: () => string | undefined): void {
  if (captured) return;
  captured = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    const current = identity();
    if (!current) return;
    event.preventDefault();
    pending = { identity: current, event: event as NativeInstallPrompt };
    publish();
  });
  window.addEventListener("appinstalled", () => {
    installedIdentity = identity() ?? null;
    pending = null;
    publish();
  });
}
export function resetAppInstallPrompt(): void {
  pending = null;
  publish();
}

export function useAppInstallation(app: AppInstallation) {
  useSyncExternalStore(
    subscribe,
    () => revision,
    () => 0,
  );
  const [standalone, setStandalone] = useState(
    () => typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(display-mode: standalone)");
    const changed = () => setStandalone(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const dedicated =
    location.pathname === app.scope.slice(0, -1) || location.pathname.startsWith(app.scope);
  return {
    standalone: dedicated && standalone,
    installedThisSession: installedIdentity === app.manifestUrl,
    canPrompt: dedicated && pending?.identity === app.manifestUrl,
    async install(this: void): Promise<"redirected" | "manual" | "accepted" | "dismissed"> {
      if (!dedicated) {
        window.location.assign(`${app.startUrl}${location.search}`);
        return "redirected";
      }
      if (pending?.identity !== app.manifestUrl) return "manual";
      const event = pending.event;
      pending = null;
      publish();
      // Accepting a prompt is not completion; appinstalled updates that separately.
      try {
        return (await event.prompt()).outcome;
      } catch {
        return "manual";
      }
    },
  };
}
