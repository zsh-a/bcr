import { textVersion } from "@bcr/core";
import type { AgentHostServices } from "./host";
import type { ToolCall } from "./loop";
import type { AgentTool } from "./runtime";
import { isCurrent, resolveEdit, type TextEditSuggestion } from "./suggestion";
export const SURFACE_EDIT_TOOL = "apply_text_edit";

/** The change a tool call asks for, resolved against the live surface. */
export function suggestionFrom(
  call: ToolCall,
  target: { text: string; range: { start: number; end: number } } | null,
): TextEditSuggestion | null {
  const input = call.input as { replacement?: unknown } | null;
  const replacement =
    typeof input === "object" && input !== null && typeof input.replacement === "string"
      ? input.replacement
      : null;
  return replacement === null || target === null
    ? null
    : {
        baseVersion: textVersion(target.text),
        range: target.range,
        replacement,
        summary: "修改当前内容",
      };
}

/**
 * Apply a suggestion to whatever surface is active now.
 *
 * Resolution happens against the surface's *current* text, so a suggestion
 * proposed before the user kept typing is refused rather than written into text
 * it no longer describes.
 */
export async function applySuggestion(
  host: AgentHostServices,
  suggestion: TextEditSuggestion,
  surface = host.activeSurface(),
): Promise<{ status: "saved" | "unchanged"; message: string; id?: string; version?: string }> {
  if (surface !== host.activeSurface()) throw new Error("目标已切换，未写入");
  const target = surface?.read() ?? null;
  if (surface === null || target === null) throw new Error("目标已关闭，未写入");
  if (!isCurrent(suggestion, target.text))
    throw new Error("内容已变化，这次改动已丢弃（没有写入）");
  const next = resolveEdit(target.text, suggestion);
  if (next === null) return { status: "unchanged", message: "没有需要写入的变化" };
  const receipt = await surface.write(next);
  return { status: "saved", message: "已保存到本机", ...receipt };
}

/**
 * The edit tool: the one capability every surface gets for free.
 *
 * Its input is only the replacement text. The range and the version come from
 * the surface being edited, because a model cannot know character offsets
 * reliably — addressing is the host's job, and keeping it there is what makes a
 * model-authored edit land in the right place.
 */
export function surfaceEditTool(host: AgentHostServices): AgentTool {
  return {
    presentation: { kind: "document.change-set", version: 1, label: "修改内容" },
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
      const input = JSON.parse(inputJson) as { replacement?: unknown } | null;
      if (input === null || typeof input !== "object" || typeof input.replacement !== "string")
        return JSON.stringify({ error: "改动数据无效" });
      const suggestion = suggestionFor(host, input.replacement);
      if (suggestion === null) return JSON.stringify({ error: "当前没有可编辑的目标" });
      return JSON.stringify(await applySuggestion(host, suggestion));
    },
  };
}

/** A suggestion for `replacement`, addressed against the active surface. */
function suggestionFor(
  host: AgentHostServices,
  replacement: string,
  summary = "修改选中的正文",
): TextEditSuggestion | null {
  const surface = host.activeSurface();
  const target = surface?.read() ?? null;
  if (target === null) return null;
  return {
    baseVersion: textVersion(target.text),
    range: target.range,
    replacement,
    summary,
  };
}
