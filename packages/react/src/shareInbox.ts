/** Durable handoff between a share-target worker and its application window. */
export type ShareApp = "reader" | "knowledge";
export interface SharedContent {
  id: string;
  app: ShareApp;
  createdAt: number;
  title: string;
  text: string;
  url: string;
  files: File[];
  bytes: number;
}
const DATABASE = "bcr-share-inbox";
const STORE = "shares";
export const SHARE_TTL = 7 * 24 * 60 * 60 * 1000;
export const SHARE_MAX_BYTES = 128 * 1024 * 1024;
const TEXT_LIMIT = 200_000;

export function parseSharedContent(app: ShareApp, form: FormData): SharedContent {
  const field = (key: string, limit: number) => {
    const value = form.get(key);
    if (value === null) return "";
    if (typeof value !== "string" || value.length > limit)
      throw new Error("分享的文字过长或格式无效");
    return value.trim();
  };
  const title = field("title", 500),
    text = field("text", TEXT_LIMIT),
    url = field("url", 8_192);
  if (url && !/^https?:\/\//iu.test(url)) throw new Error("分享链接仅支持 http 或 https");
  const files = form
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (app === "reader") {
    if (!files.length) throw new Error("请向 Reader 分享 EPUB、PDF 或 TXT 文件");
    if (files.length > 8) throw new Error("一次最多分享 8 个文件");
    if (files.some((file) => !/\.(epub|pdf|txt)$/iu.test(file.name)))
      throw new Error("Reader 分享入口仅支持 EPUB、PDF 和 TXT");
  } else {
    if (files.length) throw new Error("笔记分享入口接收文字和链接，请在笔记中导入附件");
    if (!title && !text && !url) throw new Error("没有收到可保存的文字或链接");
  }
  const bytes = files.reduce((sum, file) => sum + file.size, new Blob([title, text, url]).size);
  if (bytes > SHARE_MAX_BYTES) throw new Error("本次分享超过 128 MiB，请分批导入");
  return { id: crypto.randomUUID(), app, createdAt: Date.now(), title, text, url, files, bytes };
}

function openInbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("分享收件箱正在升级，请关闭旧窗口后重试"));
    };
  });
}

export async function saveSharedContent(content: SharedContent): Promise<void> {
  const db = await openInbox();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"),
        store = tx.objectStore(STORE);
      let error: Error | undefined;
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(error ?? tx.error ?? new Error("无法保存分享内容"));
      tx.onerror = () => {
        /* onabort reports the transaction failure. */
      };
      const request = store.getAll();
      request.onsuccess = () => {
        const entries = request.result as SharedContent[];
        const valid = entries.filter((entry) => Date.now() - entry.createdAt < SHARE_TTL);
        for (const entry of entries) if (!valid.includes(entry)) store.delete(entry.id);
        if (
          valid.length >= 16 ||
          valid.reduce((sum, entry) => sum + entry.bytes, content.bytes) > 2 * SHARE_MAX_BYTES
        ) {
          error = new Error("分享收件箱已满，请先导入或移除待处理内容");
          tx.abort();
        } else store.add(content);
      };
    });
  } finally {
    db.close();
  }
}

export async function listSharedContent(app: ShareApp): Promise<SharedContent[]> {
  const db = await openInbox();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"),
        store = tx.objectStore(STORE);
      let items: SharedContent[] = [];
      const request = store.getAll();
      request.onsuccess = () => {
        for (const entry of request.result as SharedContent[]) {
          if (Date.now() - entry.createdAt >= SHARE_TTL) store.delete(entry.id);
          else if (entry.app === app) items.push(entry);
        }
        items = items.sort((a, b) => a.createdAt - b.createdAt);
      };
      tx.oncomplete = () => resolve(items);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function removeSharedContent(app: ShareApp, id: string): Promise<void> {
  const db = await openInbox();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"),
        store = tx.objectStore(STORE);
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result?.app === app) store.delete(id);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
