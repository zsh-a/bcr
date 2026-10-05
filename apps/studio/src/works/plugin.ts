import type { WorkspacePlugin } from "@bcr/shell-contract";
import { workspaceServices } from "../workspace";
import { workKey, workRoute } from "./service";

export const worksPlugin: WorkspacePlugin = {
  id: "works",
  activate({ runtime, reportError }) {
    const { workService } = workspaceServices(runtime);
    let disposed = false;
    const publish = () => {
      if (!disposed)
        runtime.search?.replaceSource(
          "works",
          workService.getSnapshot().map((w) => ({
            id: `work:${workKey(w.ref)}`,
            source: "works",
            kind: "document",
            title: w.title,
            body: w.targets.map((t) => t.entry).join("\n"),
            subtitle: "Runner 作品",
            route: workRoute(w.ref),
            updatedAt: 0,
          })),
        );
    };
    const unsubscribe = workService.subscribe(publish);
    publish();
    if (runtime.search)
      void runtime.search.ready.then(publish, (error) => {
        if (!disposed) reportError(error);
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  },
};
