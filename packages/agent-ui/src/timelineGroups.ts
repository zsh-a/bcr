import type { AgentPart, AgentToolPart } from "@bcr/agent";

export type TimelineGroup = AgentPart | { type: "activity"; id: string; tools: AgentToolPart[] };

/** Group only explicitly read-only calls. Text, errors, approvals and unknown risks are boundaries. */
export function timelineGroups(parts: readonly AgentPart[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  for (const part of parts) {
    if (
      part.type === "tool" &&
      part.risk === "read_only" &&
      !part.approval &&
      !part.result?.is_error
    ) {
      const previous = groups.at(-1);
      if (previous?.type === "activity") previous.tools.push(part);
      else groups.push({ type: "activity", id: part.id, tools: [part] });
    } else groups.push(part);
  }
  return groups;
}
