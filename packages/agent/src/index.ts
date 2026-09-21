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
  type CompleteOptions,
} from "./runtime";

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
  activateSurface,
  activeSurface,
  registerSurface,
  subscribeSurfaces,
  surfaceRevision,
  surfaceSummary,
  type AgentSurface,
  type SurfaceSummary,
  type SurfaceTarget,
} from "./surface";
