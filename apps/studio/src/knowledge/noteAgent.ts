import { complete, type AgentEndpoint } from "./agentRuntime";
import { changeFor, targetText, type EditProposal, type EditTarget } from "./edit";

/**
 * Turns an editing instruction into a proposed change for a note body.
 *
 * The model is asked to transform *text*, never to compute positions: it
 * returns the replacement for a range the caller already knows, and
 * {@link changeFor} narrows that to a minimal change. Models are unreliable at
 * offsets but reliable at rewriting a passage, so the split keeps the fragile
 * part (addressing) on the deterministic side.
 */

/** What the note should do with the model's output. */
export type AgentMode = "rewrite" | "continue";

export interface NoteEditRequest {
  readonly endpoint: AgentEndpoint;
  readonly mode: AgentMode;
  /** The user's instruction, e.g. "改成更简洁的表述". */
  readonly instruction: string;
  /** Note title, given to the model as context. */
  readonly title: string;
  /** The whole current body; the target range is resolved against it. */
  readonly body: string;
  readonly target: EditTarget;
}

/**
 * Markdown has no wrapper, but models habitually fence it. Stripping one outer
 * fence keeps a code block from being written into the note as literal text.
 */
function unfence(value: string): string {
  const trimmed = value.trim();
  const match = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/u.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

/** The system prompt. Deliberately narrow: this is an editor, not an assistant. */
const SYSTEM: Record<AgentMode, string> = {
  rewrite:
    "你是 Markdown 笔记编辑器。按用户指令改写给定正文，只输出改写后的 Markdown 正文本身。不要解释、不要复述指令、不要使用代码块围栏。保持原文的语言与 Markdown 结构；除非指令要求，不要增删标题层级。",
  continue:
    "你是 Markdown 笔记编辑器。按用户指令续写给定正文，只输出续写出来的 Markdown 内容本身，不要重复已有内容、不要解释、不要使用代码块围栏。风格与语言应与原文一致。",
};

function prompt(request: NoteEditRequest): string {
  const passage = targetText(request.body, request.target);
  const scope =
    request.target.kind === "document"
      ? "全文"
      : request.target.kind === "selection"
        ? "选中片段"
        : "光标位置";
  return [
    `笔记标题：${request.title || "未命名笔记"}`,
    `编辑范围：${scope}`,
    `指令：${request.instruction}`,
    "",
    "正文：",
    "<<<",
    passage,
    ">>>",
  ].join("\n");
}

/**
 * Ask the model for a change and hold it as a proposal.
 *
 * Nothing is written here: the caller decides whether to apply it, so a model
 * reply can never mutate a note on its own.
 */
export async function proposeNoteEdit(request: NoteEditRequest): Promise<EditProposal> {
  const content = await complete(request.endpoint, [
    { role: "system", content: SYSTEM[request.mode] },
    { role: "user", content: prompt(request) },
  ]);
  const replacement = unfence(content);
  if (!replacement) throw new Error("模型没有返回内容");
  return {
    base: request.body,
    changes: changeFor(request.body, request.target, replacement),
    summary: request.instruction,
  };
}
