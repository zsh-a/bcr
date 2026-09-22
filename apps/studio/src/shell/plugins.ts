import type { PluginContext, WorkspacePlugin } from "@bcr/shell-contract";

/** Validate before side effects; roll back partial activation and release in reverse order. */
export function activatePlugins(
  plugins: readonly WorkspacePlugin[],
  context: PluginContext,
): () => void {
  const ids = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin.id || ids.has(plugin.id))
      throw new Error(`Duplicate or empty plugin id: ${plugin.id}`);
    ids.add(plugin.id);
  }
  const cleanups: (() => void)[] = [];
  const dispose = () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        context.reportError(error);
      }
    }
  };
  try {
    for (const plugin of plugins) cleanups.push(plugin.activate(context));
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
