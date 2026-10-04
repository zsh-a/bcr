import type { RuntimeMetadata } from "@bcr/core";

/** Each commit is an IDB transaction; Web Locks serialize revision checks across windows. */
export function createWorkspaceStorage(name: string): RuntimeMetadata & { close(): Promise<void> } {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("无法打开工作区存储"));
    request.onblocked = () => reject(new Error("请关闭旧窗口后重新打开工作区"));
  });
  void database.catch(() => undefined);
  async function batch(entries: ReadonlyArray<readonly [string, string | undefined]>) {
    const db = await database;
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("records", "readwrite", { durability: "strict" });
      const records = tx.objectStore("records");
      for (const [key, value] of entries) {
        if (value === undefined) records.delete(key);
        else records.put(value, key);
      }
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("工作区保存失败"));
    });
  }
  return {
    batch,
    set: (key, value) => batch([[key, value]]),
    async get(key) {
      const db = await database;
      return new Promise<string | undefined>((resolve, reject) => {
        const tx = db.transaction("records", "readonly"),
          request = tx.objectStore("records").get(key);
        tx.oncomplete = () =>
          typeof request.result === "string" || request.result === undefined
            ? resolve(request.result as string | undefined)
            : reject(new Error("工作区记录损坏"));
        tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("读取工作区失败"));
      });
    },
    async close() {
      (await database.catch(() => undefined))?.close();
    },
  };
}
