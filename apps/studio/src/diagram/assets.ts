// Fonts stay on this origin, including the Chinese fallback. No CDN is needed to edit.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}
window.EXCALIDRAW_ASSET_PATH = "/diagram-assets/";
export {};
