import type { WorkspacePlugin } from "@bcr/shell-contract";
import { createKnowledgePublisher } from "./search/search";
import { workspaceServices } from "../workspace";
import { knowledgeCapability } from "./agent/agent";
import { knowledgeResultRenderers } from "./agent/agentRenderers";
import { draftStorageKey } from "./editor/draft";

export const knowledgePlugin: WorkspacePlugin = {
  id: "knowledge",
  agentRenderers: knowledgeResultRenderers,
  activate({ runtime, agent, reportError }) {
    const { search } = runtime;
    const store = workspaceServices(runtime).knowledge;
    const unregister = agent.registerAgentCapability(
      knowledgeCapability(store, (id) => {
        // Includes recoverable drafts whose editor is not mounted. Fail closed if storage is unavailable.
        if (localStorage.getItem(draftStorageKey(id)) !== null)
          throw new Error("笔记有本地恢复草稿，请先打开笔记并保存或处理草稿");
      }),
    );
    let disposed = false;
    const publisher = search ? createKnowledgePublisher(search) : undefined;
    const publish = () => {
      void Promise.all([store.ready, search?.ready]).then(
        () => {
          if (!disposed) {
            publisher?.publish(store.getSnapshot());
            reportError(undefined);
          }
        },
        (error: unknown) => {
          if (!disposed) reportError(error);
        },
      );
    };
    const unsubscribe = store.subscribe(publish);
    publish();
    return () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      unregister();
    };
  },
};
