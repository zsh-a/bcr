import { useCallback, useState, useSyncExternalStore } from "react";
import {
  agentConfigured,
  agentEndpoint,
  agentSnapshot,
  configureAgent,
  proposeTextEdit,
  resolveEdit,
  subscribeAgent,
  type AgentEndpoint,
  type TextEditMode,
  type TextEditSuggestion,
} from "@bcr/agent";

/**
 * The agent, shared by every workspace.
 *
 * There is no provider: the endpoint is one module singleton with an
 * external-store interface, so any number of mounted apps, and code outside
 * React, read the same value. The host configures it once through
 * {@link useAgent}; domain apps never configure an endpoint themselves.
 *
 * `useTextEditSuggestion` carries the whole proposal lifecycle, so a domain that
 * edits text supplies only two things — how to address a range, and where to
 * store the accepted result. Preview, staleness and discard are identical
 * everywhere.
 */
export interface AgentService {
  /** The endpoint in effect, or an empty snapshot when unconfigured. */
  readonly endpoint: AgentEndpoint;
  readonly configured: boolean;
  readonly setEndpoint: (endpoint: AgentEndpoint | null) => void;
}

/** The shared endpoint. Safe to call in any app; the host only needs to set it. */
export function useAgent(): AgentService {
  const endpoint = useSyncExternalStore(subscribeAgent, agentSnapshot);
  return {
    endpoint,
    configured: agentConfigured(agentEndpoint()),
    setEndpoint: configureAgent,
  };
}

export type SuggestionState =
  | { readonly status: "idle" }
  | { readonly status: "asking" }
  | { readonly status: "ready"; readonly suggestion: TextEditSuggestion }
  | { readonly status: "failed"; readonly message: string };

export interface ProposeInput {
  readonly mode: TextEditMode;
  readonly instruction: string;
  /** The text the range addresses, as it is right now. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly label?: string;
}

export interface TextEditController {
  readonly state: SuggestionState;
  /** Set when an accepted suggestion turned out to be stale. */
  readonly notice: string;
  /** Asks for an edit and holds the result. Writes nothing. */
  readonly propose: (input: ProposeInput) => Promise<void>;
  /**
   * Writes an accepted suggestion through `write`.
   *
   * Resolves the suggestion against `current` first, so one computed before the
   * user kept typing is dropped instead of applied. Returns whether it was written.
   */
  readonly apply: (
    suggestion: TextEditSuggestion,
    current: string,
    write: (next: string) => void,
  ) => boolean;
  readonly discard: () => void;
  readonly dismissNotice: () => void;
}

/** The shared proposal lifecycle: idle → asking → ready → applied or discarded. */
export function useTextEditSuggestion(): TextEditController {
  const { endpoint } = useAgent();
  const [state, setState] = useState<SuggestionState>({ status: "idle" });
  const [notice, setNotice] = useState("");

  const propose = useCallback<TextEditController["propose"]>(
    async (input) => {
      setNotice("");
      setState({ status: "asking" });
      try {
        const suggestion = await proposeTextEdit({
          endpoint,
          mode: input.mode,
          instruction: input.instruction,
          text: input.text,
          range: { start: input.start, end: input.end },
          ...(input.label === undefined ? {} : { label: input.label }),
        });
        setState({ status: "ready", suggestion });
      } catch (error) {
        setState({ status: "failed", message: String(error) });
      }
    },
    [endpoint],
  );

  const apply = useCallback<TextEditController["apply"]>((suggestion, current, write) => {
    const next = resolveEdit(current, suggestion);
    setState({ status: "idle" });
    if (next === null) {
      setNotice("原文已变化，这次改动已丢弃（没有写入）");
      return false;
    }
    write(next);
    return true;
  }, []);

  const discard = useCallback(() => {
    setState({ status: "idle" });
    setNotice("");
  }, []);

  return { state, notice, propose, apply, discard, dismissNotice: () => setNotice("") };
}
