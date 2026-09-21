/**
 * Browser-side adapter over the agent-runtime wasm module.
 *
 * The runtime is a separate repository, vendored as the `crates/agent-runtime`
 * submodule and compiled by `bun run build:wasm:agent` into
 * `crates/agent-wasm/pkg`, next to the `crates/kernels` package it mirrors.
 *
 * This module owns the protocol details that the rest of the knowledge base
 * should not know: which events carry streamed text, and what a turn request
 * looks like. Everything above it works in terms of plain strings.
 */

/** One OpenAI-compatible endpoint. The key is never persisted; see `storage-policy.ts`. */
export interface AgentEndpoint {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** Provider label recorded in the runtime's trace events. */
  readonly provider?: string;
}

export interface AgentMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** Raised for a turn that failed, so callers render the reason rather than a partial edit. */
export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

type TurnEvent = {
  readonly kind: string;
  readonly content?: string;
  readonly metadata?: Record<string, unknown>;
};

let loading: Promise<{ AgentRuntime: AgentRuntimeConstructor }> | null = null;

/** The generated binding's class shape, resolved once the module loads. */
type AgentRuntime = import("../../../../crates/agent-wasm/pkg/agent_wasm.js").AgentRuntime;

type AgentRuntimeConstructor = new (
  provider: string,
  baseUrl: string,
  apiKey: string,
  tools: readonly unknown[],
) => AgentRuntime;

/**
 * Load the module on first use.
 *
 * The import is dynamic on purpose: the binary is ~3.5 MiB and the knowledge
 * base is offline-first, so a reader who never uses AI should never fetch it.
 * A failed load is not cached, so a later attempt can retry.
 */
function ready(): Promise<{ AgentRuntime: AgentRuntimeConstructor }> {
  loading ??= import("../../../../crates/agent-wasm/pkg/agent_wasm.js")
    .then(async (module) => {
      await module.default();
      return { AgentRuntime: module.AgentRuntime as AgentRuntimeConstructor };
    })
    .catch((error: unknown) => {
      loading = null;
      throw new AgentError(`无法加载 Agent 运行时：${String(error)}`);
    });
  return loading;
}

/** Constructing the Rust side is cheap, but not free; reuse it for the same endpoint. */
let cached: { key: string; runtime: AgentRuntime } | null = null;

function runtimeFor(AgentRuntime: AgentRuntimeConstructor, endpoint: AgentEndpoint): AgentRuntime {
  const key = `${endpoint.provider ?? "openai"}\u0000${endpoint.baseUrl}\u0000${endpoint.model}`;
  if (cached?.key === key) return cached.runtime;
  const runtime = new AgentRuntime(
    endpoint.provider ?? "openai",
    endpoint.baseUrl,
    endpoint.apiKey,
    [],
  );
  cached = { key, runtime };
  return runtime;
}

/**
 * Run one turn and return the assistant's text.
 *
 * The runtime streams events; only `delta` carries text. A turn that reports
 * `error` rejects instead of returning the partial text accumulated so far,
 * because a truncated replacement would silently damage a note.
 *
 * There is no cancellation channel through the wasm boundary yet, so an
 * abandoned call still completes in the runtime; callers drop its result.
 */
export async function complete(
  endpoint: AgentEndpoint,
  messages: readonly AgentMessage[],
): Promise<string> {
  const { AgentRuntime } = await ready();
  const request = {
    protocol_version: "agent.v1",
    provider: endpoint.provider ?? "openai",
    model: endpoint.model,
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    tools: [],
    tool_execution: "client",
    max_tool_rounds: 1,
    // Editing wants the model's most likely continuation, not its most varied.
    temperature: 0,
  };

  let events: readonly TurnEvent[];
  try {
    events = JSON.parse(
      await runtimeFor(AgentRuntime, endpoint).turn(JSON.stringify(request)),
    ) as TurnEvent[];
  } catch (error) {
    throw new AgentError(`请求失败：${String(error)}`);
  }

  const failure = events.find((event) => event.kind === "error");
  if (failure) throw new AgentError(String(failure.content ?? "模型返回错误"));
  return events
    .filter((event) => event.kind === "delta")
    .map((event) => event.content ?? "")
    .join("");
}
