import type { ToolCall, ToolResult } from "./loop";
import type { AgentSessionSnapshot, PendingApproval } from "./sessionTypes";

/** Serializable UI-independent execution records. Never persist approval callbacks. */
export type ApprovalRecord = Omit<PendingApproval, "settle"> & {
  readonly decision: "pending" | "approved" | "denied" | "expired";
};
export interface ToolPresentation {
  readonly kind: string;
  readonly version: number;
  readonly label: string;
  readonly approvalLabel?: string;
}
export interface AgentToolPart {
  readonly type: "tool";
  readonly id: string;
  readonly call: ToolCall;
  /** Captured execution metadata; absent on older archives. Never grants permission. */
  readonly risk?: import("./tools").ToolRisk;
  readonly presentation?: ToolPresentation;
  readonly result?: ToolResult;
  readonly approval?: ApprovalRecord;
}
export type AgentPart =
  | { readonly type: "text"; readonly id: string; readonly text: string }
  | AgentToolPart;

export interface AgentRun {
  readonly id: string;
  readonly input: string;
  readonly workspace: string;
  readonly startedAt: number;
  readonly status: AgentSessionSnapshot["status"] | "interrupted";
  readonly parts: readonly AgentPart[];
  readonly error: string | null;
}
export interface AgentConversation {
  readonly id: string;
  readonly title: string;
  readonly draft: string;
  readonly createdAt: number;
  readonly runs: readonly AgentRun[];
}
export interface ConversationArchive {
  readonly version: 1;
  readonly activeId: string;
  readonly conversations: readonly AgentConversation[];
}
export interface ConversationStorage {
  load(): Promise<unknown>;
  save(archive: ConversationArchive): Promise<void>;
}
