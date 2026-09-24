import { parse, stringify } from "yaml";
import {
  decodeCollection,
  decodeContent,
  decodeNote,
  emptyContent,
  newNote,
  object,
  validId,
  type KnowledgeContent,
  type KnowledgeNote,
} from "./model";

export const PREFIX = "knowledge/";
export const MANIFEST = `${PREFIX}manifest.json`;
export const FILE_LIMIT = 2 * 1024 * 1024;
export const TRANSFER_LIMIT = 16 * 1024 * 1024;
export function noteMarkdown(note: KnowledgeNote): string {
  const { body, citations: _citations, ...metadata } = note;
  return `---\n${stringify({ bcr: note.path === undefined ? 1 : 2, ...metadata }, { lineWidth: 0 })}---\n${body}`;
}
export function parseNoteMarkdown(raw: string, id: string, citations: unknown = []): KnowledgeNote {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
  if (!match || match[1]!.length > 32_000) throw new Error(`笔记 ${id} 缺少有效的元数据`);
  const metadata = object(parse(match[1]!, { maxAliasCount: 0, uniqueKeys: true, schema: "core" }));
  if ((metadata.bcr !== 1 && metadata.bcr !== 2) || metadata.id !== id)
    throw new Error(`笔记 ${id} 的格式或身份不匹配`);
  return decodeNote({ ...metadata, body: raw.slice(match[0].length), citations });
}
export function importMarkdown(raw: string, filename: string): KnowledgeNote {
  const note = newNote(filename.replace(/\.md$/iu, ""));
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
  if (match) {
    const metadata = object(parse(match[1]!, { maxAliasCount: 0, schema: "core" }));
    if ((metadata.bcr === 1 || metadata.bcr === 2) && validId(metadata.id))
      return { ...parseNoteMarkdown(raw, metadata.id), id: note.id, collectionId: null };
  }
  return decodeNote({ ...note, body: raw });
}
export function contentFiles(content: KnowledgeContent): Record<string, string> {
  const version = Object.values(content.notes).some((note) => note.path !== undefined) ? 2 : 1;
  const files: Record<string, string> = {
    [MANIFEST]: JSON.stringify({ format: "bcr-knowledge", version }) + "\n",
  };
  for (const note of Object.values(content.notes).sort((a, b) => a.id.localeCompare(b.id))) {
    files[`${PREFIX}notes/${note.id}.md`] = noteMarkdown(note);
    files[`${PREFIX}citations/${note.id}.json`] = JSON.stringify(note.citations, null, 2) + "\n";
  }
  for (const collection of Object.values(content.collections).sort((a, b) =>
    a.id.localeCompare(b.id),
  ))
    files[`${PREFIX}collections/${collection.id}.json`] =
      JSON.stringify(collection, null, 2) + "\n";
  return files;
}
export const isManagedPath = (path: string): boolean =>
  path === MANIFEST ||
  /^knowledge\/(notes\/[^/]+\.md|citations\/[^/]+\.json|collections\/[^/]+\.json)$/u.test(path);
export function filesContent(files: Record<string, string>): KnowledgeContent {
  if (files[MANIFEST] === undefined) {
    if (Object.keys(files).some(isManagedPath))
      throw new Error("远端 knowledge 目录缺少格式声明，未覆盖任何文件");
    return emptyContent();
  }
  const manifest = object(JSON.parse(files[MANIFEST]));
  if (manifest.format !== "bcr-knowledge" || (manifest.version !== 1 && manifest.version !== 2))
    throw new Error("远端知识库格式不支持");
  const result = emptyContent();
  for (const [path, raw] of Object.entries(files)) {
    if (new TextEncoder().encode(raw).length > FILE_LIMIT)
      throw new Error("远端笔记超过 2 MiB 限制");
    const noteMatch = /^knowledge\/notes\/([^/]+)\.md$/u.exec(path);
    if (noteMatch) {
      const id = noteMatch[1]!;
      if (!validId(id)) throw new Error("远端笔记文件名无效");
      const citation = files[`${PREFIX}citations/${id}.json`];
      result.notes[id] = parseNoteMarkdown(
        raw,
        id,
        citation === undefined ? [] : JSON.parse(citation),
      );
    }
    const collectionMatch = /^knowledge\/collections\/([^/]+)\.json$/u.exec(path);
    if (collectionMatch) {
      const c = decodeCollection(JSON.parse(raw));
      if (c.id !== collectionMatch[1]) throw new Error("远端集合文件名与身份不一致");
      result.collections[c.id] = c;
    }
  }
  return decodeContent(result);
}
