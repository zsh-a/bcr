import { cacheKey, textVersion } from "@bcr/core";
import { Schema } from "effect";
import { RENDERER_VERSION } from "@bcr/visual-renderer/model";
import { assertArticleAssets } from "./articleAssets";
import { decodeNote, type KnowledgeNote } from "../knowledge/session/model";
import {
  decodeAttachments,
  type KnowledgeAttachment,
} from "../knowledge/attachments/attachmentModel";
import {
  AssetSchema,
  claimStatus,
  decodeProject,
  runModel,
  analysisRuns,
  projectOutputs,
  type AnalysisRun,
  type ContentAsset,
  type ContentProject,
  type ModelRun,
} from "./model";

export interface ReleaseSnapshot {
  readonly version: 1;
  readonly id: string;
  readonly digest: string;
  readonly createdAt: number;
  readonly project: ContentProject;
  readonly article: KnowledgeNote | null;
  readonly run: ModelRun | null;
  readonly analysis?: readonly AnalysisRun[];
  readonly renderer: typeof RENDERER_VERSION;
  readonly font: ContentAsset;
  readonly attachments: readonly KnowledgeAttachment[];
}
export function releaseAssets(release: ReleaseSnapshot): ContentAsset[] {
  return [
    release.font,
    ...release.attachments,
    ...release.project.evidence.flatMap((e) => (e.asset ? [e.asset] : [])),
  ];
}
const digestOf = (value: Omit<ReleaseSnapshot, "id" | "digest">) =>
  cacheKey({
    operation: "content.release",
    inputs: [],
    config: { snapshot: value },
    runtimeVersion: "content-1",
  });
export function createRelease(
  project: ContentProject,
  article: KnowledgeNote | null,
  font: ContentAsset,
  attachments: readonly KnowledgeAttachment[],
): ReleaseSnapshot {
  const run = project.model ? runModel(project) : null;
  if (project.noteId !== (article?.id ?? null)) throw new Error("项目绑定的文稿已变化");
  if (!article?.body.trim() && !project.pages?.length) throw new Error("请先完成文稿或页面");
  if (article) assertArticleAssets(article.body, project, attachments);
  if (
    project.claims.some(
      (c) => !article || claimStatus(c, article.body, projectOutputs(project)) !== "current",
    )
  )
    throw new Error("请先复核或重新关联文稿中的判断");
  const analysis = analysisRuns(project);
  for (const page of project.pages ?? [])
    for (const block of Object.values(page.elements))
      if (
        block.type === "Text" &&
        block.props.model &&
        block.props.reviewedRun !== analysis.find((r) => r.model.id === block.props.model)?.id
      )
        throw new Error("请先复核页面中的判断");
  const snapshot: Omit<ReleaseSnapshot, "id" | "digest"> = {
    version: 1,
    createdAt: Date.now(),
    project: structuredClone(project),
    article: structuredClone(article),
    run,
    ...(project.models ? { analysis } : {}),
    renderer: RENDERER_VERSION,
    font,
    attachments: structuredClone(attachments),
  };
  const digest = digestOf(snapshot);
  return { ...snapshot, id: `release-${digest.slice(0, 32)}`, digest };
}
export function decodeRelease(value: unknown): ReleaseSnapshot {
  if (!value || typeof value !== "object") throw new Error("发布快照无效");
  const r = value as ReleaseSnapshot;
  if (
    r.version !== 1 ||
    r.renderer !== RENDERER_VERSION ||
    !Number.isSafeInteger(r.createdAt) ||
    r.createdAt < 0 ||
    !Array.isArray(r.attachments)
  )
    throw new Error("不支持的发布快照版本");
  const project = decodeProject(r.project),
    article = r.article === null ? null : decodeNote(r.article);
  const run = project.model ? runModel(project) : null;
  if (
    (article?.id ?? null) !== project.noteId ||
    textVersion(JSON.stringify(run)) !== textVersion(JSON.stringify(r.run))
  )
    throw new Error("发布快照的模型结果或文稿身份不一致");
  const font = Schema.decodeUnknownSync(AssetSchema)(r.font);
  const attachments = Object.values(
    decodeAttachments(Object.fromEntries(r.attachments.map((a) => [a.id, a]))) ?? {},
  );
  if (attachments.length !== r.attachments.length) throw new Error("发布快照附件身份重复");
  if (article) assertArticleAssets(article.body, project, attachments);
  const analysis = analysisRuns(project);
  if (
    project.models &&
    textVersion(JSON.stringify(analysis)) !== textVersion(JSON.stringify(r.analysis))
  )
    throw new Error("发布快照的通用模型结果不一致");
  const payload: Omit<ReleaseSnapshot, "id" | "digest"> = {
    version: 1,
    createdAt: r.createdAt,
    project,
    article,
    run,
    ...(project.models ? { analysis } : {}),
    renderer: RENDERER_VERSION,
    font,
    attachments,
  };
  const digest = digestOf(payload);
  if (digest !== r.digest || r.id !== `release-${digest.slice(0, 32)}`)
    throw new Error("发布快照摘要不匹配");
  return { ...payload, id: r.id, digest };
}
