import { complete, type AgentEndpoint, type AgentMessage } from "./runtime";
import type { TextRange } from "@bcr/core";
import { suggestRange, textInRange, type TextEditSuggestion } from "./suggestion";

/**
 * Turning an instruction into a suggestion, for text that is marked up with
 * Markdown.
 *
 * The model is asked to transform *text*, never to compute positions: it
 * returns the replacement for a range the caller already knows, and
 * {@link suggestRange} narrows that to the minimal edit. Models are unreliable
 * at offsets and reliable at rewriting a passage, so the fragile part
 * (addressing) stays on the deterministic side.
 *
 * Domains supply their own `system` prompt when Markdown is the wrong shape —
 * an OCR block or a subtitle line is still just text.
 */

/** What the text should do with the model's output. */
export type TextEditMode = "rewrite" | "continue";

export interface TextEditRequest {
  readonly endpoint: AgentEndpoint;
  readonly mode: TextEditMode;
  /** The user's instruction, e.g. "改成更简洁的表述". */
  readonly instruction: string;
  /** The whole current text; the range is resolved against it. */
  readonly text: string;
  readonly range: TextRange;
  /** Optional heading for context, e.g. a note title. */
  readonly label?: string;
  /** Overrides the default Markdown prompts. */
  readonly system?: Partial<Record<TextEditMode, string>>;
}

/**
 * Markdown has no wrapper, but models habitually fence it. Stripping one outer
 * fence keeps a code block from being written as literal text.
 */
export function unfence(value: string): string {
  const trimmed = value.trim();
  const match = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/u.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

const SYSTEM: Record<TextEditMode, string> = {
  rewrite:
    "你是 Markdown 编辑助手。按指令改写给定正文，只输出改写后的 Markdown 正文本身。不要解释、不要复述指令、不要使用代码块围栏。保持原文的语言与 Markdown 结构；除非指令要求，不要增删标题层级。",
  continue:
    "你是 Markdown 编辑助手。按指令续写给定正文，只输出续写出来的 Markdown 内容本身，不要重复已有内容、不要解释、不要使用代码块围栏。风格与语言应与原文一致。",
};

export function editMessages(request: TextEditRequest): readonly AgentMessage[] {
  const { start, end } = request.range;
  const scope = start === end ? "光标位置" : `片段 ${start}–${end}`;
  return [
    { role: "system", content: request.system?.[request.mode] ?? SYSTEM[request.mode] },
    {
      role: "user",
      content: [
        ...(request.label === undefined ? [] : [`标题：${request.label}`]),
        `范围：${scope}`,
        `指令：${request.instruction}`,
        "",
        "正文：",
        "<<<",
        textInRange(request.text, request.range),
        ">>>",
      ].join("\n"),
    },
  ];
}

/**
 * Ask the model for an edit and hold it as a suggestion.
 *
 * Nothing is written here: the caller decides whether to apply it, so a model
 * reply can never mutate a document on its own.
 */
export async function proposeTextEdit(
  request: TextEditRequest,
  onDelta?: (chunk: string) => void,
): Promise<TextEditSuggestion> {
  const content = await complete(
    request.endpoint,
    editMessages(request),
    onDelta === undefined ? {} : { onDelta },
  );
  const replacement = unfence(content);
  if (!replacement) throw new Error("模型没有返回内容");
  return suggestRange(
    request.text,
    request.range.start,
    request.range.end,
    replacement,
    request.instruction,
  );
}
