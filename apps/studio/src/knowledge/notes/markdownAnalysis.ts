import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { decodeString } from "micromark-util-decode-string";
import type { Root, RootContent, PhrasingContent, Text, Definition } from "mdast";
import type { KnowledgeNote } from "../session/model";
import { notePath, pathKey, relativeNotePath } from "./paths";
import {
  attachmentReferencesFromTree,
  type AttachmentReference,
} from "../attachments/attachmentReferences";

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
  /** Raw display text for safely detaching a reference without changing shared definitions. */
  reference?: { label: string; title: string | null };
}
export interface NoteHeading {
  text: string;
  depth: number;
  from: number;
}
/** Editor actions also need external URLs, which never enter the relationship index. */
export interface EditorLink extends NoteLink {
  url: string;
  internal: boolean;
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

function definitionsIn(tree: Root) {
  const definitions = new Map<string, Definition>();
  function collect(node: Root | RootContent) {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if ("children" in node) for (const child of node.children) collect(child);
  }
  collect(tree);
  return definitions;
}

function walk(
  node: Root | RootContent,
  source: string,
  result: NoteAnalysis,
  transform: boolean,
  definitions: ReadonlyMap<string, Definition>,
  editable?: EditorLink[],
) {
  if (node.type === "heading") {
    const from = node.position?.start.offset ?? 0;
    result.headings.push({ text: textOf(node), depth: node.depth, from });
    if (transform)
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, id: `note-heading-${from}` },
      };
  }
  if (node.type === "linkReference") {
    const definition = definitions.get(node.identifier);
    const target = definition ? internalTarget(definition.url) : null;
    const from = node.position?.start.offset,
      to = node.position?.end.offset;
    const labelEnd =
      node.children.at(-1)?.position?.end.offset ?? (from === undefined ? undefined : from + 1);
    if (definition && from !== undefined && to !== undefined) {
      const link: NoteLink = {
        kind: "markdown",
        target: target ?? definition.url,
        label: textOf(node),
        from,
        to,
        ...(labelEnd === undefined
          ? {}
          : {
              reference: {
                label: source.slice(from + 1, labelEnd),
                title: definition.title ?? null,
              },
            }),
      };
      if (target !== null) result.links.push(link);
      editable?.push({ ...link, url: definition.url, internal: target !== null });
    }
    return;
  }
  if (node.type === "link") {
    const target = internalTarget(node.url);
    if (target !== null || editable) {
      const destination = markdownDestination(node, source);
      const link: NoteLink = {
        kind: "markdown",
        target: target ?? node.url,
        label: textOf(node),
        from: node.position?.start.offset ?? 0,
        to: node.position?.end.offset ?? 0,
        ...(destination ? { destination } : {}),
      };
      if (target !== null) result.links.push(link);
      editable?.push({ ...link, url: node.url, internal: target !== null });
    }
    return;
  }
  if (!("children" in node)) return;
  const children = node.children as RootContent[];
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    if (child.type !== "text") {
      walk(child, source, result, transform, definitions, editable);
      continue;
    }
    const links = wikiLinks(child, source);
    result.links.push(...links);
    editable?.push(...links.map((link) => ({ ...link, url: link.target, internal: true })));
    if (!transform || !links.length) continue;
    const replacements: PhrasingContent[] = [];
    let cursor = 0;
    const raw = source.slice(child.position!.start.offset!, child.position!.end.offset!);
    const direct = decodeString(raw).replace(/\r\n?/gu, "\n") === child.value;
    let rawCursor = 0,
      decodedCursor = 0;
    for (const link of links) {
      const literal = decodeString(source.slice(link.from, link.to));
      // The AST has decoded escapes/entities. Count the rendered prefix rather
      // than replacing an earlier escaped occurrence of the same literal.
      const prefix = source.slice(child.position!.start.offset!, link.from);
      const relative = link.from - child.position!.start.offset!;
      decodedCursor += decodeString(raw.slice(rawCursor, relative)).replace(/\r\n?/gu, "\n").length;
      const at = direct
        ? decodedCursor
        : parser.parse(`x${prefix}x`).children.map(textOf).join("\n").length - 2;
      rawCursor = link.to - child.position!.start.offset!;
      decodedCursor += literal.length;
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
  return markdownFacts(source).analysis;
}

export function analyzeEditorLinks(source: string): EditorLink[] {
  return markdownFacts(source).editorLinks;
}

/** Shared semantics for reading mode and the relationship index. No raw HTML injection. */
export function remarkKnowledgeLinks() {
  return (tree: Root, file: { value: unknown }) => {
    walk(
      tree,
      typeof file.value === "string" ? file.value : "",
      { links: [], headings: [] },
      true,
      definitionsIn(tree),
    );
  };
}

/** Count visible text, excluding attachment references, images and Markdown syntax. */
export function notePlainText(source: string, context?: string): string {
  const input =
    context && context !== source
      ? `${source}\n\n${markdownFacts(context).referenceDefinitions}`
      : source;
  const tree = parser.parse(input);
  remarkKnowledgeLinks()(tree, { value: input });
  const definitions = definitionsIn(tree);
  function text(node: Root | RootContent): string {
    if (
      node.type === "definition" ||
      node.type === "image" ||
      node.type === "imageReference" ||
      node.type === "html"
    )
      return "";
    if (node.type === "link" && node.url.startsWith("attachment:")) return "";
    if (
      node.type === "linkReference" &&
      definitions.get(node.identifier)?.url.startsWith("attachment:")
    )
      return "";
    if (node.type === "break") return "\n";
    if ("value" in node) return node.value;
    if (!("children" in node)) return "";
    const separator =
      node.type === "tableRow"
        ? "\t"
        : node.type === "root" || node.type === "blockquote"
          ? "\n\n"
          : node.type === "list" || node.type === "table"
            ? "\n"
            : "";
    return node.children
      .map((child) => text(child))
      .filter((value) => value !== "")
      .join(separator);
  }
  return text(tree);
}

export function noteCharacterCount(source: string): number {
  return markdownFacts(source).characters;
}

export interface MarkdownFacts {
  analysis: NoteAnalysis;
  editorLinks: EditorLink[];
  attachments: AttachmentReference[];
  characters: number;
  referenceDefinitions: string;
  definitionRanges: { from: number; to: number }[];
}
// Two input snapshots cover the editor and deferred React view without retaining mutable ASTs.
const recentFacts: { source: string; facts: MarkdownFacts }[] = [];
export const emptyMarkdownFacts: MarkdownFacts = {
  analysis: { links: [], headings: [] },
  editorLinks: [],
  attachments: [],
  characters: 0,
  referenceDefinitions: "",
  definitionRanges: [],
};
export function cachedMarkdownFacts(source: string) {
  return recentFacts.find((entry) => entry.source === source)?.facts;
}
/** Worker results share the action/index cache without reparsing on the UI thread. */
export function rememberMarkdownFacts(source: string, facts: MarkdownFacts) {
  const index = recentFacts.findIndex((entry) => entry.source === source);
  if (index >= 0) recentFacts.splice(index, 1);
  recentFacts.unshift({ source, facts });
  if (recentFacts.length > 2) recentFacts.pop();
  return facts;
}
export function markdownFacts(source: string): MarkdownFacts {
  const cached = cachedMarkdownFacts(source);
  if (cached) return cached;
  const tree = parser.parse(source),
    definitions = definitionsIn(tree);
  const analysis: NoteAnalysis = { links: [], headings: [] },
    editorLinks: EditorLink[] = [];
  walk(tree, source, analysis, false, definitions, editorLinks);
  const count = (value: string) => Array.from(value.replace(/\s/gu, "")).length;
  function content(node: Root | RootContent, allowWiki = true): number {
    if (
      node.type === "definition" ||
      node.type === "image" ||
      node.type === "imageReference" ||
      node.type === "html"
    )
      return 0;
    if (node.type === "link" && node.url.startsWith("attachment:")) return 0;
    if (
      node.type === "linkReference" &&
      definitions.get(node.identifier)?.url.startsWith("attachment:")
    )
      return 0;
    if (node.type === "text")
      return (
        count(node.value) +
        (allowWiki
          ? wikiLinks(node, source).reduce(
              (delta, link) =>
                delta + count(link.label) - count(decodeString(source.slice(link.from, link.to))),
              0,
            )
          : 0)
      );
    if ("value" in node) return count(node.value);
    return "children" in node
      ? node.children.reduce(
          (sum, child) =>
            sum +
            content(child, allowWiki && node.type !== "link" && node.type !== "linkReference"),
          0,
        )
      : 0;
  }
  const facts: MarkdownFacts = {
    analysis,
    editorLinks,
    attachments: attachmentReferencesFromTree(tree, definitions),
    characters: content(tree),
    referenceDefinitions: [...definitions.values()]
      .map((node) => source.slice(node.position!.start.offset!, node.position!.end.offset!))
      .join("\n\n"),
    definitionRanges: [...definitions.values()].map((node) => ({
      from: node.position!.start.offset!,
      to: node.position!.end.offset!,
    })),
  };
  return rememberMarkdownFacts(source, facts);
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
  return createNoteResolver(notes)(target, currentId);
}

export function createNoteResolver(notes: readonly KnowledgeNote[]) {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const byPath = new Map<string, KnowledgeNote[]>(),
    byTitle = new Map<string, KnowledgeNote[]>();
  for (const note of notes) {
    // Legacy IDs remain case-sensitive; do not turn a title into an implicit path match.
    if (note.path !== undefined) {
      const path = pathKey(note.path);
      byPath.set(path, [...(byPath.get(path) ?? []), note]);
    }
    if (note.title.trim()) {
      const key = linkKey(note.title);
      byTitle.set(key, [...(byTitle.get(key) ?? []), note]);
    }
  }
  return (target: string, currentId?: string): KnowledgeNote[] => {
    const { name } = splitNoteTarget(target);
    const source = currentId ? byId.get(currentId) : undefined;
    if (!name) return source ? [source] : [];
    const direct = byId.get(name.replace(/\.md$/iu, ""));
    if (direct) return [direct];
    const relative = relativeNotePath(name, source ? notePath(source) : "root.md");
    const local = relative ? byPath.get(pathKey(relative)) : undefined;
    if (local) return local;
    if (relative && !relative.includes("/")) {
      const legacy = byId.get(relative.slice(0, -3));
      if (legacy?.path === undefined && legacy) return [legacy];
    }
    if (name.startsWith("./") || name.startsWith("../")) return [];
    const root = relativeNotePath(name, "root.md");
    const absolute = root ? byPath.get(pathKey(root)) : undefined;
    if (absolute) return absolute;
    if (name.includes("/") || name.includes("\\")) return [];
    return byTitle.get(linkKey(name)) ?? byTitle.get(linkKey(name.replace(/\.md$/iu, ""))) ?? [];
  };
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
    const resolve = createNoteResolver(notes);
    return notes.filter(
      (note) =>
        note.id !== id &&
        this.get(note.id).links.some((link) => {
          const matches = resolve(link.target, note.id);
          return matches.length === 1 && matches[0]!.id === id;
        }),
    );
  }
}
