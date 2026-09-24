import { textVersion } from "@bcr/core";
import type { AgentTool } from "@bcr/agent";
import { decodeNote, newNote, object, same, validId, type KnowledgeNote } from "./model";
import { noteRevision } from "./noteRevision";
import { noteEvidence } from "./retrieval";
import type { KnowledgeStore } from "./store";

const fields = {
  title: { type: "string", minLength: 1, maxLength: 500 },
  body: { type: "string", maxLength: 500000 },
  tags: { type: "array", maxItems: 100, items: { type: "string", maxLength: 100 } },
  collectionId: { type: ["string", "null"] },
};
const display = (note: KnowledgeNote, store: KnowledgeStore) =>
  `标题：${note.title}\n集合：${note.collectionId ? (store.getSnapshot().collections[note.collectionId]?.name ?? note.collectionId) : "未分组"}\n标签：${note.tags.join("、") || "无"}\n\n${note.body}`;

/** Domain writes stay independent of the editor and always pass the host approval gate. */
export function knowledgeWriteTools(
  store: KnowledgeStore,
  checkDraft: (id: string) => void = () => {},
): AgentTool[] {
  function check(id: string) {
    store.assertNoteWritable(id);
    checkDraft(id);
  }
  async function prepare(raw: string, creating: boolean) {
    await store.ready;
    const args = object(JSON.parse(raw));
    const keys = creating
      ? ["requestId", ...Object.keys(fields)]
      : ["id", "revision", ...Object.keys(fields)];
    if (Object.keys(args).some((key) => !keys.includes(key)))
      throw new Error("包含不支持的笔记字段");
    if (
      creating ? !validId(args.requestId) : !validId(args.id) || typeof args.revision !== "string"
    )
      throw new Error("缺少有效的请求 ID、笔记 ID 或 revision");
    const id = creating ? `agent-${textVersion(args.requestId as string)}` : (args.id as string);
    check(id);
    const current = store.getSnapshot().notes[id];
    if (!creating && (!current || noteRevision(current) !== args.revision))
      throw new Error("笔记版本已变化或已删除，请重新读取 revision 后修改");
    if (creating && (typeof args.title !== "string" || typeof args.body !== "string"))
      throw new Error("新建笔记必须提供标题和正文");
    if (!creating && !Object.keys(fields).some((key) => Object.hasOwn(args, key)))
      throw new Error("请提供要修改的字段");
    const patch = Object.fromEntries(
      Object.keys(fields)
        .filter((key) => Object.hasOwn(args, key))
        .map((key) => [key, args[key]]),
    );
    const base = creating ? { ...newNote(), id } : current!;
    const note = decodeNote({ ...base, ...patch, updatedAt: Date.now() });
    if (!note.title.trim()) throw new Error("笔记标题不能为空");
    if (
      note.collectionId !== null &&
      !Object.hasOwn(store.getSnapshot().collections, note.collectionId)
    )
      throw new Error("目标集合不存在或已删除");
    if (
      creating &&
      current &&
      !same({ ...note, createdAt: current.createdAt, updatedAt: current.updatedAt }, current)
    )
      throw new Error("创建请求已使用且内容不同，请核实原笔记，不要重复创建");
    return { note, current, revision: creating ? null : (args.revision as string) };
  }
  return [true, false].map((creating): AgentTool => ({
    presentation: {
      kind: "knowledge.note",
      version: 1,
      label: creating ? "创建知识库笔记" : "更新知识库笔记",
      approvalLabel: creating ? "创建笔记" : "保存修改",
    },
    spec: {
      name: creating ? "knowledge_create_note" : "knowledge_update_note",
      description: creating
        ? "Create and save a knowledge note from any workspace, after user approval. Supply a unique requestId (letters/digits/hyphens, max 100); reuse the SAME requestId and content if retrying this creation to avoid duplicate notes. Omit collectionId for ungrouped; never invent collection IDs. Only claim saved after a saved receipt."
        : "Update an existing knowledge note by ID after user approval. First read the note and use its latest full revision (NOT the body version). Supply only changed fields; body replaces the entire body, so read all pages first. Unspecified metadata and citations are preserved. Unsaved drafts, conflicts and stale revisions block writes. Never retry with a guessed revision.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...fields,
          ...(creating
            ? { requestId: { type: "string", minLength: 1, maxLength: 100 } }
            : { id: { type: "string" }, revision: { type: "string" } }),
        },
        required: creating ? ["requestId", "title", "body"] : ["id", "revision"],
      },
      risk: "high",
    },
    preview: async (raw) => {
      const { note, current } = await prepare(raw, creating);
      return {
        targetLabel: `${creating ? "创建" : "更新"}笔记：${note.title}`,
        before: current ? display(current, store) : "",
        after: display(note, store),
      };
    },
    call: async (raw, context) => {
      context?.signal?.throwIfAborted();
      const { note, revision } = await prepare(raw, creating);
      const saved = await store.saveAgentNote(note, revision, () => {
        context?.signal?.throwIfAborted();
        check(note.id);
      });
      return JSON.stringify({
        status: "saved",
        message: "已保存到本机",
        ...noteEvidence(saved),
        body: saved.body,
      });
    },
  }));
}
