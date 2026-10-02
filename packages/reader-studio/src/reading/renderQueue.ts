/** A session-local render budget. Aborted offscreen work never occupies a slot. */
export function createRenderQueue(limit = 2) {
  let active = 0;
  const waiting = new Set<() => void>();
  return async function render<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    while (active >= limit) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          waiting.delete(wake);
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          waiting.delete(wake);
          reject(signal.reason);
        };
        waiting.add(wake);
        signal.addEventListener("abort", abort, { once: true });
      });
    }
    signal.throwIfAborted();
    active += 1;
    try {
      return await operation();
    } finally {
      active -= 1;
      waiting.values().next().value?.();
    }
  };
}
