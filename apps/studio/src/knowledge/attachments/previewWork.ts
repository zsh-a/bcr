/** Queue before reading originals so waiting previews retain no file-sized buffers. */
export function createPreviewQueue(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return <T>(work: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const release = () => {
        active--;
        waiting.shift()?.();
      };
      const start = () => {
        active++;
        void Promise.resolve()
          .then(work)
          .then(
            (value) => {
              release();
              resolve(value);
            },
            (reason) => {
              release();
              reject(reason);
            },
          );
      };
      if (active < concurrency) start();
      else waiting.push(start);
    });
}

// Shared by every KnowledgeAttachments instance in this document.
export const queuePreviewWork = createPreviewQueue(2);
