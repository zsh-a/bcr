import type { RuntimeMetadata, RuntimeServices } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";
import { KnowledgeStore } from "./knowledge/store";
import { ResearchStore } from "./research/index";
import { DiagramStore } from "./diagram/store";
import { createDiagramStorage } from "./diagram/browserStorage";

/** The composition root owns domain stores; plugins only attach projections/capabilities. */
export function createWorkspaceServices(
  metadata: RuntimeMetadata | undefined,
  binary?: BinaryStore,
  compute?: Pick<RuntimeServices, "scheduler" | "artifacts">,
) {
  const knowledge = new KnowledgeStore(metadata, binary, compute);
  const research = new ResearchStore(metadata);
  const diagramStorage = typeof indexedDB === "undefined" ? undefined : createDiagramStorage();
  const diagrams = new DiagramStore(diagramStorage ?? metadata);
  let closing: Promise<void> | undefined;
  return {
    knowledge,
    research,
    diagrams,
    close() {
      // Stop new sync/research work, drain accepted commits, then release persistence.
      return (closing ??= Promise.allSettled([
        knowledge.close(),
        research.close(),
        diagrams.close(),
      ])
        .then((results) => {
          const failure = results.find((result) => result.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
        })
        .finally(() => diagramStorage?.close())
        .then(() => undefined));
    },
  };
}

const workspaces = new WeakMap<RuntimeMetadata, ReturnType<typeof createWorkspaceServices>>();
/** All consumers of a metadata session share one explicitly owned set of domain services. */
export function workspaceServices(
  metadata: RuntimeMetadata | undefined,
  binary?: BinaryStore,
  compute?: Pick<RuntimeServices, "scheduler" | "artifacts">,
) {
  if (!metadata) return createWorkspaceServices(undefined, binary, compute);
  let workspace = workspaces.get(metadata);
  if (!workspace) {
    workspace = createWorkspaceServices(metadata, binary, compute);
    workspaces.set(metadata, workspace);
  }
  return workspace;
}
