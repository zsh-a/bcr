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
  const cleanups: { id: string; cleanup: () => void }[] = [];
  const dispose = () => {
    for (const { id, cleanup } of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        context.reportError(error, id);
      }
    }
  };
  try {
    for (const plugin of plugins) {
      const cleanup = plugin.activate({
        ...context,
        reportError: (error) => context.reportError(error, plugin.id),
      });
      cleanups.push({ id: plugin.id, cleanup });
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
