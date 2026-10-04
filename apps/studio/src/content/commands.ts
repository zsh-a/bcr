import { Schema } from "effect";
import { cacheKey } from "@bcr/core";
import { AnalysisModelSchema } from "@bcr/economics-core/analysis";
import {
  decodeProject,
  EvidenceSchema,
  ModelSchema,
  VisualSchema,
  PublicationSchema,
  ClaimSchema,
  type ContentProject,
} from "./model";
import { PagePatchSchema, PageSchema, patchPage } from "./pages/model";
import type { ContentStore } from "./store";

const id = Schema.String.pipe(Schema.maxLength(100));
/** A single validated project transaction can include related model/page/source changes. */
export const ChangesSchema = Schema.Struct({
  metadata: Schema.optional(
    Schema.Struct({
      title: Schema.optional(Schema.String),
      question: Schema.optional(Schema.String),
      audience: Schema.optional(Schema.String),
      hypothesis: Schema.optional(Schema.String),
      status: Schema.optional(Schema.Literal("research", "writing", "ready", "published")),
      noteId: Schema.optional(Schema.NullOr(id)),
    }),
  ),
  models: Schema.optional(Schema.Array(AnalysisModelSchema).pipe(Schema.maxItems(16))),
  removeModels: Schema.optional(Schema.Array(id).pipe(Schema.maxItems(16))),
  pages: Schema.optional(Schema.Array(Schema.Unknown).pipe(Schema.maxItems(20))),
  pagePatches: Schema.optional(Schema.Array(Schema.Unknown).pipe(Schema.maxItems(20))),
  removePages: Schema.optional(Schema.Array(id).pipe(Schema.maxItems(20))),
  evidence: Schema.optional(Schema.Array(EvidenceSchema).pipe(Schema.maxItems(100))),
  removeEvidence: Schema.optional(Schema.Array(id).pipe(Schema.maxItems(100))),
  publications: Schema.optional(Schema.Array(PublicationSchema).pipe(Schema.maxItems(100))),
  claims: Schema.optional(Schema.Array(ClaimSchema).pipe(Schema.maxItems(200))),
  legacyModel: Schema.optional(ModelSchema),
  legacyVisuals: Schema.optional(Schema.Array(VisualSchema).pipe(Schema.maxItems(8))),
});
export type ContentChanges = typeof ChangesSchema.Type;
function upsert<T extends { readonly id: string }>(
  previous: readonly T[],
  next: readonly T[] = [],
  remove: readonly string[] = [],
): T[] {
  if (new Set(next.map((v) => v.id)).size !== next.length) throw new Error("变更中存在重复 ID");
  if (next.some((v) => remove.includes(v.id))) throw new Error("同一项不能同时修改与移除");
  return [
    ...previous.filter((v) => !remove.includes(v.id) && !next.some((n) => n.id === v.id)),
    ...next,
  ];
}
export function prepareChanges(project: ContentProject, input: unknown): ContentProject {
  const change = Schema.decodeUnknownSync(ChangesSchema, { onExcessProperty: "error" })(input);
  const models = upsert(project.models ?? [], change.models, change.removeModels);
  // Decode all page replacements with the resulting models before local block patches.
  const preliminary = {
    ...project,
    ...change.metadata,
    ...(change.models || change.removeModels ? { models } : {}),
    ...(change.pages || change.removePages
      ? {
          pages: upsert(
            project.pages ?? [],
            change.pages?.map((p) => PageSchema.parse(p)),
            change.removePages,
          ),
        }
      : {}),
    evidence: upsert(project.evidence, change.evidence, change.removeEvidence),
    publications: upsert(project.publications, change.publications),
    ...(change.claims ? { claims: change.claims } : {}),
    ...(change.legacyModel ? { model: change.legacyModel } : {}),
    ...(change.legacyVisuals ? { visuals: change.legacyVisuals } : {}),
  };
  let pages = preliminary.pages;
  for (const raw of change.pagePatches ?? []) {
    const patch = PagePatchSchema.parse(raw),
      page = pages?.find((p) => p.id === patch.id);
    if (!page) throw new Error("待修改页面不存在");
    pages = pages!.map((p) => (p.id === page.id ? patchPage(p, patch, models) : p));
  }
  return decodeProject({ ...preliminary, ...(pages ? { pages } : {}) });
}
export function requestIdentity(requestId: string, payload: unknown) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(requestId)) throw new Error("requestId 无效");
  return {
    id: requestId,
    digest: cacheKey({
      operation: "content.command",
      inputs: [],
      config: { payload },
      runtimeVersion: "1",
    }),
  };
}
export async function readProject(
  store: ContentStore,
  id: string,
  revision?: string,
): Promise<ContentProject> {
  await store.refresh();
  const project = store.getSnapshot().find((p) => p.id === id);
  if (!project) throw new Error("项目不存在");
  if (revision !== undefined && project.revision !== revision)
    throw new Error("项目已变化，请重新读取 revision");
  return project;
}
export async function applyChanges(
  store: ContentStore,
  id: string,
  revision: string,
  input: unknown,
  requestId: string,
  signal?: AbortSignal,
) {
  const request = requestIdentity(requestId, { kind: "apply", id, revision, input });
  const previous = await store.receipt(request);
  if (previous) return previous;
  const project = await readProject(store, id, revision);
  const next = prepareChanges(project, input);
  return store.save(
    next,
    revision,
    [],
    () => {
      signal?.throwIfAborted();
      store.assertWritable(id);
    },
    request,
  );
}
/** Whole-form edits and assistant changes share validation and optimistic concurrency. */
export async function saveProject(store: ContentStore, project: ContentProject) {
  return store.save(decodeProject(project), project.revision);
}
