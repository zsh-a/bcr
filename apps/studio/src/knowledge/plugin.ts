import type { WorkspacePlugin } from "@bcr/shell-contract";
import { publishKnowledge } from "./search";
import { workspaceServices } from "../workspace";
import { knowledgeCapability } from "./agent";

export const knowledgePlugin: WorkspacePlugin = {
  id: "knowledge",
  activate({ runtime: { metadata, search }, agent, reportError }) {
    const store = workspaceServices(metadata).knowledge;
    const unregister = agent.registerAgentCapability(knowledgeCapability(store));
    let disposed = false;
    let ready = false;
    const publish = () => {
      if (!disposed && ready && search) publishKnowledge(search, store.getSnapshot());
    };
    const unsubscribe = store.subscribe(publish);
    void Promise.all([store.ready, search?.ready])
      .then(() => {
        ready = true;
        publish();
      })
      .catch((error: unknown) => {
        if (!disposed) reportError(error);
      });
    return () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      unregister();
    };
  },
};
