import type { WorkspacePlugin } from "@bcr/shell-contract";
import { workspaceServices } from "../workspace";
import { diagramCapability } from "./agent";
import { diagramResultRenderers } from "./agentRenderers";

export const diagramPlugin: WorkspacePlugin = {
  id: "diagram",
  agentRenderers: diagramResultRenderers,
  activate({ runtime, agent, reportError }) {
    const store = workspaceServices(runtime).diagrams;
    const unregister = agent.registerAgentCapability(diagramCapability(store));
    let disposed = false,
      ready = false;
    const publish = () => {
      if (disposed || !ready || !runtime.search) return;
      runtime.search.replaceSource(
        "diagram",
        store.getSnapshot().map((item) => ({
          id: `diagram:${item.id}`,
          source: "diagram",
          kind: "diagram",
          title: item.title,
          body: item.title,
          subtitle: "绘图",
          route: `/diagram?diagram=${encodeURIComponent(item.id)}`,
          updatedAt: item.updatedAt,
        })),
      );
    };
    const unsubscribe = store.subscribe(publish);
    void Promise.all([store.ready, runtime.search?.ready]).then(
      () => {
        ready = true;
        publish();
      },
      (error) => {
        if (!disposed) reportError(error);
      },
    );
    return () => {
      disposed = true;
      unsubscribe();
      unregister();
    };
  },
};
