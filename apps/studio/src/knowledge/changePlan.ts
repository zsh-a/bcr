import { decodeNote, same, type KnowledgeNote } from "./model";
import { noteRevision } from "./noteRevision";
import { preserveRenamedLinks, bindNoteLink } from "./renameLinks";
import { analyzeMarkdown, createNoteResolver } from "./markdownAnalysis";
import { assertUniquePaths, normalizeNotePath, notePath, pathKey, parentPath } from "./paths";

export interface NoteChangePlan {
  readonly kind: "rename" | "move";
  readonly targetId: string;
  readonly title: string;
  readonly versions: Readonly<Record<string, string>>;
  readonly changes: readonly { readonly before: KnowledgeNote; readonly after: KnowledgeNote }[];
}

export function noteVersions(notes: Readonly<Record<string, KnowledgeNote>>) {
  return Object.fromEntries(
    Object.keys(notes)
      .sort()
      .map((id) => [id, noteRevision(notes[id]!)]),
  );
}

/** Pure planning: no writes, approval, or persistence side effects. */
export function planNoteRename(
  notes: Readonly<Record<string, KnowledgeNote>>,
  id: string,
  title: string,
): NoteChangePlan {
  const before = notes[id];
  if (!before) throw new Error("笔记已删除，请重新选择");
  const renamed = decodeNote({ ...before, title, updatedAt: Date.now() });
  const next =
    title === before.title ? notes : preserveRenamedLinks(notes, { ...notes, [id]: renamed }, id);
  return structuredClone({
    targetId: id,
    kind: "rename" as const,
    title,
    versions: noteVersions(notes),
    changes: Object.values(next)
      .filter((note) => !same(note, notes[note.id]))
      .map((after) => ({ before: notes[after.id]!, after })),
  });
}

/** Preserve each previously resolved link's identity, including outgoing relative links. */
export function planNoteMove(
  notes: Readonly<Record<string, KnowledgeNote>>,
  moves: Readonly<Record<string, string>>,
): NoteChangePlan {
  const next = { ...notes },
    ids = Object.keys(moves);
  if (!ids.length) throw new Error("请选择需要移动的笔记");
  for (const id of ids) {
    const note = notes[id];
    if (!note) throw new Error("笔记已删除，请刷新列表");
    const path = normalizeNotePath(moves[id]);
    if (path !== notePath(note)) next[id] = { ...note, path, updatedAt: Date.now() };
  }
  assertUniquePaths(next);
  const beforeResolve = createNoteResolver(Object.values(notes)),
    afterResolve = createNoteResolver(Object.values(next));
  for (const note of Object.values(next)) {
    let body = note.body;
    for (const link of analyzeMarkdown(body).links.toSorted((a, b) => b.from - a.from)) {
      const previous = beforeResolve(link.target, note.id),
        following = afterResolve(link.target, note.id);
      if (previous.length !== 1 || (following.length === 1 && following[0]!.id === previous[0]!.id))
        continue;
      body = bindNoteLink(body, link, previous[0]!.id);
    }
    if (body !== note.body) next[note.id] = { ...note, body, updatedAt: Date.now() };
  }
  return structuredClone({
    kind: "move",
    targetId: ids[0]!,
    title: notes[ids[0]!]!.title,
    versions: noteVersions(notes),
    changes: Object.values(next)
      .filter((note) => !same(note, notes[note.id]))
      .map((after) => ({ before: notes[after.id]!, after })),
  });
}

export function folderMoves(
  notes: Readonly<Record<string, KnowledgeNote>>,
  source: string,
  destination: string,
) {
  const from = parentPath(normalizeNotePath(`${source}/placeholder.md`));
  const to = destination ? parentPath(normalizeNotePath(`${destination}/placeholder.md`)) : "";
  if (pathKey(to) === pathKey(from) || pathKey(to).startsWith(`${pathKey(from)}/`))
    throw new Error("不能将文件夹移动到自身或子目录");
  return Object.fromEntries(
    Object.values(notes)
      .filter((note) => pathKey(notePath(note)).startsWith(`${pathKey(from)}/`))
      .map((note) => [
        note.id,
        `${to ? `${to}/` : ""}${notePath(note).split("/").slice(from.split("/").length).join("/")}`,
      ]),
  );
}
