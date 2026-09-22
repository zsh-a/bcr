import type { AgentCapability } from "@bcr/agent";
import type { KnowledgeStore } from "./store";
import { readNotePage, noteSearchHit, searchKnowledge } from "./retrieval";

/** Knowledge access is independent of the editor being mounted or visible. */
export function knowledgeCapability(store: KnowledgeStore): AgentCapability {
  return {
    id: "knowledge.library",
    label: "知识库",
    description: "跨工作区查找和读取已保存的笔记",
    domain: "knowledge",
    scope: "shared",
    tools: [
      {
        presentation: { kind: "knowledge.search-results", version: 1, label: "检索知识库" },
        spec: {
          name: "knowledge_find_notes",
          description:
            "Find saved knowledge notes by text, ranked by title, tags and body. An empty query lists recent notes. Use nextOffset for more results. Returns matching passages, note IDs, versions, routes and source citations for knowledge_read_note.",
          input_schema: {
            type: "object",
            properties: {
              query: { type: "string", maxLength: 256 },
              offset: { type: "integer", minimum: 0 },
              collectionId: { type: "string" },
            },
            required: ["query"],
            additionalProperties: false,
          },
          risk: "read_only",
        },
        call: async (input, context) => {
          const args = JSON.parse(input) as {
            query?: unknown;
            offset?: unknown;
            collectionId?: unknown;
          };
          if (!args || typeof args.query !== "string" || args.query.length > 256)
            throw new Error("请输入不超过 256 字的查询");
          await store.ready;
          context?.signal?.throwIfAborted();
          const offset = args.offset ?? 0;
          if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)
            throw new Error("分页位置无效");
          if (args.collectionId !== undefined && typeof args.collectionId !== "string")
            throw new Error("集合 ID 无效");
          const result = searchKnowledge(Object.values(store.getSnapshot().notes), args.query, {
            offset,
            ...(typeof args.collectionId === "string" ? { collectionId: args.collectionId } : {}),
          });
          return JSON.stringify({
            total: result.total,
            nextOffset: result.nextOffset,
            notes: result.hits.map(({ note }) => noteSearchHit(note, args.query as string)),
          });
        },
      },
      {
        presentation: { kind: "knowledge.note", version: 1, label: "阅读笔记" },
        spec: {
          name: "knowledge_read_note",
          description:
            "Read a saved note by ID with provenance. Long notes use pages of 12000 characters; subsequent pages require nextOffset and the returned version. If the note changes, restart reading.",
          input_schema: {
            type: "object",
            properties: {
              id: { type: "string" },
              offset: { type: "integer", minimum: 0 },
              version: { type: "string" },
            },
            required: ["id"],
            additionalProperties: false,
          },
          risk: "read_only",
        },
        call: async (input, context) => {
          const args = JSON.parse(input) as { id?: unknown; offset?: unknown; version?: unknown };
          if (!args || typeof args.id !== "string") throw new Error("缺少笔记 ID");
          const offset = args.offset ?? 0;
          if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)
            throw new Error("读取位置无效");
          await store.ready;
          context?.signal?.throwIfAborted();
          const notes = store.getSnapshot().notes;
          const note = Object.hasOwn(notes, args.id) ? notes[args.id] : undefined;
          if (!note) throw new Error("笔记不存在或已删除");
          return JSON.stringify(readNotePage(note, args));
        },
      },
    ],
  };
}
