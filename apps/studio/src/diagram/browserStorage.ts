import type { RuntimeMetadata } from "@bcr/core";

/** Domain records use IDB transactions, so each window reads the durable current revision. */
export function createDiagramStorage(): RuntimeMetadata & { close: () => Promise<void> } {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("bcr-diagrams", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("records");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("无法打开本地图表存储"));
    request.onblocked = () => reject(new Error("图表存储更新被其他窗口阻止，请关闭旧窗口"));
  });
  void database.catch(() => undefined);
  async function batch(entries: ReadonlyArray<readonly [string, string | undefined]>) {
    const db = await database;
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("records", "readwrite", { durability: "strict" });
      const records = transaction.objectStore("records");
      for (const [key, value] of entries) {
        if (value === undefined) records.delete(key);
        else records.put(value, key);
      }
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("图表保存失败"));
      transaction.onerror = () => reject(transaction.error ?? new Error("图表保存失败"));
    });
  }
  return {
    close: async () => {
      (await database.catch(() => undefined))?.close();
    },
    async get(key) {
      const db = await database;
      return new Promise<string | undefined>((resolve, reject) => {
        const transaction = db.transaction("records", "readonly");
        const request = transaction.objectStore("records").get(key);
        transaction.oncomplete = () => {
          if (request.result !== undefined && typeof request.result !== "string")
            reject(new Error("本地图表记录损坏，原数据已保留"));
          else resolve(request.result as string | undefined);
        };
        transaction.onabort = () => reject(transaction.error ?? new Error("无法读取图表"));
        transaction.onerror = () => reject(transaction.error ?? new Error("无法读取图表"));
      });
    },
    set: (key, value) => batch([[key, value]]),
    batch,
  };
}
