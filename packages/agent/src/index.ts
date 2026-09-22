/**
 * `@bcr/agent` — shared model access for every workspace.
 *
 * Framework-free on purpose: it depends only on `@bcr/core` for the text
 * primitives (`textVersion`, `TextRange`) that the suggestion protocol is built
 * on. React bindings live in `@bcr/react`; the host supplies the endpoint.
 *
 * Not part of `@bcr/core`: this layer fetches, runs WebAssembly and dynamically
 * imports a ~3.5 MiB binary, which a framework-independent contract package
 * should not carry. Same reason `createBrowserRuntime` lives in
 * `@bcr/runtime-browser` rather than `@bcr/core`.
 */

export {
  AgentError,
  complete,
  ready,
  type AgentEndpoint,
  type AgentMessage,
  type AgentTool,
  type AgentToolSpec,
  type ToolExecutionContext,
  type CompleteOptions,
} from "./runtime";

export {
  createAgentSession,
  SURFACE_EDIT_TOOL,
  type AgentSessionOptions,
  type AgentSessionSnapshot,
  type PendingApproval,
} from "./session";

export {
  agentConfigured,
  agentEndpoint,
  agentSnapshot,
  configureAgent,
  subscribeAgent,
} from "./settings";

export {
  EditError,
  isCurrent,
  minimalChange,
  previewEdit,
  resolveEdit,
  suggestRange,
  textInRange,
  type TextChange,
  type TextEditSuggestion,
} from "./suggestion";

export {
  editMessages,
  proposeTextEdit,
  unfence,
  type TextEditMode,
  type TextEditRequest,
} from "./textEdit";

export {
  DEFAULT_MAX_ROUNDS,
  isRejection,
  runAgentLoop,
  type ChatTurnState,
  type LoopOptions,
  type LoopResult,
  type PendingTurn,
  type ToolCall,
  type ToolDecision,
  type ToolRejection,
  type RunRound,
  type ToolResult,
} from "./loop";

export { requiresApproval, toolSpecOf, type ToolRisk } from "./tools";

export { createCapabilityRegistry, type AgentCapability } from "./capabilities";
export { createAgentHost, type AgentHost } from "./host";

export {
  createSurfaceRegistry,
  type AgentSurface,
  type SurfaceSummary,
  type SurfaceTarget,
  type SurfaceWriteReceipt,
} from "./surface";
