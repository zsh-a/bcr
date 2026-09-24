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

/** Bind unambiguous title references to identity, without serializing the Markdown AST. */
export function preserveRenamedLinks(
  before: Readonly<Record<string, KnowledgeNote>>,
  after: Record<string, KnowledgeNote>,
  id: string,
): Record<string, KnowledgeNote> {
  const previous = before[id],
    renamed = after[id];
  if (!previous || !renamed || previous.title === renamed.title) return after;
  const resolve = createNoteResolver(Object.values(before));
  const notes = { ...after };
  for (const note of Object.values(after)) {
    let body = note.body;
    const links = analyzeMarkdown(body).links;
    for (const link of links.toSorted((a, b) => b.from - a.from)) {
      const { name } = splitNoteTarget(link.target);
      if (!name || name === id) continue;
      const matches = resolve(link.target, note.id);
      if (matches.length !== 1 || matches[0]!.id !== id) continue;
      body = bindNoteLink(body, link, id);
    }
    if (body !== note.body) notes[note.id] = { ...note, body, updatedAt: Date.now() };
  }
  return notes;
}
