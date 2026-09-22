import {
  FILE_LIMIT,
  TRANSFER_LIMIT,
  MANIFEST,
  filesContent,
  contentFiles,
  isManagedPath,
} from "./files";
import { decodeContent, same, type KnowledgeContent } from "./model";

export type RestoreMode = "skip" | "replace" | "both";

export async function writeKnowledgeBackup(content: KnowledgeContent): Promise<Blob> {
  const valid = decodeContent(content);
  for (const note of Object.values(valid.notes)) {
    if (note.collectionId && !valid.collections[note.collectionId])
      throw new Error("请先补齐笔记所属集合再导出备份");
  }
  const files = contentFiles(valid);
  let total = 0;
  for (const text of Object.values(files)) {
    const bytes = new TextEncoder().encode(text).byteLength;
    total += bytes;
    if (bytes > FILE_LIMIT || total > TRANSFER_LIMIT)
      throw new Error("知识库超过备份容量限制，未生成不完整备份");
  }
  const { ZipWriter, BlobWriter, TextReader } = await import("@zip.js/zip.js");
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  for (const [path, text] of Object.entries(files)) await zip.add(path, new TextReader(text));
  return zip.close();
}

/** Decode the portable archive without ever extracting paths to a filesystem. */
export async function readKnowledgeBackup(file: Blob): Promise<KnowledgeContent> {
  if (file.size > TRANSFER_LIMIT) throw new Error("备份文件超过 16 MiB 限制");
  const { ZipReader, BlobReader } = await import("@zip.js/zip.js");
  const zip = new ZipReader(new BlobReader(file));
  const files: Record<string, string> = Object.create(null);
  const seen = new Set<string>();
  let total = 0,
    count = 0;
  try {
    for await (const entry of zip.getEntriesGenerator()) {
      if (++count > 12000) throw new Error("备份条目过多");
      const path = entry.filename;
      if (
        seen.has(path) ||
        path.includes("\\") ||
        path.split("/").some((part) => part === ".." || part === ".") ||
        path.startsWith("/")
      )
        throw new Error("备份包含重复或不安全路径");
      seen.add(path);
      if (entry.encrypted || ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000)
        throw new Error("备份不支持加密条目或符号链接");
      if (entry.directory) {
        if (
          ![
            "knowledge/",
            "knowledge/notes/",
            "knowledge/citations/",
            "knowledge/collections/",
          ].includes(path)
        )
          throw new Error("备份包含未知目录");
        continue;
      }
      if (!isManagedPath(path)) throw new Error("备份包含未知文件");
      if (entry.uncompressedSize > FILE_LIMIT || total + entry.uncompressedSize > TRANSFER_LIMIT)
        throw new Error("备份解压内容超过容量限制");
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      await entry.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            bytes += chunk.byteLength;
            total += chunk.byteLength;
            if (bytes > FILE_LIMIT || total > TRANSFER_LIMIT)
              throw new Error("备份解压内容超过容量限制");
            chunks.push(chunk.slice());
          },
        }),
        { checkSignature: true },
      );
      const data = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
      }
      files[path] = new TextDecoder("utf-8", { fatal: true }).decode(data);
    }
    if (!Object.hasOwn(files, MANIFEST)) throw new Error("缺少知识库备份清单");
    const content = filesContent(files);
    for (const note of Object.values(content.notes)) {
      if (note.collectionId && !content.collections[note.collectionId])
        throw new Error("备份缺少笔记所属集合");
      if (!Object.hasOwn(files, `knowledge/citations/${note.id}.json`))
        throw new Error("备份缺少笔记引用文件");
    }
    for (const path of Object.keys(files)) {
      const match = /^knowledge\/citations\/([^/]+)\.json$/u.exec(path);
      if (match && !content.notes[match[1]!]) throw new Error("备份引用缺少对应笔记");
    }
    return content;
  } finally {
    await zip.close();
  }
}

/** All changes are planned before a single store update; unrelated local notes are never deleted. */
export function planKnowledgeRestore(
  base: KnowledgeContent,
  incoming: KnowledgeContent,
  mode: RestoreMode,
) {
  const source = decodeContent(incoming);
  const notes = { ...base.notes },
    collections = { ...base.collections };
  const collectionIds = new Map<string, string>();
  let added = 0,
    replaced = 0,
    skipped = 0,
    copied = 0;
  for (const collection of Object.values(source.collections)) {
    const existing = collections[collection.id];
    if (!existing || same(existing, collection) || mode === "replace")
      collections[collection.id] = collection;
    else if (mode === "both") {
      const id = crypto.randomUUID();
      collections[id] = { ...collection, id, name: `${collection.name.slice(0, 194)}（恢复副本）` };
      collectionIds.set(collection.id, id);
    }
  }
  for (const original of Object.values(source.notes)) {
    const note = {
      ...original,
      collectionId: original.collectionId
        ? (collectionIds.get(original.collectionId) ?? original.collectionId)
        : null,
    };
    const existing = notes[note.id];
    if (!existing) {
      notes[note.id] = note;
      added += 1;
    } else if (same(existing, note) || mode === "skip") skipped += 1;
    else if (mode === "replace") {
      notes[note.id] = note;
      replaced += 1;
    } else {
      const id = crypto.randomUUID();
      notes[id] = { ...note, id, title: `${note.title.slice(0, 494)}（恢复副本）` };
      copied += 1;
    }
  }
  return { content: decodeContent({ notes, collections }), added, replaced, skipped, copied };
}
