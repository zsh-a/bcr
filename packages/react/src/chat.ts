import { useMemo, useRef } from "react";
import {
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadAssistantMessagePart,
} from "@assistant-ui/react";
import { textVersion } from "@bcr/core";
import {
  activeSurface,
  complete,
  editMessages,
  isCurrent,
  resolveEdit,
  type TextEditMode,
  type TextEditSuggestion,
} from "@bcr/agent";
import { useAgent } from "./agent";

/**
 * The agent chat, driven through assistant-ui's `LocalRuntime`.
 *
 * The adapter is the single seam: assistant-ui owns the thread, composer,
 * scrolling and message rendering, while this file owns only what a model call
 * means for a BCR surface. An edit arrives as a tool-call part rather than
 * prose, so the thread renders it as a card with an explicit apply step — the
 * model still cannot change a document by talking about it.
 */

/** The synthesized tool whose part renders the edit card. */
export const SURFACE_EDIT_TOOL = "apply_text_edit";

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Where the present is pushed into the thread while the model is still writing. */
const STREAM_FRAME_MS = 120;

function asSuggestion(args: unknown): TextEditSuggestion | null {
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

export function useAgentChat(mode: TextEditMode) {
  const { endpoint } = useAgent();
  // The composer supplies the instruction, so the mode only has to be current
  // when a run starts; a ref keeps a mode change from rebuilding the runtime.
  const modeRef = useRef(mode);
  modeRef.current = mode;

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

        // The request runs while cumulative content is yielded, which is the
        // contract this generator has: each yield replaces the previous content.
        let streamed = "";
        let rendered = "";
        let settled = false;
        const request = complete(
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
            signal: abortSignal,
            onDelta: (chunk) => {
              streamed += chunk;
            },
          },
        ).finally(() => {
          settled = true;
        });

        while (!settled) {
          // Only yield on change; identical frames would re-render for nothing.
          if (streamed !== rendered) {
            rendered = streamed;
            yield { content: [{ type: "text", text: rendered }] };
          }
          await delay(STREAM_FRAME_MS);
        }

        // `complete` rejects on failure, which assistant-ui renders as an error.
        const content = (await request).trim();
        if (!content) {
          yield { content: [{ type: "text", text: "模型没有返回内容。" }] };
          return;
        }
        const suggestion: TextEditSuggestion = {
          // The version of the text this was computed from, checked at apply time.
          baseVersion: textVersion(target.text),
          range: target.range,
          replacement: content,
          summary: instruction,
        };
        const args = { ...suggestion } as Record<string, unknown>;
        yield {
          content: [
            {
              type: "tool-call",
              toolCallId: `edit-${Date.now().toString(36)}`,
              toolName: SURFACE_EDIT_TOOL,
              args,
              argsText: JSON.stringify(args),
            },
            { type: "text", text: "确认后应用到目标；应用前的版本会保留。" },
          ] as readonly ThreadAssistantMessagePart[],
        };
      },
    }),
    [endpoint],
  );

  return useLocalRuntime(adapter);
}

/**
 * Apply an edit card's suggestion to whatever surface is active now.
 *
 * Resolution happens against the surface's *current* text, so a suggestion
 * proposed before the user kept typing is refused here rather than written into
 * text it no longer describes. Returns a human-readable outcome.
 */
export function applySurfaceEdit(args: unknown): string {
  const suggestion = asSuggestion(args);
  if (suggestion === null) return "改动数据无效";
  const surface = activeSurface();
  const target = surface?.read() ?? null;
  if (surface === null || target === null) return "目标已关闭，未写入";
  if (!isCurrent(suggestion, target.text)) return "内容已变化，这次改动已丢弃（没有写入）";
  const next = resolveEdit(target.text, suggestion);
  if (next === null) return "没有需要写入的变化";
  surface.write(next);
  return "已应用；原文保留在历史中";
}
