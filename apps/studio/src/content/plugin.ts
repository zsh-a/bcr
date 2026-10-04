import type { WorkspacePlugin } from "@bcr/shell-contract";
import { workspaceServices } from "../workspace";
import { contentCapability } from "./agent";
import { contentResultRenderers } from "./agentRenderers";

export const contentPlugin: WorkspacePlugin = {
  id: "content",
  agentRenderers: contentResultRenderers,
  activate({ runtime, agent, reportError }) {
    const workspace = workspaceServices(runtime),
      store = workspace.content;
    const unregister = agent.registerAgentCapability(contentCapability(store, workspace.knowledge));
    let disposed = false;
    const publish = () => {
      if (disposed) return;
      runtime.search?.replaceSource(
        "content",
        store.getSnapshot().map((p) => ({
          id: `content:${p.id}`,
          source: "content",
          kind: "content-project",
          title: p.title,
          body: `${p.question}\n${p.hypothesis}\n${p.evidence.map((e) => e.title).join("\n")}`,
          subtitle: "内容项目",
          route: `/content?project=${p.id}`,
          updatedAt: p.updatedAt,
        })),
      );
    };
    const unsubscribe = store.subscribe(publish);
    void Promise.all([store.ready, runtime.search?.ready]).then(publish, (error) => {
      if (!disposed) reportError(error);
    });
    return () => {
      disposed = true;
      unsubscribe();
      unregister();
    };
  },
};
