import type { ReaderState } from "./model";

/** Feature actions borrow state access; the store owns publication and subscriptions. */
export interface ReaderStatePort {
  readonly getSnapshot: () => ReaderState;
  readonly update: (partial: Partial<ReaderState>) => void;
}
