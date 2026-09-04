import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./reader-entry.css";

import { createRoot } from "react-dom/client";
import { App } from "@bcr/reader-studio/app";

/** Mount Reader without booting the workspace-wide Studio Runtime. */
export function mountReader(container: HTMLElement): void {
  createRoot(container).render(<App />);
}
