import { complete } from "./runtime";
import type { AgentEndpoint, AgentMessage, AgentTool, TurnEvent } from "./runtime";
import { requiresApproval, toolSpecOf } from "./tools";

/**
 * The agent loop: turn, run tools, resume, repeat until the turn completes.
 *
 * The model decides which capabilities to use and in what order; this file only
 * carries out the mechanics. Nothing here knows what a note, an OCR block or a
 * market quote is — tools arrive from the caller, and the loop stops when the
 * runtime reports completion or a ceiling is reached.
 */

/** Opaque turn state handed back by the runtime and needed to resume. */
export type ChatTurnState = Record<string, unknown>;

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ToolResult {
  readonly tool_call_id: string;
  readonly tool_name: string;
  readonly output: unknown;
  readonly is_error?: boolean;
}

/** How a pending tool call reaches the host. */
export interface PendingTurn {
  readonly state: ChatTurnState;
  readonly toolCalls: readonly ToolCall[];
}

/** Everything the loop accumulated across its rounds. */
export interface LoopResult {
  readonly finishReason: "completed" | "round_limit";
  readonly rounds: number;
  /** Concatenated assistant text from every round. */
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly toolResults: readonly ToolResult[];
}

export interface LoopOptions {
  /** Tools to offer; their specs are sent with the request. */
  readonly tools?: readonly AgentTool[];
  /** Hard ceiling on rounds, so a looping model cannot run forever. */
  readonly maxRounds?: number;
  readonly temperature?: number;
  /** Ends the loop; the current round is cancelled. */
  readonly signal?: AbortSignal;
  /** Called with each streamed chunk, across every round. */
  readonly onDelta?: (chunk: string) => void;
  /** Called before a tool is resolved, for transcript rendering. */
  readonly onToolCall?: (call: ToolCall) => void;
  /**
   * Decides a pending tool call. Return a result to execute it, or a rejection
   * to hand the model an error instead. Defaults to running read-only tools and
   * rejecting anything riskier, so no write happens without a host that opts in.
   */
  readonly decide?: ToolDecision;
  /**
   * Runs one round; defaults to {@link complete}. Injectable so the loop's
   * mechanics can be tested against a scripted runtime, and so a future
   * transport can be substituted without touching loop logic.
   */
  readonly runRound?: RunRound;
}

/** The default ceiling: enough for a genuine multi-step task, bounded regardless. */
export const DEFAULT_MAX_ROUNDS = 8;

/** The metadata shape the runtime attaches to `round_finished`. */
type RoundMetadata = {
  readonly status?: string;
  readonly chat_state?: ChatTurnState;
  readonly tool_calls?: readonly ToolCall[];
};

/**
 * One round of the loop.
 *
 * Returns `null` when this round completed, or the pending tool calls to
 * resolve before resuming. Mirrors what the runtime reports on `round_finished`.
 */
export type RunRound = (
  endpoint: AgentEndpoint,
  messages: readonly AgentMessage[],
  options: OnceOptions,
) => Promise<PendingTurn | null>;

export type ToolDecision = (
  call: ToolCall,
  tool: AgentTool | undefined,
) => Promise<ToolResult | ToolRejection>;

export interface ToolRejection {
  readonly reject: string;
}

export function isRejection(value: ToolResult | ToolRejection): value is ToolRejection {
  return typeof value === "object" && value !== null && "reject" in value;
}

/**
 * Run the loop, executing tools as the runtime hands them back.
 *
 * Read-only tools run automatically; anything riskier goes to `decide`, which is
 * where an approval UI lives. A capability a domain contributes later is
 * governed by the same rule the built-ins are, because the gate reads the
 * declared risk rather than a list of names.
 */
export async function runAgentLoop(
  endpoint: AgentEndpoint,
  messages: readonly AgentMessage[],
  options: LoopOptions = {},
): Promise<LoopResult> {
  const tools = options.tools ?? [];
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1)
    throw new Error("maxRounds must be a positive safe integer");
  const byName = new Map(tools.map((tool) => [toolSpecOf(tool.spec).name, tool]));
  const decide = options.decide ?? defaultDecider(options.signal);

  let text = "";
  const calls: ToolCall[] = [];
  const results: ToolResult[] = [];
  let pendingResults: ToolResult[] = [];
  // Threaded between rounds: the runtime's state is what makes a resume legal.
  let state: ChatTurnState | null = null;

  for (let round = 0; round < maxRounds; round += 1) {
    options.signal?.throwIfAborted();
    const run = options.runRound ?? runOnce;
    const pending = await run(endpoint, messages, {
      tools,
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onDelta: (chunk: string) => {
        text += chunk;
        options.onDelta?.(chunk);
      },
      ...(state === null ? {} : { resume: { state, toolResults: pendingResults } }),
    });
    options.signal?.throwIfAborted();
    if (pending === null)
      return {
        text,
        toolCalls: calls,
        toolResults: results,
        finishReason: "completed",
        rounds: round + 1,
      };
    state = pending.state;
    pendingResults = [];

    for (const call of pending.toolCalls) {
      options.signal?.throwIfAborted();
      calls.push(call);
      options.onToolCall?.(call);
      const verdict = await decide(call, byName.get(call.name));
      options.signal?.throwIfAborted();
      const result = isRejection(verdict)
        ? {
            tool_call_id: call.id,
            tool_name: call.name,
            output: { error: verdict.reject },
            is_error: true,
          }
        : verdict;
      results.push(result);
      pendingResults.push(result);
    }
  }
  return {
    text,
    toolCalls: calls,
    toolResults: results,
    finishReason: "round_limit",
    rounds: maxRounds,
  };
}

/**
 * The default policy: read-only tools run, everything else is refused.
 *
 * With no approval UI in play, the safe answer to "may I write?" is no — and it
 * is reported to the model as a tool error so it can ask the user instead.
 */
function defaultDecider(signal?: AbortSignal): ToolDecision {
  return async (call, tool) => {
    if (tool === undefined) return { reject: `未注册的工具：${call.name}` };
    if (requiresApproval(tool.spec))
      return { reject: `此工具需要人工确认，当前未启用：${call.name}` };
    try {
      return {
        tool_call_id: call.id,
        tool_name: call.name,
        output: parseJson(
          await tool.call(JSON.stringify(call.input ?? {}), { signal, callId: call.id }),
        ),
      };
    } catch (error) {
      return {
        tool_call_id: call.id,
        tool_name: call.name,
        output: { error: String(error) },
        is_error: true,
      };
    }
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // A tool that answers in prose is still an answer; pass it through intact.
    return value;
  }
}

export interface OnceOptions {
  readonly tools: readonly AgentTool[];
  readonly temperature?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onDelta?: ((chunk: string) => void) | undefined;
  /** Sees every event of the round, so a caller can observe `round_finished`. */
  readonly onEvent?: ((event: TurnEvent) => void) | undefined;
  readonly resume?:
    | { readonly state: ChatTurnState; readonly toolResults: readonly ToolResult[] }
    | undefined;
}

/**
 * One round: a fresh turn, or a resume carrying the last round's tool results.
 *
 * Returns the pending tool calls, or `null` when this round completed. The
 * runtime always emits a final `round_finished`, so completion is read from
 * that event's status rather than inferred from whether text was produced.
 */
async function runOnce(
  endpoint: AgentEndpoint,
  messages: readonly AgentMessage[],
  options: OnceOptions,
): Promise<PendingTurn | null> {
  let pending: PendingTurn | null = null;
  await complete(endpoint, messages, {
    tools: options.tools,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onDelta === undefined ? {} : { onDelta: options.onDelta }),
    // The runtime owns the loop across rounds; a resume continues that state
    // rather than replaying the transcript.
    ...(options.resume === undefined ? {} : { resume: options.resume }),
    // Inspect every event, not just deltas, to catch `round_finished`.
    onEvent: (event: TurnEvent) => {
      if (event.kind !== "round_finished") return;
      const metadata = event.metadata as RoundMetadata | undefined;
      if (metadata?.status !== "requires_tool_results" || metadata.chat_state === undefined) return;
      pending = {
        state: metadata.chat_state,
        toolCalls: metadata.tool_calls ?? [],
      };
    },
  });
  return pending;
}
