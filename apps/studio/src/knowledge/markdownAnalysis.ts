import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, PhrasingContent, Text } from "mdast";
import type { KnowledgeNote } from "./model";

const parser = unified().use(remarkParse).use(remarkGfm);
export const linkKey = (value: string) => value.normalize("NFKC").trim().toLowerCase();
export interface NoteLink {
  kind: "wiki" | "markdown";
  target: string;
  label: string;
  from: number;
  to: number;
  /** Raw inline Markdown destination, excluding angle brackets and optional title. */
  destination?: { from: number; to: number };
}
export interface NoteHeading {
  text: string;
  depth: number;
  from: number;
}
export interface NoteAnalysis {
  links: NoteLink[];
  headings: NoteHeading[];
}

function textOf(node: RootContent): string {
  if ("value" in node) return node.value;
  return "children" in node ? node.children.map((child) => textOf(child)).join("") : "";
}

/** Inspect raw text spans so escaped brackets and code never become links. */
function wikiLinks(node: Text, source: string): NoteLink[] {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return [];
  const raw = source.slice(start, end),
    links: NoteLink[] = [];
  for (const match of raw.matchAll(/\[\[([^\]\n[]+)\]\]/gu)) {
    const from = match.index;
    let escapes = 0;
    for (let i = from - 1; i >= 0 && raw[i] === "\\"; i--) escapes++;
    if (escapes % 2 || raw[from - 1] === "!") continue;
    const [target, ...alias] = match[1]!.split("|");
    if (!target?.trim() || target.length > 600) continue;
    links.push({
      kind: "wiki",
      target: target.trim(),
      label: alias.join("|") || target.trim(),
      from: start + from,
      to: start + from + match[0].length,
    });
  }
  return links;
}

export function internalTarget(url: string): string | null {
  if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/iu.test(url)) return null;
  try {
    return decodeURIComponent(url).replace(/\.md(?=#|$)/iu, "");
  } catch {
    return null;
  }
}

function markdownDestination(node: Extract<RootContent, { type: "link" }>, source: string) {
  const from = node.position?.start.offset,
    end = node.position?.end.offset;
  if (from === undefined || end === undefined || source[from] !== "[") return undefined;
  const labelEnd = node.children.at(-1)?.position?.end.offset ?? from + 1;
  // AST children give the end of the label, including nested formatting/images.
  if (source.slice(labelEnd, labelEnd + 2) !== "](") return undefined;
  let start = labelEnd + 2;
  while (/\s/u.test(source[start] ?? "") && start < end) start++;
  const angled = source[start] === "<";
  if (angled) start++;
  let depth = 0,
    cursor = start;
  for (; cursor < end; cursor++) {
    const char = source[cursor];
    if (char === "\\") {
      cursor++;
      continue;
    }
    if (angled) {
      if (char === ">") break;
    } else {
      if (char === "(") depth++;
      else if (char === ")") {
        if (!depth) break;
        depth--;
      } else if (/\s/u.test(char!)) break;
    }
  }
  return cursor > start && cursor < end ? { from: start, to: cursor } : undefined;
}

function walk(node: Root | RootContent, source: string, result: NoteAnalysis, transform: boolean) {
  if (node.type === "heading") {
    const from = node.position?.start.offset ?? 0;
    result.headings.push({ text: textOf(node), depth: node.depth, from });
    if (transform)
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, id: `note-heading-${from}` },
      };
  }
  if (node.type === "link") {
    const target = internalTarget(node.url);
    if (target !== null) {
      const destination = markdownDestination(node, source);
      result.links.push({
        kind: "markdown",
        target,
        label: textOf(node),
        from: node.position?.start.offset ?? 0,
        to: node.position?.end.offset ?? 0,
        ...(destination ? { destination } : {}),
      });
    }
    return;
  }
  if (!("children" in node) || node.type === "linkReference") return;
  const children = node.children as RootContent[];
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    if (child.type !== "text") {
      walk(child, source, result, transform);
      continue;
    }
    const links = wikiLinks(child, source);
    result.links.push(...links);
    if (!transform || !links.length) continue;
    const replacements: PhrasingContent[] = [];
    let cursor = 0;
    for (const link of links) {
      const literal = source.slice(link.from, link.to);
      // The AST has decoded escapes/entities. Count the rendered prefix rather
      // than replacing an earlier escaped occurrence of the same literal.
      const prefix = source.slice(child.position!.start.offset!, link.from);
      const at = parser.parse(`${prefix}x`).children.map(textOf).join("\n").length - 1;
      if (at < cursor || child.value.slice(at, at + literal.length) !== literal) continue;
      if (at > cursor) replacements.push({ type: "text", value: child.value.slice(cursor, at) });
      replacements.push({
        type: "link",
        url: `#knowledge-link=${encodeURIComponent(link.target)}`,
        children: [{ type: "text", value: link.label }],
      });
      cursor = at + literal.length;
    }
    replacements.push({ type: "text", value: child.value.slice(cursor) });
    children.splice(index, 1, ...replacements);
    index += replacements.length - 1;
  }
}

export function analyzeMarkdown(source: string): NoteAnalysis {
  const result: NoteAnalysis = { links: [], headings: [] };
  walk(parser.parse(source), source, result, false);
  return result;
}

/** Shared semantics for reading mode and the relationship index. No raw HTML injection. */
export function remarkKnowledgeLinks() {
  return (tree: Root, file: { value: unknown }) => {
    walk(tree, typeof file.value === "string" ? file.value : "", { links: [], headings: [] }, true);
  };
}

export function splitNoteTarget(target: string) {
  const hash = target.indexOf("#");
  return hash < 0
    ? { name: target, heading: "" }
    : { name: target.slice(0, hash), heading: target.slice(hash + 1) };
}

export function resolveNoteLink(
  notes: readonly KnowledgeNote[],
  target: string,
  currentId?: string,
): KnowledgeNote[] {
  const { name } = splitNoteTarget(target);
  if (!name && currentId) return notes.filter((note) => note.id === currentId);
  const exact = notes.find((note) => note.id === name);
  if (exact) return [exact];
  return notes.filter((note) => !!note.title.trim() && linkKey(note.title) === linkKey(name));
}

/** Generated links use stable identity so a title change cannot silently retarget them. */
export function noteWikiLink(note: Pick<KnowledgeNote, "id" | "title">) {
  const label = (note.title || "未命名笔记").replace(/[\]|\r\n[*_~`<>&\\]/gu, " ");
  return `[[${note.id}|${label}]]`;
}

export class KnowledgeLinkIndex {
  private cache = new Map<string, { body: string; analysis: NoteAnalysis }>();
  update(notes: readonly KnowledgeNote[]) {
    const ids = new Set(notes.map((note) => note.id));
    for (const id of this.cache.keys()) if (!ids.has(id)) this.cache.delete(id);
    for (const note of notes) {
      if (this.cache.get(note.id)?.body !== note.body)
        this.cache.set(note.id, { body: note.body, analysis: analyzeMarkdown(note.body) });
    }
  }
  get(id: string): NoteAnalysis {
    return this.cache.get(id)?.analysis ?? { links: [], headings: [] };
  }
  backlinks(notes: readonly KnowledgeNote[], id: string) {
    const byId = new Map(notes.map((note) => [note.id, note]));
    const byTitle = new Map<string, KnowledgeNote[]>();
    for (const note of notes) {
      if (!note.title.trim()) continue;
      const key = linkKey(note.title);
      const group = byTitle.get(key) ?? [];
      group.push(note);
      byTitle.set(key, group);
    }
    return notes.filter(
      (note) =>
        note.id !== id &&
        this.get(note.id).links.some((link) => {
          const { name } = splitNoteTarget(link.target);
          const direct = byId.get(name || note.id);
          const matches = direct ? [direct] : (byTitle.get(linkKey(name)) ?? []);
          return matches.length === 1 && matches[0]!.id === id;
        }),
    );
  }
}
