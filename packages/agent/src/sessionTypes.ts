import type { ToolCall } from "./loop";
import type { TextEditSuggestion } from "./suggestion";

export interface PendingApproval {
  readonly call: ToolCall;
  readonly settle: (approved: boolean) => void;
  /** The change, addressed against the surface that is active now. */
  readonly suggestion: TextEditSuggestion | null;
  readonly original: string;
  readonly targetLabel: string;
}

export interface AgentSessionOptions {
  readonly workspaceId: string;
  readonly workspaceLabel: string;
  readonly includeContext: boolean;
  readonly disabledCapabilities: readonly string[];
}

export interface AgentSessionSnapshot {
  readonly status:
    | "idle"
    | "running"
    | "awaiting_approval"
    | "completed"
    | "round_limit"
    | "cancelled"
    | "failed";
  readonly error: string | null;
  readonly running: boolean;
  readonly text: string;
  readonly approval: PendingApproval | null;
  readonly activity: readonly { id: string; name: string; status: string }[];
}
