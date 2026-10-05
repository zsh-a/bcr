import type { WorkspacePlugin } from "@bcr/shell-contract";
import { workspaceServices } from "../workspace";
import { workKey, workRoute } from "./service";
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
          workService.getSnapshot().map((w) => ({
            id: `work:${workKey(w.ref)}`,
            source: "works",
            kind: "document",
            title: w.title,
            body: w.targets.map((t) => t.entry).join("\n"),
            subtitle: w.ref.provider === "local" ? "本地作品" : "浏览器作品",
            route: workRoute(w.ref),
            updatedAt:
              w.ref.provider === "browser"
                ? (works.getSnapshot().find((item) => item.id === w.ref.id)?.updatedAt ?? 0)
                : 0,
          })),
        );
    };
    const unsubscribe = workService.subscribe(publish);
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
