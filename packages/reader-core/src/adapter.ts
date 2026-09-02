import type { ReaderFormat, ReaderBook } from "./model";

export interface ReaderOpenInput {
  readonly file: File;
  readonly id: string;
  readonly format: ReaderFormat;
  readonly signal?: AbortSignal | undefined;
}

export interface ReaderAdapter {
  readonly id: string;
  readonly formats: ReadonlyArray<ReaderFormat>;
  readonly canHandle: (input: ReaderOpenInput) => boolean;
  readonly open: (input: ReaderOpenInput) => Promise<ReaderBook>;
}

export function adapterFor(
  adapters: ReadonlyArray<ReaderAdapter>,
  input: ReaderOpenInput,
): ReaderAdapter | undefined {
  return adapters.find((adapter) => adapter.canHandle(input));
}
