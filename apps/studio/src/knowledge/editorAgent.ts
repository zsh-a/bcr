import { textVersion } from "@bcr/core";
import type { AgentCapability, AgentSurface } from "@bcr/agent";
import type { NoteDraft } from "./draft";
import { readNotePage } from "./retrieval";

export type NoteSelection = { from: number; to: number } | null;
/** Stable tool/surface identities read live state; selection changes never re-register tools. */
export function createNoteAgent(
  controller: NoteDraft,
  current: () => { active: boolean; selection: NoteSelection },
) {
  const surface: AgentSurface = {
    kind: "knowledge.note",
    capabilityId: "knowledge.note",
    get label() {
      return controller.getSnapshot().note.title || "未命名笔记";
    },
    read() {
      if (!controller.editable || !current().active) return null;
      const body = controller.getSnapshot().note.body,
        target = current().selection;
      const selection =
        target && target.from >= 0 && target.from < target.to && target.to <= body.length
          ? target
          : null;
      const at =
        target && target.from >= 0 && target.from <= body.length ? target.from : body.length;
      const range = selection ?? { from: at, to: at };
      return {
        text: body,
        range: { start: range.from, end: range.to },
        instruction: body.slice(range.from, range.to) || "（光标处）",
        scope: selection ? `选中 ${selection.to - selection.from} 字符` : "在光标处插入",
      };
    },
    async write(next) {
      controller.change({ body: next });
      await controller.flush();
      const saved = controller.getSnapshot().note;
      return { id: saved.id, version: textVersion(saved.body) };
    },
  };
  const capability: AgentCapability = {
    id: "knowledge.note",
    label: "知识库笔记",
    description: "读取当前笔记与选区，确认后修改正文",
    domain: "knowledge",
    scope: "workspace",
    available: () => current().active,
    tools: [
      {
        spec: {
          name: "read_note",
          description:
            "Read the open note's current draft in pages of 12000 characters. Subsequent pages require nextOffset and version from the first page.",
          input_schema: {
            type: "object",
            properties: { offset: { type: "integer", minimum: 0 }, version: { type: "string" } },
          },
          risk: "read_only",
        },
        call: async (input) =>
          JSON.stringify({
            ...readNotePage(controller.getSnapshot().note, JSON.parse(input)),
            state: "draft",
          }),
      },
      {
        spec: {
          name: "read_selection",
          description: "Read the passage the user has selected in the open note.",
          input_schema: { type: "object" },
          risk: "read_only",
        },
        call: async () => {
          const target = surface.read();
          const selection = target?.text.slice(target.range.start, target.range.end) ?? "";
          return JSON.stringify({
            selection: selection.slice(0, 12000),
            truncated: selection.length > 12000,
            version: textVersion(controller.getSnapshot().note.body),
            state: "draft",
          });
        },
      },
    ],
  };
  return { surface, capability };
}
