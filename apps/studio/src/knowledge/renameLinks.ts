import type { KnowledgeNote } from "./model";
import {
  analyzeMarkdown,
  createNoteResolver,
  splitNoteTarget,
  type NoteLink,
} from "./markdownAnalysis";

export function bindNoteLink(body: string, link: NoteLink, id: string): string {
  const { heading } = splitNoteTarget(link.target);
  if (link.kind === "markdown") {
    const replacement = `${encodeURIComponent(id)}.md${heading ? `#${encodeURIComponent(heading)}` : ""}`;
    if (link.reference) {
      const title =
        link.reference.title === null
          ? ""
          : ` "${link.reference.title.replace(/[\\"]/gu, "\\$&")}"`;
      return (
        body.slice(0, link.from) +
        `[${link.reference.label}](${replacement}${title})` +
        body.slice(link.to)
      );
    }
    if (link.destination)
      return body.slice(0, link.destination.from) + replacement + body.slice(link.destination.to);
    return body;
  }
  const literal = body.slice(link.from + 2, link.to - 2),
    separator = literal.indexOf("|");
  const label =
    separator < 0 || separator === literal.length - 1 ? link.label : literal.slice(separator + 1);
  return (
    body.slice(0, link.from) +
    `[[${id}${heading ? `#${heading}` : ""}|${label}]]` +
    body.slice(link.to)
  );
}

/** 同名多解、无法安全改写的引用；自动重命名保持原样并交给确认对话框。 */
export interface AmbiguousLink {
  readonly noteId: string;
  readonly noteTitle: string;
  readonly label: string;
  readonly target: string;
}

export interface RenamedLinks {
  readonly notes: Record<string, KnowledgeNote>;
  /** 被改写为身份引用的链接数（撤销提示的「更新 N 处链接」）。 */
  readonly rewrites: number;
  readonly ambiguous: readonly AmbiguousLink[];
}

/**
 * Bind unambiguous title references to identity, without serializing the Markdown AST.
 *
 * Same-name links that could also belong to another note are never guessed:
 * they stay untouched and surface in `ambiguous` (before or after the rename).
 */
export function applyRenamedLinks(
  before: Readonly<Record<string, KnowledgeNote>>,
  after: Record<string, KnowledgeNote>,
  id: string,
): RenamedLinks {
  const previous = before[id],
    renamed = after[id];
  if (!previous || !renamed || previous.title === renamed.title)
    return { notes: after, rewrites: 0, ambiguous: [] };
  const beforeResolve = createNoteResolver(Object.values(before)),
    afterResolve = createNoteResolver(Object.values(after));
  const notes = { ...after };
  let rewrites = 0;
  const ambiguous: AmbiguousLink[] = [];
  for (const note of Object.values(after)) {
    let body = note.body;
    const links = analyzeMarkdown(body).links;
    for (const link of links.toSorted((a, b) => b.from - a.from)) {
      const { name } = splitNoteTarget(link.target);
      if (!name || name === id) continue;
      const matches = beforeResolve(link.target, note.id);
      if (matches.length === 1 && matches[0]!.id === id) {
        body = bindNoteLink(body, link, id);
        rewrites++;
        continue;
      }
      const settled = [matches, afterResolve(link.target, note.id)];
      if (settled.some((found) => found.length > 1 && found.some((match) => match.id === id)))
        ambiguous.push({
          noteId: note.id,
          noteTitle: note.title,
          label: link.label,
          target: link.target,
        });
    }
    if (body !== note.body) notes[note.id] = { ...note, body, updatedAt: Date.now() };
  }
  return { notes, rewrites, ambiguous };
}

/** Store saves keep the historic signature: only the rewritten note map crosses the boundary. */
export function preserveRenamedLinks(
  before: Readonly<Record<string, KnowledgeNote>>,
  after: Record<string, KnowledgeNote>,
  id: string,
): Record<string, KnowledgeNote> {
  return applyRenamedLinks(before, after, id).notes;
}
