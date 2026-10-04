import {
  BlobReader,
  BlobWriter,
  TextReader,
  ZipReader,
  ZipWriter,
  type Entry,
} from "@zip.js/zip.js";
import { hashReadableStream, textVersion } from "@bcr/core";
import { Schema } from "effect";
import { AssetSchema, decodeProject, type ContentAsset, type ContentProject } from "./model";
import { decodeRelease, releaseAssets, type ReleaseSnapshot } from "./release";
import type { ContentStore } from "./store";
import type { KnowledgeStore } from "../knowledge/session/store";
import { decodeNote, type KnowledgeNote } from "../knowledge/session/model";
import {
  decodeAttachments,
  attachmentReferences,
  rewriteMarkdownUrls,
  type KnowledgeAttachment,
} from "../knowledge/attachments/attachmentModel";
import { articleIdentity, assertSavedNote, snapshotAttachments } from "./service";
import { assertArticleAssets } from "./articleAssets";
import { parseVisualUrl, visualUrl } from "./links";

const MAX_TOTAL = 256 * 1024 * 1024;
const MAX_MANIFEST = 16 * 1024 * 1024;
interface Manifest {
  format: "bcr-content-package";
  version: 1;
  project: ContentProject;
  article: KnowledgeNote | null;
  attachments: KnowledgeAttachment[];
  releases: ReleaseSnapshot[];
  assets: ContentAsset[];
}
export interface PreparedArchive {
  readonly manifest: Manifest;
  readonly identity: string;
  readonly files: ReadonlyMap<string, Blob>;
}

function collectAssets(
  project: ContentProject,
  attachments: readonly KnowledgeAttachment[],
  releases: readonly ReleaseSnapshot[],
): ContentAsset[] {
  const map = new Map<string, ContentAsset>();
  for (const asset of [
    ...project.evidence.flatMap((e) => (e.asset ? [e.asset] : [])),
    ...attachments,
    ...releases.flatMap(releaseAssets),
  ]) {
    Schema.decodeUnknownSync(AssetSchema)(asset);
    const previous = map.get(asset.hash);
    if (previous && previous.size !== asset.size) throw new Error("同一素材摘要的大小不一致");
    map.set(asset.hash, { hash: asset.hash, name: asset.name, mime: asset.mime, size: asset.size });
  }
  const assets = [...map.values()].sort((a, b) => a.hash.localeCompare(b.hash));
  if (assets.length > 500 || assets.reduce((total, a) => total + a.size, 0) > MAX_TOTAL)
    throw new Error("项目归档超过首版 256 MiB / 500 个素材的限制");
  return assets;
}
export async function exportArchive(
  store: ContentStore,
  knowledge: KnowledgeStore,
  project: ContentProject,
  signal?: AbortSignal,
) {
  await knowledge.flush();
  const article = project.noteId
    ? structuredClone(assertSavedNote(knowledge, project.noteId))
    : null;
  const attachments = article ? await snapshotAttachments(store, knowledge, article) : [];
  if (article) assertArticleAssets(article.body, project, attachments);
  const releases = await Promise.all(project.releases.map((id) => store.release(id)));
  const assets = collectAssets(project, attachments, releases);
  const manifest: Manifest = {
    format: "bcr-content-package",
    version: 1,
    project: structuredClone(project),
    article,
    attachments,
    releases,
    assets,
  };
  const raw = JSON.stringify(manifest);
  if (new Blob([raw]).size > MAX_MANIFEST) throw new Error("归档清单超过 16 MiB");
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  try {
    for (const asset of assets) {
      signal?.throwIfAborted();
      await zip.add(`assets/${asset.hash}`, new BlobReader(await store.assets.read(asset)), {
        ...(signal ? { signal } : {}),
        useWebWorkers: false,
      });
    }
    if (
      store.getSnapshot().find((p) => p.id === project.id)?.revision !== project.revision ||
      (article &&
        articleIdentity(assertSavedNote(knowledge, article.id)) !== articleIdentity(article))
    )
      throw new Error("归档期间项目或文稿发生变化，请重新导出");
    await zip.add("manifest.json", new TextReader(raw), {
      ...(signal ? { signal } : {}),
      useWebWorkers: false,
    });
    return await zip.close();
  } catch (error) {
    await zip.close().catch(() => undefined);
    throw error;
  }
}

async function extract(entry: Entry, limit: number, signal?: AbortSignal): Promise<Blob> {
  if (entry.directory || !entry.getData || entry.uncompressedSize > limit)
    throw new Error("归档条目超限或类型无效");
  const parts: BlobPart[] = [];
  let bytes = 0;
  await entry.getData(
    new WritableStream<Uint8Array>({
      write(chunk) {
        signal?.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > limit) throw new Error("归档解压内容超出声明大小");
        parts.push(chunk.slice() as BlobPart);
      },
    }),
    { ...(signal ? { signal } : {}), checkSignature: true, useWebWorkers: false },
  );
  if (bytes !== entry.uncompressedSize) throw new Error("归档条目大小不匹配");
  return new Blob(parts);
}

/** Validate the entire dependency closure before writing anything to a workspace. */
export async function prepareArchive(file: Blob, signal?: AbortSignal): Promise<PreparedArchive> {
  if (file.size > MAX_TOTAL + MAX_MANIFEST + 1024 * 1024) throw new Error("归档文件超过容量限制");
  const zip = new ZipReader(new BlobReader(file));
  try {
    const entries = await zip.getEntries();
    if (
      entries.length > 501 ||
      new Set(entries.map((e) => e.filename)).size !== entries.length ||
      entries.some(
        (e) =>
          e.directory ||
          e.encrypted ||
          !/^(?:manifest\.json|assets\/[a-f0-9]{64})$/u.test(e.filename),
      )
    )
      throw new Error("归档含重复、未知或不安全的路径");
    const root = entries.find((e) => e.filename === "manifest.json");
    if (!root) throw new Error("归档缺少清单");
    const raw = await (await extract(root, MAX_MANIFEST, signal)).text();
    const value = JSON.parse(raw) as Manifest;
    if (
      value?.format !== "bcr-content-package" ||
      value.version !== 1 ||
      !Array.isArray(value.releases) ||
      value.releases.length > 100 ||
      !Array.isArray(value.assets) ||
      !Array.isArray(value.attachments)
    )
      throw new Error("不支持的内容归档格式");
    const project = decodeProject(value.project);
    const article = value.article === null ? null : decodeNote(value.article);
    if (project.noteId !== (article?.id ?? null)) throw new Error("归档文稿身份不匹配");
    const attachments = Object.values(
      decodeAttachments(Object.fromEntries(value.attachments.map((a) => [a.id, a]))) ?? {},
    );
    if (attachments.length !== value.attachments.length) throw new Error("附件身份重复");
    if (article) assertArticleAssets(article.body, project, attachments);
    if (
      article &&
      attachmentReferences(article.body).some((r) => !attachments.some((a) => a.id === r.id))
    )
      throw new Error("文稿依赖的附件不完整");
    const releases = value.releases.map(decodeRelease);
    if (
      releases.length !== project.releases.length ||
      new Set(releases.map((r) => r.id)).size !== releases.length ||
      project.releases.some((id) => !releases.some((r) => r.id === id))
    )
      throw new Error("归档发布快照不完整");
    const assets = collectAssets(project, attachments, releases);
    const declared = value.assets.map((asset) => Schema.decodeUnknownSync(AssetSchema)(asset));
    if (
      declared.length !== assets.length ||
      new Set(declared.map((a) => a.hash)).size !== declared.length ||
      assets.some((a) => !declared.some((d) => d.hash === a.hash && d.size === a.size))
    )
      throw new Error("归档素材依赖不完整");
    if (entries.length !== assets.length + 1) throw new Error("归档包含未声明的素材");
    const files = new Map<string, Blob>();
    for (const asset of assets) {
      const entry = entries.find((e) => e.filename === `assets/${asset.hash}`);
      if (!entry || entry.uncompressedSize !== asset.size)
        throw new Error(`归档缺少素材：${asset.name}`);
      const blob = await extract(entry, asset.size, signal);
      if ((await hashReadableStream(blob.stream(), { signal })) !== asset.hash)
        throw new Error(`归档素材校验失败：${asset.name}`);
      files.set(asset.hash, blob.slice(0, blob.size, asset.mime));
    }
    return {
      manifest: {
        format: "bcr-content-package",
        version: 1,
        project,
        article,
        attachments,
        releases,
        assets,
      },
      identity: textVersion(raw),
      files,
    };
  } finally {
    await zip.close();
  }
}

/** Deterministic imported identities make a retry after either domain commit idempotent. */
export async function restoreArchive(
  prepared: PreparedArchive,
  store: ContentStore,
  knowledge: KnowledgeStore,
  signal?: AbortSignal,
): Promise<ContentProject> {
  await Promise.all([store.ready, knowledge.ready]);
  signal?.throwIfAborted();
  const { manifest: m, identity } = prepared;
  const id = `restored-${identity.slice(0, 32)}`,
    noteId = m.article ? `content-${id}` : null;
  for (const asset of m.assets) {
    const blob = prepared.files.get(asset.hash);
    if (!blob) throw new Error("已校验的恢复素材缺失");
    await store.assets.put(asset, blob, signal);
  }
  let note: KnowledgeNote | null = null;
  if (m.article && noteId) {
    note = {
      ...m.article,
      id: noteId,
      path: `内容项目恢复/${id}.md`,
      collectionId: null,
      body: rewriteMarkdownUrls(m.article.body, (url) => {
        const target = parseVisualUrl(url);
        return target?.project === m.project.id ? visualUrl(id, target.index) : null;
      }),
    };
    const existing = knowledge.getSnapshot().notes[noteId];
    if (existing && articleIdentity(existing) !== articleIdentity(note))
      throw new Error("恢复副本的文稿已被修改，未覆盖；请保留当前副本");
    for (const asset of m.attachments)
      await knowledge.attachments.put(asset, prepared.files.get(asset.hash)!);
    signal?.throwIfAborted();
    await knowledge.importContent({
      notes: { [noteId]: note },
      collections: {},
      folders: [],
      ...(m.attachments.length
        ? { attachments: Object.fromEntries(m.attachments.map((a) => [a.id, a])) }
        : {}),
    });
  }
  await store.refresh();
  const existing = store.getSnapshot().find((p) => p.id === id);
  if (existing) return existing;
  const claims = m.project.claims.map((c) => ({
    ...c,
    anchor: { ...c.anchor, source: { ...c.anchor.source, scope: noteId!, unit: noteId! } },
  }));
  const project = decodeProject({ ...m.project, id, noteId, claims });
  return store.save(project, null, m.releases, () => signal?.throwIfAborted());
}
