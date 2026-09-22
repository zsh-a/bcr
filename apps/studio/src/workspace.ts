import type { RuntimeMetadata } from "@bcr/core";
import { KnowledgeStore } from "./knowledge/store";
import { ResearchStore } from "./research/index";

/** The composition root owns domain stores; plugins only attach projections/capabilities. */
export function createWorkspaceServices(metadata: RuntimeMetadata | undefined) {
  const knowledge = new KnowledgeStore(metadata);
  const research = new ResearchStore(metadata);
  let closing: Promise<void> | undefined;
  return {
    knowledge,
    research,
    close() {
      // Stop new sync/research work, drain accepted commits, then release persistence.
      return (closing ??= Promise.all([knowledge.close(), research.close()]).then(() => undefined));
    },
  };
}

const workspaces = new WeakMap<RuntimeMetadata, ReturnType<typeof createWorkspaceServices>>();
/** All consumers of a metadata session share one explicitly owned set of domain services. */
export function workspaceServices(metadata: RuntimeMetadata | undefined) {
  if (!metadata) return createWorkspaceServices(undefined);
  let workspace = workspaces.get(metadata);
  if (!workspace) {
    workspace = createWorkspaceServices(metadata);
    workspaces.set(metadata, workspace);
  }
  return workspace;
}
