import { useCallback, useMemo, useRef } from "react";
import {
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadAssistantMessagePart,
} from "@assistant-ui/react";
import { textVersion } from "@bcr/core";
import {
  activeSurface,
  editMessages,
  isCurrent,
  resolveEdit,
  runAgentLoop,
  type AgentTool,
  type TextEditMode,
  type TextEditSuggestion,
  type ToolCall,
  type ToolDecision,
} from "@bcr/agent";
import { useAgent } from "./agent";

/**
 * The agent chat, driven through assistant-ui's `LocalRuntime`.
 *
 * The adapter is the single seam: assistant-ui owns the thread, composer,
 * scrolling and message rendering, while this file owns only what a model call
 * means for a BCR surface. Each turn runs the real loop, so the model may call
 * the surface's tools, read their results and continue — an edit is one tool
 * among them, not the only thing a turn can produce.
 */

/** The tool whose call renders the approval card. */
export const SURFACE_EDIT_TOOL = "apply_text_edit";

/** How often accumulated text is pushed into the thread while streaming. */
const STREAM_FRAME_MS = 120;

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // A tool that answers in prose is still an answer.
    return value;
  }
}

/**
 * A write waiting for the user.
 *
 * The turn holds until the host answers, so applying is a decision rather than
 * an effect of the model talking. Refusing reports back as a tool error, which
 * lets the model ask instead of failing silently.
 */
export interface PendingApproval {
  readonly call: ToolCall;
  /** Resolve with the applied text, or `null` to refuse. */
  readonly settle: (applied: string | null) => void;
  /** The change, addressed against the surface that is active now. */
  readonly suggestion: TextEditSuggestion | null;
}

/** The change a tool call asks for, resolved against the live surface. */
function suggestionFrom(call: ToolCall): TextEditSuggestion | null {
  const input = call.input as { replacement?: unknown } | null;
  const replacement =
    typeof input === "object" && input !== null && typeof input.replacement === "string"
      ? input.replacement
      : null;
  return replacement === null ? null : suggestionFor(replacement);
}

export function asSuggestion(args: unknown): TextEditSuggestion | null {
  if (typeof args !== "object" || args === null) return null;
  const value = args as Partial<TextEditSuggestion>;
  if (typeof value.replacement !== "string" || typeof value.baseVersion !== "string") return null;
  const range = value.range;
  if (typeof range?.start !== "number" || typeof range.end !== "number") return null;
  return {
    baseVersion: value.baseVersion,
    range: { start: range.start, end: range.end },
    replacement: value.replacement,
    summary: typeof value.summary === "string" ? value.summary : "",
  };
}

/** The instruction the user typed, taken from the newest user turn. */
function instructionFrom(
  messages: readonly { role: string; content: readonly unknown[] }[],
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = message.content
      .flatMap((part) =>
        typeof part === "object" && part !== null && (part as { type?: string }).type === "text"
          ? [(part as { text?: string }).text ?? ""]
          : [],
      )
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function toolName(tool: AgentTool): string {
  const spec = tool.spec as { name?: unknown };
  return typeof spec?.name === "string" ? spec.name : "";
}

/**
 * Apply a suggestion to whatever surface is active now.
 *
 * Resolution happens against the surface's *current* text, so a suggestion
 * proposed before the user kept typing is refused rather than written into text
 * it no longer describes.
 */
function applySuggestion(suggestion: TextEditSuggestion): string {
  const surface = activeSurface();
  const target = surface?.read() ?? null;
  if (surface === null || target === null) return "目标已关闭，未写入";
  if (!isCurrent(suggestion, target.text)) return "内容已变化，这次改动已丢弃（没有写入）";
  const next = resolveEdit(target.text, suggestion);
  if (next === null) return "没有需要写入的变化";
  surface.write(next);
  return "已应用；原文保留在历史中";
}

/**
 * The edit tool: the one capability every surface gets for free.
 *
 * Its input is only the replacement text. The range and the version come from
 * the surface being edited, because a model cannot know character offsets
 * reliably — addressing is the host's job, and keeping it there is what makes a
 * model-authored edit land in the right place.
 */
export function surfaceEditTool(): AgentTool {
  return {
    spec: {
      name: SURFACE_EDIT_TOOL,
      description: "Replace the passage being edited with revised text. Requires user approval.",
      input_schema: {
        type: "object",
        properties: { replacement: { type: "string" } },
        required: ["replacement"],
      },
      risk: "high",
    },
    call: async (inputJson: string) => {
      const input = parseJson(inputJson) as { replacement?: unknown };
      if (typeof input !== "object" || typeof input.replacement !== "string")
        return JSON.stringify({ error: "改动数据无效" });
      const suggestion = suggestionFor(input.replacement);
      if (suggestion === null) return JSON.stringify({ error: "当前没有可编辑的目标" });
      return JSON.stringify({ status: applySuggestion(suggestion) });
    },
  };
}

/** A suggestion for `replacement`, addressed against the active surface. */
export function suggestionFor(
  replacement: string,
  summary = "修改选中的正文",
): TextEditSuggestion | null {
  const surface = activeSurface();
  const target = surface?.read() ?? null;
  if (target === null) return null;
  return {
    baseVersion: textVersion(target.text),
    range: target.range,
    replacement,
    summary,
  };
}

export function useAgentChat(mode: TextEditMode) {
  const { endpoint } = useAgent();
  // The composer supplies the instruction, so the mode only has to be current
  // when a run starts; a ref keeps a mode change from rebuilding the runtime.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  /**
   * Approvals raised by the running loop, delivered to the panel.
   *
   * The loop starts inside the adapter, outside React's render cycle, so the
   * sink is a stable ref the panel registers rather than React state.
   */
  const sink = useRef<((approval: PendingApproval | null) => void) | null>(null);
  const subscribeApproval = useCallback((listener: (approval: PendingApproval | null) => void) => {
    sink.current = listener;
    return () => {
      if (sink.current === listener) sink.current = null;
    };
  }, []);

  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }) {
        const surface = activeSurface();
        const target = surface?.read() ?? null;
        if (surface === null || target === null) {
          yield {
            content: [
              { type: "text", text: "当前没有可编辑的目标。先打开要修改的内容，再回到这里。" },
            ],
          };
          return;
        }
        const instruction = instructionFrom(messages);
        if (!instruction) {
          yield { content: [{ type: "text", text: "请说明要如何修改。" }] };
          return;
        }

        const tools = [...(surface.tools ?? []), surfaceEditTool()];
        let streamed = "";
        let rendered = "";
        let settled = false;
        let failure: string | null = null;

        const decide: ToolDecision = async (call, tool) => {
          // Tools the surface contributed run on their own; only the edit tool
          // carries a write, so only it stops for a decision.
          if (tool !== undefined && toolName(tool) !== SURFACE_EDIT_TOOL) {
            return {
              tool_call_id: call.id,
              tool_name: call.name,
              output: parseJson(await tool.call(JSON.stringify(call.input ?? {}))),
            };
          }
          const { promise, resolve } = Promise.withResolvers<string | null>();
          const suggestion = suggestionFrom(call);
          sink.current?.({ call, settle: resolve, suggestion });
          const replacement = await promise;
          sink.current?.(null);
          if (replacement === null) return { reject: "用户未批准这次修改" };
          const outcome = applySuggestion({
            ...(suggestion ?? { baseVersion: "", range: { start: 0, end: 0 }, summary: "" }),
            replacement,
          });
          return { tool_call_id: call.id, tool_name: call.name, output: { status: outcome } };
        };

        const loop = runAgentLoop(
          endpoint,
          editMessages({
            endpoint,
            mode: modeRef.current,
            instruction,
            text: target.text,
            range: target.range,
            label: surface.label,
          }),
          {
            tools,
            signal: abortSignal,
            decide,
            onDelta: (chunk) => {
              streamed += chunk;
            },
          },
        );

        void loop.then(
          () => {
            settled = true;
          },
          (error: unknown) => {
            failure = String(error);
            settled = true;
          },
        );

        while (!settled) {
          if (streamed !== rendered) {
            rendered = streamed;
            yield { content: [{ type: "text", text: rendered }] };
          }
          await delay(STREAM_FRAME_MS);
        }

        if (failure !== null) throw new Error(failure);
        const result = await loop;
        const content: ThreadAssistantMessagePart[] = [];
        if (result.text.trim()) content.push({ type: "text", text: result.text.trim() });
        // A turn that only talked still belongs in the transcript.
        if (content.length === 0) content.push({ type: "text", text: "（本次没有产出文本）" });
        yield { content };
      },
    }),
    [endpoint],
  );

  return { runtime: useLocalRuntime(adapter), subscribeApproval };
}

export { textVersion };
