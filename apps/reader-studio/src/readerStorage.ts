import type { BinaryStore } from "@bcr/storage-opfs";

/** Stop late imports and drain accepted writes before releasing the project lease. */
export function readerStorageLifetime(store: BinaryStore) {
  let closed = false;
  const pending = new Set<Promise<unknown>>();
  const binary = new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (closed) return Promise.reject(new Error("Reader 会话已关闭"));
        const operation = Promise.resolve().then(() => Reflect.apply(value, target, args));
        pending.add(operation);
        void operation.then(
          () => pending.delete(operation),
          () => pending.delete(operation),
        );
        return operation;
      };
    },
  });
  return {
    binary,
    async close() {
      closed = true;
      await Promise.allSettled(pending);
    },
  };
}
