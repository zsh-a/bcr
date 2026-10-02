import type { RuntimeServices, TaskHandle } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";
import type { ResearchEvent, ResearchOperation, ResearchSession } from "../session/model";

export interface OperationToken {
  experimentId: string;
  id: string;
  abort: AbortController;
  handle: TaskHandle | null;
}

/** Operations borrow the session's token; the service owns cancellation, state and shutdown. */
export interface OperationContext {
  services: RuntimeServices;
  binary: BinaryStore;
  getState: () => ResearchSession;
  start: (kind: ResearchOperation["kind"], label: string) => OperationToken | null;
  progress: (
    token: OperationToken,
    label: string,
    value: number | null,
    kind?: "load" | "backtest" | "grid",
  ) => void;
  send: (event: ResearchEvent) => void;
  stop: (token: OperationToken, error?: unknown) => void;
  release: (token: OperationToken) => void;
  resetSelection: () => void;
}
