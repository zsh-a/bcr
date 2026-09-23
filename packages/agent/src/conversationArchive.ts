import type { AgentConversation, AgentPart, ConversationArchive } from "./conversationTypes";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const states = [
  "idle",
  "running",
  "awaiting_approval",
  "completed",
  "round_limit",
  "cancelled",
  "failed",
  "interrupted",
];
function validPart(value: unknown): value is AgentPart {
  if (!object(value) || !string(value.id)) return false;
  if (value.type === "text") return string(value.text);
  if (
    value.type !== "tool" ||
    !object(value.call) ||
    !string(value.call.id) ||
    !string(value.call.name)
  )
    return false;
  if (
    value.result !== undefined &&
    (!object(value.result) ||
      value.result.tool_call_id !== value.call.id ||
      !string(value.result.tool_name))
  )
    return false;
  if (
    value.presentation !== undefined &&
    (!object(value.presentation) ||
      !string(value.presentation.kind) ||
      !Number.isSafeInteger(value.presentation.version) ||
      !string(value.presentation.label) ||
      (value.presentation.approvalLabel !== undefined && !string(value.presentation.approvalLabel)))
  )
    return false;
  if (
    value.risk !== undefined &&
    (typeof value.risk !== "string" || !["read_only", "low", "medium", "high"].includes(value.risk))
  )
    return false;
  if (value.approval !== undefined) {
    const a = value.approval;
    if (
      object(a) &&
      a.preview !== undefined &&
      (!object(a.preview) || !string(a.preview.before) || !string(a.preview.after))
    )
      return false;
    if (
      !object(a) ||
      !object(a.call) ||
      a.call.id !== value.call.id ||
      !string(a.original) ||
      !string(a.targetLabel) ||
      !["pending", "approved", "denied", "expired"].includes(String(a.decision))
    )
      return false;
    if (
      a.suggestion !== null &&
      (!object(a.suggestion) ||
        !string(a.suggestion.replacement) ||
        !string(a.suggestion.baseVersion) ||
        !object(a.suggestion.range) ||
        !Number.isInteger(a.suggestion.range.start) ||
        !Number.isInteger(a.suggestion.range.end))
    )
      return false;
  }
  return true;
}
/** Invalid archives are left untouched; recovery never executes saved tool calls. */
export function restoreConversationArchive(value: unknown): ConversationArchive {
  if (
    !object(value) ||
    value.version !== 1 ||
    !string(value.activeId) ||
    !Array.isArray(value.conversations)
  )
    throw new Error("不支持或已损坏的会话存档");
  const ids = new Set<string>();
  for (const conversation of value.conversations) {
    if (
      !object(conversation) ||
      !string(conversation.id) ||
      ids.has(conversation.id) ||
      !string(conversation.title) ||
      !string(conversation.draft) ||
      typeof conversation.createdAt !== "number" ||
      !Array.isArray(conversation.runs)
    )
      throw new Error("会话存档格式无效");
    ids.add(conversation.id);
    const runs = new Set<string>();
    for (const run of conversation.runs) {
      if (
        !object(run) ||
        !string(run.id) ||
        runs.has(run.id) ||
        !string(run.input) ||
        !string(run.workspace) ||
        typeof run.startedAt !== "number" ||
        !states.includes(String(run.status)) ||
        !(run.error === null || string(run.error)) ||
        !Array.isArray(run.parts) ||
        !run.parts.every(validPart) ||
        new Set(run.parts.map((p) => p.id)).size !== run.parts.length
      )
        throw new Error("执行记录格式无效");
      runs.add(run.id);
    }
  }
  if (!ids.has(value.activeId)) throw new Error("会话索引无效");
  const conversations = (value.conversations as unknown as AgentConversation[]).map(
    (conversation) => ({
      ...conversation,
      runs: conversation.runs.map((run) => ({
        ...run,
        status:
          run.status === "running" || run.status === "awaiting_approval"
            ? ("interrupted" as const)
            : run.status,
        parts: run.parts.map((part) =>
          part.type === "tool" && part.approval?.decision === "pending"
            ? { ...part, approval: { ...part.approval, decision: "expired" as const } }
            : part,
        ),
      })),
    }),
  );
  return { version: 1, activeId: value.activeId, conversations };
}
