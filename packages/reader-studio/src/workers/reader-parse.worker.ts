import { openReaderFile } from "../adapters";

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

type ParseRequestMessage = ParseRequest | CancelRequest;

const scope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
};

const controllers = new Map<string, AbortController>();

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function isWorkerRuntimeError(reason: unknown): boolean {
  if (reason instanceof ReferenceError) return true;
  const message = errorMessage(reason);
  return /(?:DOMParser|document|window) is not defined/iu.test(message);
}

scope.addEventListener("message", (event) => {
  const message = event.data as ParseRequestMessage;
  if (message === null || typeof message !== "object") return;
  if (message.type === "cancel") {
    controllers.get(message.requestId)?.abort();
    return;
  }
  if (message.type !== "parse") return;
  const controller = new AbortController();
  controllers.set(message.requestId, controller);
  void openReaderFile(message.file, message.id, controller.signal)
    .then((book) => {
      scope.postMessage({ type: "parsed", requestId: message.requestId, book });
    })
    .catch((reason: unknown) => {
      scope.postMessage({
        type: "error",
        requestId: message.requestId,
        error: errorMessage(reason),
        workerError: isWorkerRuntimeError(reason),
      });
    })
    .finally(() => controllers.delete(message.requestId));
});
