/** The risk declared on a `ToolSpec`, which drives whether a human must approve. */
export type ToolRisk = "read_only" | "low" | "medium" | "high";

/** Read a tool's name and risk out of a `ToolSpec` without trusting its shape. */
export function toolSpecOf(spec: unknown): { name: string; risk: ToolRisk } {
  const value = (typeof spec === "object" && spec !== null ? spec : {}) as {
    name?: unknown;
    risk?: unknown;
  };
  const risk =
    typeof value.risk === "string" &&
    (["read_only", "low", "medium", "high"] as const).includes(
      value.risk as (typeof riskValues)[number],
    )
      ? (value.risk as ToolRisk)
      : "high";
  return { name: typeof value.name === "string" ? value.name : "", risk };
}

const riskValues = ["read_only", "low", "medium", "high"] as const;

/**
 * Whether executing this tool needs a human to approve it.
 *
 * Decided from the declared risk, not from a hard-coded list of names: any tool
 * that can write is gated, and a new tool a domain adds later is gated by the
 * same rule without the chat learning about it.
 */
export function requiresApproval(spec: unknown): boolean {
  return toolSpecOf(spec).risk !== "read_only";
}
