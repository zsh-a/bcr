import type { WorkspacePlugin } from "@bcr/shell-contract";

export const workspaceSearchPlugin: WorkspacePlugin = {
  id: "workspace.search",
  activate({ runtime: { search }, agent }) {
    if (!search) return () => {};
    return agent.registerAgentCapability({
      id: "workspace.search",
      label: "跨域搜索",
      description: "搜索各工作区已索引的文件、资料、市场标的和任务",
      scope: "shared",
      tools: [
        {
          spec: {
            name: "workspace_search",
            description:
              "Search indexed workspace content across domains. Results are local indexed snapshots, not live external data; include their source and route in answers.",
            input_schema: {
              type: "object",
              properties: { query: { type: "string", minLength: 1, maxLength: 256 } },
              required: ["query"],
              additionalProperties: false,
            },
            risk: "read_only",
          },
          call: async (input) => {
            const args = JSON.parse(input) as { query?: unknown };
            if (
              !args ||
              typeof args.query !== "string" ||
              !args.query.trim() ||
              args.query.length > 256
            )
              throw new Error("请输入 1–256 字的查询");
            await search.ready;
            return JSON.stringify(
              search.search(args.query, { limit: 12 }).map(({ document, snippet }) => ({
                title: document.title,
                source: document.source,
                kind: document.kind,
                snippet,
                route: document.route,
                updatedAt: document.updatedAt,
              })),
            );
          },
        },
      ],
    });
  },
};
