import type { KnowledgeNote } from "./model";

/** Portable vault-relative path; never an OS filesystem path. */
export function normalizeNotePath(value: unknown): string {
  if (typeof value !== "string" || value.length > 500) throw new Error("笔记路径无效或过长");
  const path = value.normalize("NFC");
  const parts = path.split("/");
  if (
    !/\.md$/iu.test(path) ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.startsWith(".") ||
        part.length > 120 ||
        part !== part.trim() ||
        /[. ]$/u.test(part) ||
        /[\\<>:"|?*#%]/u.test(part) ||
        /\p{Cc}/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
    )
  )
    throw new Error("请使用库内相对 .md 路径，不含空目录、保留名称或特殊字符");
  return path.slice(0, -3) + ".md";
}
export const notePath = (note: Pick<KnowledgeNote, "id" | "path">) => note.path ?? `${note.id}.md`;
export const pathKey = (path: string) => path.normalize("NFC").toLowerCase();
export const parentPath = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

export function assertUniquePaths(notes: Readonly<Record<string, KnowledgeNote>>) {
  // Legacy IDs could differ only in case. Keep them readable until an explicit
  // path operation can resolve the portable-path collision.
  if (Object.values(notes).every((note) => note.path === undefined)) return;
  const occupied = new Map<string, string>();
  const aliases = new Map(Object.values(notes).map((note) => [pathKey(`${note.id}.md`), note.id]));
  for (const note of Object.values(notes)) {
    const path = notePath(note),
      key = pathKey(path);
    const previous = occupied.get(key);
    if ((previous && previous !== note.id) || (aliases.has(key) && aliases.get(key) !== note.id))
      throw new Error(`路径冲突：${path}；未覆盖任何笔记，请先移动同名文件`);
    occupied.set(key, note.id);
  }
  for (const path of occupied.keys()) {
    let folder = parentPath(path);
    while (folder) {
      if (occupied.has(folder)) throw new Error(`路径冲突：${folder} 同时作为文件和文件夹`);
      folder = parentPath(folder);
    }
  }
}

export function availableCopyPath(path: string, notes: Readonly<Record<string, KnowledgeNote>>) {
  const occupied = new Set(
    Object.values(notes).flatMap((note) => [pathKey(notePath(note)), pathKey(`${note.id}.md`)]),
  );
  const free = (candidate: string) =>
    !occupied.has(pathKey(candidate)) &&
    ![...occupied].some((key) => key.startsWith(`${pathKey(candidate)}/`));
  if (free(path)) return path;
  const folder = parentPath(path),
    filename = path.slice(folder ? folder.length + 1 : 0, -3).slice(0, 90);
  for (let index = 2; index < 10000; index++) {
    const candidate = `${folder ? `${folder}/` : ""}${filename} (${index}).md`;
    if (free(candidate)) return normalizeNotePath(candidate);
  }
  throw new Error("无法分配副本路径");
}

/** Resolve ../ and ./ only within the vault root; reject traversal outside it. */
export function relativeNotePath(target: string, sourcePath: string): string | null {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|\\)/iu.test(target)) return null;
  const parts = parentPath(sourcePath).split("/").filter(Boolean);
  for (const part of target.split("/")) {
    if (part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  try {
    return normalizeNotePath(parts.join("/").replace(/\.md$/iu, "") + ".md");
  } catch {
    return null;
  }
}
