import {
  FILE_LIMIT,
  TRANSFER_LIMIT,
  MANIFEST,
  filesContent,
  contentFiles,
  isManagedPath,
} from "./files";
import {
  copyName,
  decodeContent,
  same,
  COLLECTION_NAME_MAX,
  NOTE_TITLE_MAX,
  type KnowledgeContent,
} from "../session/model";
import { availableCopyPath } from "../notes/paths";
import {
  attachmentArchivePath,
  attachmentReferences,
  ATTACHMENT_TRANSFER_LIMIT,
  mergeAttachments,
  rewriteAttachmentUrls,
} from "../attachments/attachmentModel";
import type { KnowledgeAttachments } from "../attachments/attachments";
import { stringify } from "yaml";

export type RestoreMode = "skip" | "replace" | "both";

export async function writeKnowledgeBackup(
  content: KnowledgeContent,
  attachments?: KnowledgeAttachments,
): Promise<Blob> {
  const valid = decodeContent(content);
  for (const note of Object.values(valid.notes)) {
    if (note.collectionId && !valid.collections[note.collectionId])
      throw new Error("请先补齐笔记所属集合再导出备份");
  }
  const files = contentFiles(valid);
  checkAttachmentReferences(valid);
  let total = 0;
  for (const text of Object.values(files)) {
    const bytes = new TextEncoder().encode(text).byteLength;
    total += bytes;
    if (bytes > FILE_LIMIT || total > TRANSFER_LIMIT)
      throw new Error("知识库超过备份容量限制，未生成不完整备份");
  }
  const { ZipWriter, BlobWriter, BlobReader, TextReader } = await import("./backupArchive");
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  try {
    for (const [path, text] of Object.entries(files)) await zip.add(path, new TextReader(text));
    const written = new Set<string>();
    for (const record of Object.values(valid.attachments ?? {})) {
      if (written.has(record.hash)) continue;
      total += record.size;
      if (total > ATTACHMENT_TRANSFER_LIMIT) throw new Error("包含附件的备份上限为 512 MiB");
      if (!attachments) throw new Error("备份需要附件存储，未生成不完整备份");
      await zip.add(
        attachmentArchivePath(record.hash),
        new BlobReader(await attachments.verify(record)),
        { level: 0 },
      );
      written.add(record.hash);
    }
    return await zip.close();
  } catch (error) {
    await zip.close().catch(() => undefined);
    throw error;
  }
}

/** Decode the portable archive without ever extracting paths to a filesystem. */
export async function readKnowledgeBackup(
  file: Blob,
  attachments?: KnowledgeAttachments,
): Promise<KnowledgeContent> {
  if (file.size > ATTACHMENT_TRANSFER_LIMIT) throw new Error("备份文件超过 512 MiB 限制");
  const { ZipReader, BlobReader } = await import("./backupArchive");
  const zip = new ZipReader(new BlobReader(file));
  const files: Record<string, string> = Object.create(null);
  const seen = new Set<string>();
  let total = 0,
    count = 0;
  const binary = new Map<string, import("@zip.js/zip.js").FileEntry>();
  try {
    for await (const entry of zip.getEntriesGenerator()) {
      if (++count > 22010) throw new Error("备份条目过多");
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
            "knowledge/attachments/",
          ].includes(path)
        )
          throw new Error("备份包含未知目录");
        continue;
      }
      const asset = /^knowledge\/attachments\/([a-f0-9]{64})\.bin$/u.exec(path);
      if (asset) {
        if (entry.uncompressedSize > 128 * 1024 * 1024)
          throw new Error("备份附件超过单文件容量限制");
        binary.set(asset[1]!, entry);
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
    checkAttachmentReferences(content);
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
    const records = new Map(
      Object.values(content.attachments ?? {}).map((asset) => [asset.hash, asset]),
    );
    if (records.size !== binary.size || [...binary.keys()].some((hash) => !records.has(hash)))
      throw new Error("备份附件与清单不匹配");
    for (const [hash, record] of records) {
      const entry = binary.get(hash);
      if (!entry || entry.uncompressedSize !== record.size)
        throw new Error(`备份缺少附件或大小不符：${record.name}`);
      total += record.size;
      if (total > ATTACHMENT_TRANSFER_LIMIT) throw new Error("备份解压内容超过 512 MiB 限制");
      if (!attachments) throw new Error("恢复包含附件的备份需要持久化文件存储");
      if (!entry.getData) throw new Error("备份附件不是文件");
      await attachments.extract(record, (sink) => entry.getData!(sink, { checkSignature: true }));
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
      collections[id] = {
        ...collection,
        id,
        name: copyName(collection.name, COLLECTION_NAME_MAX, "（恢复副本）"),
      };
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
      notes[id] = {
        ...note,
        id,
        title: copyName(note.title, NOTE_TITLE_MAX, "（恢复副本）"),
        ...(note.path === undefined ? {} : { path: availableCopyPath(note.path, notes) }),
      };
      copied += 1;
    }
  }
  return {
    content: decodeContent({
      notes,
      collections,
      folders: [...new Set([...base.folders, ...source.folders])],
      attachments: mergeAttachments(base.attachments, source.attachments),
    }),
    added,
    replaced,
    skipped,
    copied,
  };
}

function checkAttachmentReferences(content: KnowledgeContent) {
  for (const note of Object.values(content.notes))
    for (const ref of attachmentReferences(note.body))
      if (!content.attachments?.[ref.id])
        throw new Error(`「${note.title}」缺少附件记录，未生成不完整备份`);
}

/** A portable Markdown package: actual relative paths, no application-only URLs. */
export async function writeMarkdownArchive(
  content: KnowledgeContent,
  attachments: KnowledgeAttachments,
) {
  const valid = decodeContent(content);
  checkAttachmentReferences(valid);
  const { ZipWriter, BlobWriter, BlobReader, TextReader } = await import("./backupArchive");
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  const roots = new Set(
    Object.values(valid.notes).map((note) =>
      (note.path ?? `${note.id}.md`).split("/")[0]!.toLowerCase(),
    ),
  );
  let directory = "_attachments",
    suffix = 1;
  while (roots.has(directory.toLowerCase())) directory = `_attachments-${++suffix}`;
  const targets = new Map<string, string>();
  for (const asset of Object.values(valid.attachments ?? {})) {
    const extension = /\.[a-z\d]{1,12}$/iu.exec(asset.name)?.[0] ?? "";
    if (!targets.has(asset.hash)) targets.set(asset.hash, `${directory}/${asset.hash}${extension}`);
  }
  const written = new Set<string>();
  let total = 0;
  try {
    for (const note of Object.values(valid.notes)) {
      const path = note.path ?? `${note.id}.md`;
      const prefix = "../".repeat(path.split("/").length - 1);
      const body = rewriteAttachmentUrls(note.body, (id) => {
        const asset = valid.attachments![id]!;
        return `${prefix}${targets.get(asset.hash)!}`;
      });
      const raw = `---\n${stringify({ id: note.id, title: note.title, tags: note.tags, createdAt: note.createdAt, updatedAt: note.updatedAt, collection: note.collectionId ? valid.collections[note.collectionId]?.name : null, citations: note.citations }, { lineWidth: 0 })}---\n${body}`;
      total += new Blob([raw]).size;
      if (total > ATTACHMENT_TRANSFER_LIMIT) throw new Error("Markdown 附件包超过 512 MiB 限制");
      await zip.add(path, new TextReader(raw));
      for (const ref of attachmentReferences(note.body)) {
        const asset = valid.attachments![ref.id]!;
        const target = targets.get(asset.hash)!;
        if (written.has(target)) continue;
        total += asset.size;
        if (total > ATTACHMENT_TRANSFER_LIMIT) throw new Error("Markdown 附件包超过 512 MiB 限制");
        await zip.add(target, new BlobReader(await attachments.verify(asset)), { level: 0 });
        written.add(target);
      }
    }
    return await zip.close();
  } catch (error) {
    await zip.close().catch(() => undefined);
    throw error;
  }
}
