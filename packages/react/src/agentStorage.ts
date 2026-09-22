import type { ConversationStorage } from "@bcr/agent";

/** Browser persistence is an adapter, not part of the framework-free Agent. */
export function createAgentStorage(): ConversationStorage {
  let database: Promise<IDBDatabase> | undefined;
  let revision: unknown;
  const open = () =>
    (database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bcr-agent", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("sessions");
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => {
        database = undefined;
        reject(request.error);
      };
      request.onblocked = () => reject(new Error("Agent storage is blocked"));
    }));
  return {
    async load() {
      const db = await open();
      return new Promise<unknown>((resolve, reject) => {
        const transaction = db.transaction("sessions");
        const store = transaction.objectStore("sessions");
        const request = store.get("archive");
        const version = store.get("revision");
        transaction.oncomplete = () => {
          revision = version.result;
          resolve(request.result);
        };
        transaction.onabort = () => reject(transaction.error ?? new Error("Agent load aborted"));
        transaction.onerror = () => reject(transaction.error);
      });
    },
    async save(archive) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("sessions", "readwrite");
        const store = transaction.objectStore("sessions");
        const version = store.get("revision");
        const next = crypto.randomUUID();
        version.onsuccess = () => {
          // A stale tab must not silently overwrite another tab's conversations.
          if (version.result !== revision) {
            transaction.abort();
            return;
          }
          store.put(archive, "archive");
          store.put(next, "revision");
        };
        transaction.oncomplete = () => {
          revision = next;
          resolve();
        };
        transaction.onabort = () => reject(transaction.error ?? new Error("Agent save aborted"));
        transaction.onerror = () => reject(transaction.error);
      });
    },
  };
}
