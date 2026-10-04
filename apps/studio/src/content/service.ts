import { newNote, type KnowledgeNote } from "../knowledge/session/model";
import type { KnowledgeStore } from "../knowledge/session/store";
import { noteRevision } from "../knowledge/notes/noteRevision";
import {
  attachmentReferences,
  type KnowledgeAttachment,
} from "../knowledge/attachments/attachmentModel";
import { draftStorageKey } from "../knowledge/editor/draft";
import { createRelease } from "./release";
import { decodeProject, newProject, type ContentProject } from "./model";
import type { ContentStore } from "./store";
import fontUrl from "@ibm/plex-sans-sc/fonts/complete/woff/hinted/IBMPlexSansSC-Regular.woff?url";
import { visualUrl } from "./links";
export function assertSavedNote(knowledge: KnowledgeStore, id: string) {
  knowledge.assertNoteWritable(id);
  if (typeof localStorage !== "undefined" && localStorage.getItem(draftStorageKey(id)) !== null)
    throw new Error("文稿还有恢复草稿，请先打开并保存文稿");
  const note = knowledge.getSnapshot().notes[id];
  if (!note) throw new Error("项目文稿已删除，请重新关联");
  return note;
}
export async function createContentProject(
  store: ContentStore,
  knowledge: KnowledgeStore,
): Promise<ContentProject> {
  await Promise.all([store.ready, knowledge.ready]);
  const project = newProject();
  const note: KnowledgeNote = {
    ...newNote(project.title),
    id: `content-${project.id}`,
    body: `# ${project.title}\n\n以下为自设示例：年卡 2400 元，次卡 60 元，不代表真实报价。\n\n使用 40 次时两种方案持平，从第 41 次起年卡更便宜。\n\n![方案比较图](${visualUrl(project.id, 0)})\n\n![临界点曲线](${visualUrl(project.id, 1)})\n\n## 需要核对的条件\n\n年卡与次卡的服务范围、有效期和额外费用是否相同？实际出勤率会改变平均单次成本。\n`,
  };
  await knowledge.saveNote(note, null);
  return store.save(decodeProject({ ...project, noteId: note.id }), null);
}
export async function snapshotAttachments(
  store: ContentStore,
  knowledge: KnowledgeStore,
  note: KnowledgeNote,
): Promise<KnowledgeAttachment[]> {
  const records = knowledge.getSnapshot().attachments ?? {};
  const ids = [...new Set(attachmentReferences(note.body).map((r) => r.id))];
  const attachments: KnowledgeAttachment[] = [];
  for (const id of ids) {
    const record = records[id];
    if (!record) throw new Error(`文稿附件缺失：${id}`);
    const blob = await knowledge.attachments.verify(record);
    await store.assets.put(record, blob);
    attachments.push(record);
  }
  return attachments;
}
export async function publishSnapshot(
  store: ContentStore,
  knowledge: KnowledgeStore,
  project: ContentProject,
  options?: {
    signal?: AbortSignal | undefined;
    request?: { id: string; digest: string };
    check?: () => void;
  },
) {
  if (options?.request) {
    const saved = await store.receipt(options.request);
    if (saved) return store.release(saved.releases.at(-1)!);
  }
  options?.signal?.throwIfAborted();
  options?.check?.();
  await knowledge.flush();
  const article = project.noteId
    ? structuredClone(assertSavedNote(knowledge, project.noteId))
    : null;
  const revision = articleIdentity(article);
  const attachments = article ? await snapshotAttachments(store, knowledge, article) : [];
  for (const evidence of project.evidence)
    if (evidence.asset) await store.assets.read(evidence.asset);
  const response = await fetch(fontUrl, options?.signal ? { signal: options.signal } : {});
  if (!response.ok) throw new Error("导出字体加载失败，请重试");
  const font = await store.assets.import(await response.blob(), "IBMPlexSansSC-Regular.woff");
  const release = createRelease(project, article, font, attachments);
  const saved = await store.save(
    { ...project, status: "ready", releases: [...project.releases, release.id] },
    project.revision,
    [release],
    () => {
      options?.signal?.throwIfAborted();
      options?.check?.();
      if (article && noteRevision(assertSavedNote(knowledge, article.id)) !== revision)
        throw new Error("生成快照期间文稿发生变化，请重新生成");
    },
    options?.request,
  );
  return saved.releases.at(-1) === release.id ? release : store.release(saved.releases.at(-1)!);
}
export const articleIdentity = (note: KnowledgeNote | null) => (note ? noteRevision(note) : null);
