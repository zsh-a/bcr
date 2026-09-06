import { textVersion, decodeTextCitation } from "@bcr/core";
import { decodeResearch, type ResearchCollection, type ResearchLibrary } from "./research";
import { draftKey, readDraft } from "./researchManagement";

export const MAX_RESEARCH_BACKUP_BYTES = 16 * 1024 * 1024;
export interface ResearchBackup {
  readonly format: "bcr-research-backup";
  readonly version: 1;
  readonly createdAt: number;
  readonly includesDrafts: boolean;
  readonly library: ResearchLibrary;
}

// Rebuild in stable field order and discard unknown fields at the import boundary.
function canonicalLibrary(library: ResearchLibrary): ResearchLibrary {
  return {
    version: 1,
    collections: library.collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      excerpts: collection.excerpts.map((item) => ({
        id: item.id,
        documentId: item.documentId,
        title: item.title,
        source: item.source,
        route: item.route,
        text: item.text,
        note: item.note,
        savedAt: item.savedAt,
        ...(item.links === undefined
          ? {}
          : {
              links: item.links.map((link) => ({
                documentId: link.documentId,
                title: link.title,
                source: link.source,
                owner: link.owner,
                route: link.route,
                text: link.text,
                citation: decodeTextCitation(link.citation)!,
                linkedAt: link.linkedAt,
              })),
            }),
        ...(item.owner === undefined ? {} : { owner: item.owner }),
        ...(item.citation === undefined ? {} : { citation: decodeTextCitation(item.citation)! }),
        ...(item.draft === undefined || item.draft === item.note ? {} : { draft: item.draft }),
      })),
    })),
  };
}

export function decodeResearchBackup(raw: string): ResearchBackup {
  if (new TextEncoder().encode(raw).byteLength > MAX_RESEARCH_BACKUP_BYTES)
    throw new Error("集合备份超过 16 MiB 限制");
  const value = JSON.parse(raw) as Partial<ResearchBackup> | null;
  if (
    !value ||
    value.format !== "bcr-research-backup" ||
    value.version !== 1 ||
    typeof value.includesDrafts !== "boolean" ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(new Date(value.createdAt).getTime()) ||
    !value.library
  ) {
    throw new Error("不是受支持的集合备份 v1");
  }
  const library = canonicalLibrary(decodeResearch(JSON.stringify(value.library)));
  if (
    !value.includesDrafts &&
    library.collections.some((collection) =>
      collection.excerpts.some((item) => item.draft !== undefined),
    )
  ) {
    throw new Error("备份草稿声明与内容不一致");
  }
  return {
    format: "bcr-research-backup",
    version: 1,
    createdAt: value.createdAt,
    includesDrafts: value.includesDrafts,
    library,
  };
}

export function createResearchBackup(
  library: ResearchLibrary,
  includeDrafts: boolean,
  storage: Pick<Storage, "getItem">,
  now = Date.now(),
): ResearchBackup {
  const exported: ResearchLibrary = {
    version: 1,
    collections: library.collections.map((collection) => ({
      ...collection,
      excerpts: collection.excerpts.map((item) => {
        const { draft: _draft, ...saved } = item;
        const draft = includeDrafts ? readDraft(item, storage) : item.note;
        return draft === item.note ? saved : { ...saved, draft };
      }),
    })),
  };
  return decodeResearchBackup(
    JSON.stringify({
      format: "bcr-research-backup",
      version: 1,
      createdAt: now,
      includesDrafts: includeDrafts,
      library: exported,
    }),
  );
}

export interface ResearchImportPlan {
  readonly library: ResearchLibrary;
  readonly added: number;
  readonly skipped: number;
  readonly copies: number;
}

/** Never overwrite local content. Conflicts get stable identities for repeat imports. */
export function planResearchImport(
  current: ResearchLibrary,
  backup: ResearchBackup,
): ResearchImportPlan {
  const collections = [...current.collections];
  const byId = new Map(collections.map((item) => [item.id, item]));
  const draftKeys = new Set(collections.flatMap((item) => item.excerpts.map(draftKey)));
  let added = 0,
    skipped = 0,
    copies = 0;
  const serialize = (item: ResearchCollection) =>
    JSON.stringify(canonicalLibrary({ version: 1, collections: [item] }).collections[0]);
  for (const incoming of backup.library.collections) {
    let candidate = incoming;
    let existing = byId.get(candidate.id);
    let copy = false;
    while (
      (existing && serialize(existing) !== serialize(candidate)) ||
      (!existing && candidate.excerpts.some((entry) => draftKeys.has(draftKey(entry))))
    ) {
      copy = true;
      const suffix = textVersion(serialize(candidate));
      candidate = {
        ...incoming,
        id: `import:${suffix}`,
        name: `${incoming.name}（导入副本）`,
        excerpts: incoming.excerpts.map((item) => ({ ...item, id: `import:${suffix}:${item.id}` })),
      };
      existing = byId.get(candidate.id);
    }
    if (existing) {
      skipped++;
      continue;
    }
    collections.push(candidate);
    byId.set(candidate.id, candidate);
    for (const item of candidate.excerpts) draftKeys.add(draftKey(item));
    added++;
    if (copy) copies++;
  }
  return { library: { version: 1, collections }, added, skipped, copies };
}
