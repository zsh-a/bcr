import type { KnowledgeNote } from "../session/model";

/** Portable vault-relative path; never an OS filesystem path. */
function normalizeSegments(value: unknown, suffix: ".md" | null, message: string): string {
  if (typeof value !== "string" || value.length > 500) throw new Error(message);
  const path = value.normalize("NFC");
  const parts = path.split("/");
  if (
    (suffix !== null && !/\.md$/iu.test(path)) ||
    !path ||
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
    throw new Error(message);
  return suffix === null ? path : path.slice(0, -3) + suffix;
}
export const normalizeNotePath = (value: unknown): string =>
  normalizeSegments(value, ".md", "请使用库内相对 .md 路径，不含空目录、保留名称或特殊字符");
/** 显式目录路径：与笔记路径同一套段规则，但不带 .md 后缀；空目录也占用该路径。 */
export const normalizeFolderPath = (value: unknown): string =>
  normalizeSegments(value, null, "请使用库内相对目录路径，不含空段、保留名称或特殊字符");
export const notePath = (note: Pick<KnowledgeNote, "id" | "path">) => note.path ?? `${note.id}.md`;
export const pathKey = (path: string) => path.normalize("NFC").toLowerCase();
export const parentPath = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

export function assertUniquePaths(
  notes: Readonly<Record<string, KnowledgeNote>>,
  folders: readonly string[] = [],
) {
  const folderKeys = new Set<string>();
  for (const folder of folders) {
    const key = pathKey(folder);
    if (folderKeys.has(key)) throw new Error(`路径冲突：${folder} 目录重复`);
    folderKeys.add(key);
  }
  // Legacy IDs could differ only in case. Keep them readable until an explicit
  // path operation can resolve the portable-path collision.
  if (!folders.length && Object.values(notes).every((note) => note.path === undefined)) return;
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
  // 显式目录占用该路径：既不能与笔记文件同名，也不能顶替根目录笔记的身份别名。
  for (const folder of folders) {
    const key = pathKey(folder);
    if (occupied.has(key)) throw new Error(`路径冲突：${folder} 同时作为文件和文件夹`);
    if (aliases.has(key)) throw new Error(`路径冲突：${folder} 与根目录笔记身份别名重叠`);
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
