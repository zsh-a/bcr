import { decodeNote, same, type KnowledgeNote } from "./model";
import { noteRevision } from "./noteRevision";
import { preserveRenamedLinks } from "./renameLinks";

export interface NoteChangePlan {
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
    title,
    versions: noteVersions(notes),
    changes: Object.values(next)
      .filter((note) => !same(note, notes[note.id]))
      .map((after) => ({ before: notes[after.id]!, after })),
  });
}
