import type { WorkspacePlugin } from "@bcr/shell-contract";
import { workspaceServices } from "../workspace";
import { workCapability } from "./agent";

export const worksPlugin: WorkspacePlugin = {
  id: "works",
  activate({ runtime, agent, reportError }) {
    const { works, preview, workService } = workspaceServices(runtime);
    const unregister = agent.registerAgentCapability(workCapability(works, preview, workService));
    let disposed = false;
    const publish = () => {
      if (!disposed)
        runtime.search?.replaceSource(
          "works",
          works.getSnapshot().map((w) => ({
            id: `work:${w.id}`,
            source: "works",
            kind: "document",
            title: w.title,
            body: w.files.map((f) => f.path).join("\n"),
            subtitle: "作品",
            route: `/works?work=${w.id}`,
            updatedAt: w.updatedAt,
          })),
        );
    };
    const unsubscribe = works.subscribe(publish);
    void Promise.all([works.ready, runtime.search?.ready]).then(publish, (error) => {
      if (!disposed) reportError(error);
    });
    return () => {
      disposed = true;
      preview.stop();
      unsubscribe();
      unregister();
    };
  },
};
