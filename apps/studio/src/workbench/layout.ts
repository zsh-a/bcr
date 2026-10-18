/** Shared with commands so opening the shell never imports the Dock implementation. */
export const LAYOUT_KEY = "bcr.studio.layout.v2";

export function resetLayout(): void {
  localStorage.removeItem(LAYOUT_KEY);
  window.location.reload();
}
