import type { RuntimeMetadata, RuntimeServices } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";
import { KnowledgeStore } from "./knowledge/session/store";
import { ResearchStore } from "./research";
import { DiagramStore } from "./diagram/store";
import { createDiagramStorage } from "./diagram/browserStorage";
import { WorkService } from "./works/service";

/** The session owns lazy domain services; views and plugins borrow the same instances. */
export function createWorkspaceServices(
  metadata: RuntimeMetadata | undefined,
  binary?: BinaryStore,
  compute?: Pick<RuntimeServices, "scheduler" | "artifacts">,
) {
  let knowledge: KnowledgeStore | undefined;
  let research: ResearchStore | undefined;
  let diagrams: DiagramStore | undefined;
  let diagramStorage: ReturnType<typeof createDiagramStorage> | undefined;
  let closing: Promise<void> | undefined;
  let workService: WorkService | undefined;
  const assertOpen = () => {
    if (closing) throw new Error("工作区服务已关闭");
  };
  return {
    get workService(): WorkService {
      assertOpen();
      return (workService ??= new WorkService());
    },
    get knowledge() {
      if (knowledge) return knowledge;
      assertOpen();
      return (knowledge ??= new KnowledgeStore(metadata, binary, compute));
    },
    get research() {
      if (research) return research;
      assertOpen();
      return (research ??= new ResearchStore(metadata));
    },
    get diagrams() {
      if (diagrams) return diagrams;
      assertOpen();
      if (!diagrams) {
        diagramStorage = typeof indexedDB === "undefined" ? undefined : createDiagramStorage();
        diagrams = new DiagramStore(diagramStorage ?? metadata);
      }
      return diagrams;
    },
    close() {
      workService?.close();
      return (closing ??= Promise.allSettled([
        knowledge?.close(),
        research?.close(),
        diagrams?.close(),
      ])
        .then((results) => {
          const failures = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          );
          if (failures.length) throw new AggregateError(failures, "工作区服务关闭失败");
        })
        .finally(() => Promise.all([diagramStorage?.close()]))
        .then(() => undefined));
    },
  };
}

type WorkspaceOwner = Pick<RuntimeServices, "metadata" | "binary" | "host"> &
  Partial<Pick<RuntimeServices, "scheduler" | "artifacts">>;
const workspaces = new WeakMap<object, ReturnType<typeof createWorkspaceServices>>();
/** Artifact identity survives view wrappers and distinguishes sessions sharing one host. */
export function workspaceServices(runtime: WorkspaceOwner) {
  const owner = runtime.artifacts ?? runtime.metadata ?? runtime.host ?? runtime;
  let workspace = workspaces.get(owner);
  if (!workspace) {
    workspace = createWorkspaceServices(
      runtime.metadata,
      runtime.binary,
      runtime.scheduler && runtime.artifacts
        ? { scheduler: runtime.scheduler, artifacts: runtime.artifacts }
        : undefined,
    );
    workspaces.set(owner, workspace);
  }
  return workspace;
}
