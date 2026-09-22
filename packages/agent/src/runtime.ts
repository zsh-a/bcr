/**
 * Browser-side client over the agent-runtime wasm module.
 *
 * The runtime is a separate repository, vendored as the `crates/agent-runtime`
 * submodule and compiled by `bun run build:wasm:agent` into `crates/agent-wasm/pkg`,
 * mirroring the `crates/kernels` package.
 *
 * This module owns the protocol details no domain should know: which events
 * carry streamed text, and what a turn request looks like. Everything above it
 * passes plain strings in and gets plain strings out.
 */

/** One OpenAI-compatible endpoint. The key is never persisted. */
export interface AgentEndpoint {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** Provider label recorded in the runtime's trace events. */
  readonly provider?: string;
}

export interface AgentMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolCalls?: readonly { id: string; name: string; input: unknown }[];
  readonly toolCallId?: string;
}

/** Translate host history to agent-runtime's provider-neutral message blocks. */
export function serializeAgentMessage(message: AgentMessage) {
  if (message.role === "tool") {
    return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }],
    };
  }
  return {
    role: message.role,
    content: message.toolCalls?.length
      ? [
          ...(message.content ? [{ type: "text", text: message.content }] : []),
          ...message.toolCalls.map((call) => ({ type: "tool_use", ...call })),
        ]
      : message.content,
  };
}

/** A tool the host executes. Registered once and offered on every turn. */
export interface AgentToolSpec {
  readonly name: string;
  readonly description?: string;
  readonly input_schema?: Readonly<Record<string, unknown>>;
  readonly risk?: import("./tools").ToolRisk;
}

export interface ToolExecutionContext {
  readonly signal?: AbortSignal | undefined;
  readonly callId: string;
}

export interface AgentTool {
  /** Host-only presentation hint; never sent to the model as a tool schema. */
  readonly presentation?: import("./conversationTypes").ToolPresentation;
  /** A `ToolSpec` from agent-core: `name`, `description`, `input_schema`, `risk`, … */
  readonly spec: AgentToolSpec;
  /** Receives the call input as JSON and resolves with the output as JSON. */
  readonly call: (inputJson: string, context?: ToolExecutionContext) => Promise<string>;
}

/** Raised for a turn that failed, so callers surface the reason instead of a partial result. */
export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

export type TurnEvent = {
  readonly kind: string;
  readonly content?: string;
  readonly tool_name?: string;
  readonly tool_input?: unknown;
  readonly tool_call_id?: string;
  readonly metadata?: Record<string, unknown>;
};

let loading: Promise<{ AgentRuntime: AgentRuntimeConstructor }> | null = null;

/** The generated binding's class shape, resolved once the module loads. */
type AgentRuntime = import("../../../crates/agent-wasm/pkg/agent_wasm.js").AgentRuntime;

type AgentRuntimeConstructor = new (
  provider: string,
  baseUrl: string,
  apiKey: string,
  tools: readonly AgentTool[],
) => AgentRuntime;

/** Cancels an in-flight turn once the host no longer wants it. */
type TurnHandle = { readonly cancel: () => void };

/**
 * Load the module on first use.
 *
 * The import is dynamic on purpose: the binary is ~3.5 MiB and the host is
 * offline-first, so a user who never invokes a model should never fetch it. A
 * failed load is not cached, so a later attempt can retry.
 */
export function ready(): Promise<{ AgentRuntime: AgentRuntimeConstructor }> {
  loading ??= import("../../../crates/agent-wasm/pkg/agent_wasm.js")
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

/** Constructing the Rust side is cheap, but not free; reuse it per endpoint. */
let cached: { key: string; runtime: AgentRuntime } | null = null;

function runtimeFor(
  AgentRuntime: AgentRuntimeConstructor,
  endpoint: AgentEndpoint,
  tools: readonly AgentTool[],
): AgentRuntime {
  // Tool identity is part of the key: a runtime built without a tool would
  // silently ignore that tool for every later turn.
  const key = [
    endpoint.provider ?? "openai",
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.model,
    tools.map((tool) => JSON.stringify(tool.spec)).join("\u0001"),
  ].join("\u0000");
  if (cached?.key === key) return cached.runtime;
  const runtime = new AgentRuntime(
    endpoint.provider ?? "openai",
    endpoint.baseUrl.startsWith("/") && typeof location !== "undefined"
      ? new URL(endpoint.baseUrl, location.origin).href
      : endpoint.baseUrl,
    endpoint.apiKey,
    tools,
  );
  cached = { key, runtime };
  return runtime;
}

/** Enough rounds for a tool call plus the resume that answers it. */
export const DEFAULT_MAX_TOOL_ROUNDS = 8;

export interface CompleteOptions {
  /** Called with each streamed chunk as it arrives, for progressive display. */
  readonly onDelta?: (chunk: string) => void;
  /** Tools to offer the model. Client execution: `turn` stops and asks the host to run them. */
  readonly tools?: readonly AgentTool[];
  /** Caps how many tool rounds a turn may take. */
  readonly maxToolRounds?: number;
  readonly temperature?: number;
  /**
   * Aborts the host's interest in this turn.
   *
   * Cancels the turn in the runtime, so an abandoned run stops rather than
   * finishing unseen. Events already emitted have been delivered.
   */
  readonly signal?: AbortSignal;
  /** Sees every event, not just deltas; needed to observe `round_finished`. */
  readonly onEvent?: (event: TurnEvent) => void;
  /**
   * Continue a suspended turn instead of starting one.
   *
   * `state` comes from the `round_finished` event that reported
   * `requires_tool_results`; `toolResults` are the host's answers to it.
   */
  readonly resume?: {
    readonly state: Record<string, unknown>;
    readonly toolResults: readonly unknown[];
  };
}

/**
 * Run one turn and return the assistant's text.
 *
 * Only `delta` events carry text. A turn that reports `error` rejects rather
 * than returning the text accumulated so far: a truncated replacement would
 * silently damage the target.
 */
export async function complete(
  endpoint: AgentEndpoint,
  messages: readonly AgentMessage[],
  options: CompleteOptions = {},
): Promise<string> {
  const { AgentRuntime } = await ready();
  const tools = options.tools ?? [];
  const request = {
    protocol_version: "agent.v1",
    provider: endpoint.provider ?? "openai",
    model: endpoint.model,
    messages: messages.map(serializeAgentMessage),
    tools: tools.map((tool) => tool.spec),
    // `client` stops the turn so the host can run the tools; with none to run,
    // the default `runtime` execution is the only valid choice.
    tool_execution: tools.length > 0 ? "client" : "runtime",
    // The budget counts rounds, and a round that asks for tools needs a further
    // round to resume with their results, so one is never enough.
    max_tool_rounds: options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS,
    // Editing wants the model's most likely continuation, not its most varied.
    temperature: options.temperature ?? 0,
  };

  // The Rust side pushes each event as it arrives, so the host sees text while
  // it is being generated rather than one batch at the end.
  let text = "";
  let failure: string | null = null;
  let handle: TurnHandle | null = null;
  await new Promise<void>((resolve, reject) => {
    const onEvent = (json: string) => {
      let event: TurnEvent;
      try {
        event = JSON.parse(json) as TurnEvent;
      } catch {
        return;
      }
      options.onEvent?.(event);
      if (event.kind === "delta") {
        const chunk = event.content ?? "";
        if (chunk.length === 0) return;
        text += chunk;
        options.onDelta?.(chunk);
        return;
      }
      if (event.kind === "error") {
        failure = String(event.content ?? "模型返回错误");
        resolve();
        return;
      }
      if (event.kind === "done") resolve();
    };
    const runtime = runtimeFor(AgentRuntime, endpoint, tools);
    try {
      handle =
        options.resume === undefined
          ? runtime.stream_turn(JSON.stringify(request), onEvent)
          : runtime.stream_resume(
              JSON.stringify({
                protocol_version: "agent.v1",
                state: options.resume.state,
                tool_results: options.resume.toolResults,
              }),
              onEvent,
            );
    } catch (error) {
      reject(new AgentError(`请求失败：${String(error)}`));
      return;
    }
    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        handle.cancel();
        reject(new AgentError("已取消"));
        return;
      }
      options.signal.addEventListener(
        "abort",
        () => {
          handle?.cancel();
        },
        { once: true },
      );
    }
  });

  if (failure !== null) throw new AgentError(failure);
  return text;
}
