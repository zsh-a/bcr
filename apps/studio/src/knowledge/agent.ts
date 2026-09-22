import type { AgentCapability } from "@bcr/agent";
import type { KnowledgeStore } from "./store";

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
        spec: {
          name: "knowledge_find_notes",
          description:
            "Find saved knowledge notes by text. An empty query lists recent notes. Returns note IDs for knowledge_read_note.",
          input_schema: {
            type: "object",
            properties: { query: { type: "string", maxLength: 256 } },
            required: ["query"],
            additionalProperties: false,
          },
          risk: "read_only",
        },
        call: async (input) => {
          const args = JSON.parse(input) as { query?: unknown };
          if (!args || typeof args.query !== "string" || args.query.length > 256)
            throw new Error("请输入不超过 256 字的查询");
          await store.ready;
          const query = args.query.trim().toLocaleLowerCase();
          const notes = Object.values(store.getSnapshot().notes)
            .filter((note) =>
              `${note.title}\n${note.tags.join(" ")}\n${note.body}`
                .toLocaleLowerCase()
                .includes(query),
            )
            .sort((a, b) => b.updatedAt - a.updatedAt);
          return JSON.stringify({
            total: notes.length,
            notes: notes.slice(0, 20).map((note) => ({
              id: note.id,
              title: note.title,
              tags: note.tags,
              preview: note.body.slice(0, 240),
            })),
          });
        },
      },
      {
        spec: {
          name: "knowledge_read_note",
          description:
            "Read a saved note by ID. Long notes are returned in pages of 12000 characters; use nextOffset to continue.",
          input_schema: {
            type: "object",
            properties: { id: { type: "string" }, offset: { type: "integer", minimum: 0 } },
            required: ["id"],
            additionalProperties: false,
          },
          risk: "read_only",
        },
        call: async (input) => {
          const args = JSON.parse(input) as { id?: unknown; offset?: unknown };
          if (!args || typeof args.id !== "string") throw new Error("缺少笔记 ID");
          const offset = args.offset ?? 0;
          if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)
            throw new Error("读取位置无效");
          await store.ready;
          const note = store.getSnapshot().notes[args.id];
          if (!note) throw new Error("笔记不存在或已删除");
          return JSON.stringify({
            id: note.id,
            title: note.title,
            body: note.body.slice(offset, offset + 12000),
            totalLength: note.body.length,
            nextOffset: offset + 12000 < note.body.length ? offset + 12000 : null,
          });
        },
      },
    ],
  };
}
