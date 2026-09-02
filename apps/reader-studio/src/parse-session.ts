import type { ReaderBook } from "@bcr/reader-core";

interface ParseRequest {
  readonly type: "parse";
  readonly requestId: string;
  readonly id: string;
  readonly file: File;
}

interface CancelRequest {
  readonly type: "cancel";
  readonly requestId: string;
}

interface ParsedMessage {
  readonly type: "parsed";
  readonly requestId: string;
  readonly book: ReaderBook;
}

interface ParseErrorMessage {
  readonly type: "error";
  readonly requestId: string;
  readonly error: string;
  readonly workerError?: boolean;
}

type ParseMessage = ParsedMessage | ParseErrorMessage;

export class ReaderParseWorkerError extends Error {
  override readonly name = "ReaderParseWorkerError";
}

interface PendingParse {
  readonly resolve: (book: ReaderBook) => void;
  readonly reject: (reason: unknown) => void;
  readonly signal?: AbortSignal | undefined;
  abortListener?: (() => void) | undefined;
}

export interface ReaderParseSession {
  readonly open: (file: File, id: string, signal?: AbortSignal) => Promise<ReaderBook>;
  readonly close: () => void;
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function errorFromMessage(message: ParseErrorMessage): Error {
  if (message.workerError === true) {
    return new ReaderParseWorkerError(message.error || "Reader parser worker failed");
  }
  return new Error(message.error || "Reader parser failed");
}

/**
 * A single parser worker keeps ZIP/XML work out of React's render thread. The
 * session is intentionally small: one request can be cancelled, and a worker
 * crash rejects pending work so the runtime can safely fall back to main.
 */
export function createReaderParseSession(): ReaderParseSession | undefined {
  if (typeof Worker === "undefined") return undefined;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./workers/reader-parse.worker.ts", import.meta.url), {
      type: "module",
      name: "bcr-reader-parser",
    });
  } catch {
    return undefined;
  }

  let sequence = 0;
  let closed = false;
  let workerFailure: ReaderParseWorkerError | undefined;
  const pending = new Map<string, PendingParse>();

  const settle = (requestId: string, result: ParseMessage): void => {
    const request = pending.get(requestId);
    if (request === undefined) return;
    pending.delete(requestId);
    if (request.signal !== undefined && request.abortListener !== undefined) {
      request.signal.removeEventListener("abort", request.abortListener);
    }
    if (result.type === "parsed") request.resolve(result.book);
    else request.reject(errorFromMessage(result));
  };

  worker.addEventListener("message", (event: MessageEvent<ParseMessage>) => {
    const message = event.data;
    if (message === null || typeof message !== "object") return;
    if (message.type !== "parsed" && message.type !== "error") return;
    settle(message.requestId, message);
  });

  worker.addEventListener("error", (event) => {
    if (closed) return;
    const error = new ReaderParseWorkerError(event.message || "Reader parser worker crashed");
    workerFailure = error;
    closed = true;
    worker.terminate();
    for (const [requestId, request] of pending) {
      pending.delete(requestId);
      if (request.signal !== undefined && request.abortListener !== undefined) {
        request.signal.removeEventListener("abort", request.abortListener);
      }
      request.reject(error);
    }
  });

  return {
    open(file, id, signal) {
      if (closed) {
        return Promise.reject(
          workerFailure ?? new ReaderParseWorkerError("Reader parser is closed"),
        );
      }
      if (signal?.aborted === true) return Promise.reject(abortError());
      const requestId = `parse-${++sequence}`;
      return new Promise<ReaderBook>((resolve, reject) => {
        const request: PendingParse = { resolve, reject, signal };
        const abortListener = () => {
          if (!pending.delete(requestId)) return;
          worker.postMessage({ type: "cancel", requestId } satisfies CancelRequest);
          reject(abortError());
        };
        request.abortListener = abortListener;
        pending.set(requestId, request);
        signal?.addEventListener("abort", abortListener, { once: true });
        try {
          worker.postMessage({ type: "parse", requestId, id, file } satisfies ParseRequest);
        } catch (reason) {
          pending.delete(requestId);
          signal?.removeEventListener("abort", abortListener);
          reject(reason);
        }
      });
    },
    close() {
      if (closed) return;
      closed = true;
      worker.terminate();
      const error = new ReaderParseWorkerError("Reader parser closed");
      for (const [requestId, request] of pending) {
        pending.delete(requestId);
        if (request.signal !== undefined && request.abortListener !== undefined) {
          request.signal.removeEventListener("abort", request.abortListener);
        }
        request.reject(error);
      }
    },
  };
}
