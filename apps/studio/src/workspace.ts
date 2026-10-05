import type { RuntimeMetadata, RuntimeServices } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";
import { KnowledgeStore } from "./knowledge/session/store";
import { ResearchStore } from "./research";
import { DiagramStore } from "./diagram/store";
import { createDiagramStorage } from "./diagram/browserStorage";
import { WorkspaceFiles } from "./workspace/files";
import { createWorkspaceStorage } from "./workspace/storage";
import { WorkStore } from "./works/store";
import { WorkPreview } from "./works/preview";
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
  let files: WorkspaceFiles | undefined;
  let works: WorkStore | undefined;
  let workStorage: ReturnType<typeof createWorkspaceStorage> | undefined;
  let preview: WorkPreview | undefined;
  let workService: WorkService | undefined;
  const assertOpen = () => {
    if (closing) throw new Error("工作区服务已关闭");
  };
  return {
    get files() {
      assertOpen();
      return (files ??= new WorkspaceFiles(binary));
    },
    get works() {
      if (works) return works;
      assertOpen();
      workStorage =
        typeof indexedDB === "undefined" ? undefined : createWorkspaceStorage("bcr-works");
      return (works = new WorkStore(
        workStorage ?? metadata,
        (files ??= new WorkspaceFiles(binary)),
      ));
    },
    get workService(): WorkService {
      assertOpen();
      return (workService ??= new WorkService(this.works, this.preview));
    },
    get preview() {
      assertOpen();
      return (preview ??= new WorkPreview());
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
      preview?.stop();
      workService?.close();
      return (closing ??= Promise.allSettled([
        knowledge?.close(),
        research?.close(),
        diagrams?.close(),
        works?.close(),
      ])
        .then((results) => {
          const failures = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          );
          if (failures.length) throw new AggregateError(failures, "工作区服务关闭失败");
        })
        .finally(() => Promise.all([diagramStorage?.close(), workStorage?.close()]))
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
