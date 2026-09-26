import { registerPwaWorker } from "./pwa/register";
import { captureInstallPrompt, syncInstallMetadata } from "./pwa/install";
import { pwaAtPath, PWA_APPS } from "./pwa/apps";

const dedicated = pwaAtPath(location.pathname);
// Direct embedded URLs must advertise their own identity, never Reader by default.
syncInstallMetadata(
  dedicated ?? PWA_APPS.find((app) => app.path !== "/" && location.pathname === app.path),
);
captureInstallPrompt();
// Compatibility worker for existing browser workspaces; not an installation identity.
if (!dedicated) registerPwaWorker("/sw.js", "/");

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("missing #root");
const container: HTMLElement = rootElement;

function isStandaloneReader(): boolean {
  // A selection made in the lightweight installed Reader opens the workspace
  // in the same tab, where the shared collection store owns persistence.
  try {
    if (sessionStorage.getItem("bcr-reader-pending-capture")) return false;
  } catch {
    /* The standalone Reader remains usable without sessionStorage. */
  }
  if (window.location.pathname !== "/reader" && !window.location.pathname.startsWith("/reader/")) {
    return false;
  }
  const standaloneMedia =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = Boolean(
    (navigator as Navigator & { readonly standalone?: boolean }).standalone,
  );
  return standaloneMedia || iosStandalone;
}

function showBootstrapError(reason: unknown): void {
  const message = reason instanceof Error ? reason.message : String(reason);
  container.replaceChildren();
  const error = document.createElement("p");
  error.className = "bcr-bootstrap-error";
  error.textContent = `BCR 启动失败：${message}`;
  container.append(error);
}

// The installed Reader is a focused PWA surface. Keep the Studio shell out of
// its initial module graph; desktop/browser Reader routes still use the full
// Shell so shared search and cross-workspace handoffs remain available there.
const entry = dedicated
  ? import("./pwa/main")
  : isStandaloneReader()
    ? import("./reader-main").then(({ mountReader }) => mountReader(container))
    : import("./studio-main").then(({ mountStudio }) => mountStudio(container));

void entry.catch(showBootstrapError);
