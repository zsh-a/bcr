import type { AgentCapability } from "@bcr/agent";
import type { KnowledgeStore } from "../session/store";
import { readNotePage, noteSearchHit, searchKnowledge } from "../search/retrieval";
import { knowledgeWriteTools } from "./agentWrites";
import { attachmentReferences } from "../attachments/attachmentModel";
import { canReadAttachmentText, readAttachmentText } from "../attachments/attachmentText";

/** Knowledge access is independent of the editor being mounted or visible. */
export function knowledgeCapability(
  store: KnowledgeStore,
  checkDraft?: (id: string) => void,
): AgentCapability {
  return {
    id: "knowledge.library",
    label: "知识库",
    description: "跨工作区检索和阅读笔记，确认后创建或更新知识库",
    domain: "knowledge",
    scope: "shared",
    tools: [
      ...knowledgeWriteTools(store, checkDraft),
      {
        spec: {
          name: "knowledge_list_attachments",
          description:
            "List saved attachment metadata and referencing note IDs. Optional noteId restricts to one saved note. Returns 50 records per page, without loading binary files.",
          risk: "read_only",
          input_schema: {
            type: "object",
            properties: { noteId: { type: "string" }, offset: { type: "integer", minimum: 0 } },
            additionalProperties: false,
          },
        },
        call: async (input, context) => {
          const args = JSON.parse(input) as { noteId?: unknown; offset?: unknown };
          if (!args || (args.noteId !== undefined && typeof args.noteId !== "string"))
            throw new Error("笔记 ID 无效");
          const offset = args.offset ?? 0;
          if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)
            throw new Error("附件分页位置无效");
          await store.ready;
          context?.signal?.throwIfAborted();
          const state = store.getSnapshot();
          if (args.noteId && !state.notes[args.noteId as string]) throw new Error("笔记不存在");
          const usage = new Map<string, string[]>();
          for (const note of Object.values(state.notes))
            for (const id of new Set(attachmentReferences(note.body).map((ref) => ref.id)))
              usage.set(id, [...(usage.get(id) ?? []), note.id]);
          const records = Object.values(state.attachments ?? {}).filter(
            (asset) => !args.noteId || usage.get(asset.id)?.includes(args.noteId as string),
          );
          return JSON.stringify({
            total: records.length,
            nextOffset: offset + 50 < records.length ? offset + 50 : null,
            attachments: records.slice(offset, offset + 50).map((asset) => ({
              ...asset,
              version: asset.hash,
              noteIds: usage.get(asset.id) ?? [],
              readableText: canReadAttachmentText(asset),
              ...(asset.mime.startsWith("image/") ? { ocrLanguages: ["en", "ja"] } : {}),
            })),
          });
        },
      },
      {
        spec: {
          name: "knowledge_read_attachment",
          description:
            "Read one attachment text page/section with source identity. Returns at most 12000 characters and nextOffset/nextPage. Pass version from knowledge_list_attachments. PDF/EPUB/DOCX use Reader adapters. Image OCR must be requested explicitly with ocr:true; current local models support English/Japanese, not Chinese. Binary images/media are never returned as base64.",
          risk: "read_only",
          input_schema: {
            type: "object",
            properties: {
              id: { type: "string" },
              version: { type: "string" },
              page: { type: "integer", minimum: 1 },
              offset: { type: "integer", minimum: 0 },
              ocr: { type: "boolean" },
              language: { type: "string", enum: ["en", "ja"] },
            },
            required: ["id", "version"],
            additionalProperties: false,
          },
        },
        call: async (input, context) => {
          const args = JSON.parse(input) as {
            id?: unknown;
            version?: unknown;
            page?: unknown;
            offset?: unknown;
            ocr?: unknown;
            language?: unknown;
          };
          if (
            !args ||
            typeof args.id !== "string" ||
            typeof args.version !== "string" ||
            (args.ocr !== undefined && typeof args.ocr !== "boolean") ||
            (args.language !== undefined && args.language !== "en" && args.language !== "ja")
          )
            throw new Error("附件读取参数无效");
          for (const field of ["page", "offset"] as const)
            if (
              args[field] !== undefined &&
              (typeof args[field] !== "number" ||
                !Number.isSafeInteger(args[field]) ||
                args[field] < (field === "page" ? 1 : 0))
            )
              throw new Error("附件分页位置无效");
          await store.ready;
          context?.signal?.throwIfAborted();
          const asset = store.getSnapshot().attachments?.[args.id];
          if (!asset) throw new Error("附件不存在");
          if (args.version !== asset.hash) throw new Error("附件版本已变化，请重新读取清单");
          return JSON.stringify(
            await readAttachmentText(store, asset, {
              ...(args.page === undefined ? {} : { page: args.page as number }),
              ...(args.offset === undefined ? {} : { offset: args.offset as number }),
              ...(args.ocr === undefined ? {} : { ocr: args.ocr as boolean }),
              ...(args.language === undefined ? {} : { language: args.language as "en" | "ja" }),
              ...(context?.signal ? { signal: context.signal } : {}),
            }),
          );
        },
      },
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
