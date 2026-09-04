import { normalizeSearchQuery } from "@bcr/reader-core";
import type { ReactNode } from "react";

interface TextMatchRange {
  readonly start: number;
  readonly end: number;
}

/** Find a search match while keeping offsets in the original text node. */
function textMatchRange(value: string, query: string): TextMatchRange | undefined {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery || value.length === 0) return undefined;

  const directQuery = query.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
  const directIndex = value.toLocaleLowerCase().indexOf(directQuery);
  if (directQuery.length > 0 && directIndex >= 0) {
    return { start: directIndex, end: directIndex + directQuery.length };
  }

  // Search normalizes whitespace and Unicode compatibility forms. Build a
  // compact index with source offsets so highlighting never changes content.
  let compact = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index) ?? 0;
    const next = index + (codePoint > 0xffff ? 2 : 1);
    const character = value.slice(index, next);
    index = next;
    if (/\s/u.test(character)) continue;
    const normalized = character.normalize("NFKC").toLocaleLowerCase();
    for (let unitIndex = 0; unitIndex < normalized.length; unitIndex += 1) {
      compact += normalized[unitIndex] ?? "";
      starts.push(index - character.length);
      ends.push(index);
    }
  }
  const compactIndex = compact.indexOf(normalizedQuery);
  if (compactIndex < 0) return undefined;
  return {
    start: starts[compactIndex] ?? 0,
    end: ends[compactIndex + normalizedQuery.length - 1] ?? value.length,
  };
}

export function highlightText(value: string, query: string): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  while (cursor < value.length) {
    const match = textMatchRange(value.slice(cursor), query);
    if (match === undefined) {
      nodes.push(value.slice(cursor));
      break;
    }
    const start = cursor + match.start;
    const end = Math.max(start + 1, cursor + match.end);
    if (start > cursor) nodes.push(value.slice(cursor, start));
    nodes.push(
      <mark data-reader-search-match="true" key={`match-${key++}`}>
        {value.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  return nodes.length > 0 ? nodes : value;
}

/** Highlight sanitized HTML without interpolating user input into markup. */
export function highlightHtml(value: string, query: string): string {
  if (!normalizeSearchQuery(query) || typeof DOMParser === "undefined") return value;
  const document = new DOMParser().parseFromString(`<body>${value}</body>`, "text/html");
  const body = document.body;
  if (body === null) return value;
  const walker = document.createTreeWalker(body, 4);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node !== null) {
    const textNode = node as Text;
    if (textNode.parentElement?.closest("mark, script, style") === null) textNodes.push(textNode);
    node = walker.nextNode();
  }
  for (const textNode of textNodes) {
    const parent = textNode.parentNode;
    if (parent === null) continue;
    const source = textNode.data;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let highlighted = false;
    while (cursor < source.length) {
      const match = textMatchRange(source.slice(cursor), query);
      if (match === undefined) {
        fragment.append(document.createTextNode(source.slice(cursor)));
        break;
      }
      const start = cursor + match.start;
      const end = Math.max(start + 1, cursor + match.end);
      if (start > cursor) fragment.append(document.createTextNode(source.slice(cursor, start)));
      const mark = document.createElement("mark");
      mark.setAttribute("data-reader-search-match", "true");
      mark.textContent = source.slice(start, end);
      fragment.append(mark);
      cursor = end;
      highlighted = true;
    }
    if (highlighted) parent.replaceChild(fragment, textNode);
  }
  return body.innerHTML;
}
