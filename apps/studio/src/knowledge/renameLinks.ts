import type { KnowledgeNote } from "./model";
import { analyzeMarkdown, resolveNoteLink, splitNoteTarget } from "./markdownAnalysis";

/** Bind unambiguous title references to identity, without serializing the Markdown AST. */
export function preserveRenamedLinks(
  before: Readonly<Record<string, KnowledgeNote>>,
  after: Record<string, KnowledgeNote>,
  id: string,
): Record<string, KnowledgeNote> {
  const previous = before[id],
    renamed = after[id];
  if (!previous || !renamed || previous.title === renamed.title) return after;
  const candidates = Object.values(before);
  const notes = { ...after };
  for (const note of Object.values(after)) {
    let body = note.body;
    const links = analyzeMarkdown(body).links;
    for (const link of links.toSorted((a, b) => b.from - a.from)) {
      const { name, heading } = splitNoteTarget(link.target);
      if (!name || name === id) continue;
      const matches = resolveNoteLink(candidates, link.target, note.id);
      if (matches.length !== 1 || matches[0]!.id !== id) continue;
      if (link.kind === "markdown") {
        // Stable identity is also a valid relative Markdown destination.
        const replacement = `${encodeURIComponent(id)}.md${heading ? `#${encodeURIComponent(heading)}` : ""}`;
        if (link.reference) {
          // Never retarget shared definitions: image references may use them too.
          const title =
            link.reference.title === null
              ? ""
              : ` "${link.reference.title.replace(/[\\"]/gu, "\\$&")}"`;
          body =
            body.slice(0, link.from) +
            `[${link.reference.label}](${replacement}${title})` +
            body.slice(link.to);
        } else if (link.destination) {
          const { from, to } = link.destination;
          body = body.slice(0, from) + replacement + body.slice(to);
        }
        continue;
      }
      const literal = body.slice(link.from + 2, link.to - 2);
      const separator = literal.indexOf("|");
      const label =
        separator < 0 || separator === literal.length - 1
          ? link.label
          : literal.slice(separator + 1);
      const replacement = `[[${id}${heading ? `#${heading}` : ""}|${label}]]`;
      body = body.slice(0, link.from) + replacement + body.slice(link.to);
    }
    if (body !== note.body) notes[note.id] = { ...note, body, updatedAt: Date.now() };
  }
  return notes;
}
