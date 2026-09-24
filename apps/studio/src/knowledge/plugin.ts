import type { WorkspacePlugin } from "@bcr/shell-contract";
import { createKnowledgePublisher } from "./search";
import { workspaceServices } from "../workspace";
import { knowledgeCapability } from "./agent";
import { knowledgeResultRenderers } from "./agentRenderers";

export const knowledgePlugin: WorkspacePlugin = {
  id: "knowledge",
  agentRenderers: knowledgeResultRenderers,
  activate({ runtime: { metadata, search }, agent, reportError }) {
    const store = workspaceServices(metadata).knowledge;
    const unregister = agent.registerAgentCapability(
      knowledgeCapability(store, (id) => {
        // Includes recoverable drafts whose editor is not mounted. Fail closed if storage is unavailable.
        if (localStorage.getItem(`bcr/knowledge-draft/v1/${id}`) !== null)
          throw new Error("笔记有本地恢复草稿，请先打开笔记并保存或处理草稿");
      }),
    );
    let disposed = false;
    let ready = false;
    const publisher = search ? createKnowledgePublisher(search) : undefined;
    const publish = () => {
      if (!disposed && ready) publisher?.publish(store.getSnapshot());
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
