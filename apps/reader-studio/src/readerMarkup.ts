import type { ReaderFormat, ReaderSection } from "@bcr/reader-core";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export function safeUrl(value: string): string {
  const trimmed = value.trim();
  if (/^(?:https?:|mailto:|#|\/|\.\/|\.\.\/|data:image\/)/iu.test(trimmed)) return trimmed;
  // EPUB commonly uses bare publication-relative references such as
  // `chapter-2.xhtml#note`. Keep scheme-less paths while continuing to reject
  // executable or unknown protocols before the markup reaches the document.
  const hasControlCharacter = [...trimmed].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (!/^[a-z][a-z\d+.-]*:/iu.test(trimmed) && !hasControlCharacter) {
    return trimmed;
  }
  return "#";
}

const SAFE_INLINE_STYLE_PROPERTIES = new Set([
  "background-color",
  "border",
  "border-bottom",
  "border-left",
  "border-radius",
  "border-right",
  "border-top",
  "color",
  "direction",
  "display",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "height",
  "letter-spacing",
  "line-height",
  "list-style",
  "list-style-type",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "text-decoration",
  "text-indent",
  "text-transform",
  "vertical-align",
  "white-space",
  "width",
  "word-spacing",
  "writing-mode",
]);

/** Keep common publication typography while rejecting executable/escaping CSS. */
export function sanitizeInlineStyle(value: string): string | undefined {
  const declarations = value.split(";").flatMap((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator <= 0) return [];
    const property = declaration.slice(0, separator).trim().toLocaleLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    if (
      !SAFE_INLINE_STYLE_PROPERTIES.has(property) ||
      propertyValue.length === 0 ||
      /[{}<>]|(?:url|expression|javascript|vbscript|@import)/iu.test(propertyValue)
    ) {
      return [];
    }
    const cleanedValue = propertyValue.replace(/\s*!important\s*$/iu, "").trim();
    return cleanedValue.length > 0 ? [`${property}: ${cleanedValue}`] : [];
  });
  return declarations.length > 0 ? declarations.join("; ") : undefined;
}

function inlineMarkdown(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/gu, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/gu, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/gu, "<em>$1</em>");
  html = html.replace(/_([^_]+)_/gu, "<em>$1</em>");
  html = html.replace(/!?\[([^\]]+)\]\(([^)]+)\)/gu, (_match, label: string, url: string) => {
    const href = safeUrl(url);
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  return html;
}

export function markdownToHtml(markdown: string): { html: string; title?: string } {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let inCode = false;
  let code: string[] = [];
  let title: string | undefined;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    html.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushCode = () => {
    if (code.length === 0) return;
    html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
  };

  for (const line of lines) {
    if (/^\s*```/u.test(line)) {
      flushParagraph();
      flushList();
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 1;
      const value = heading[2] ?? "";
      if (title === undefined && level <= 2) title = value;
      html.push(`<h${level}>${inlineMarkdown(value)}</h${level}>`);
      continue;
    }
    const listItem = /^\s*[-*+]\s+(.+)$/u.exec(line);
    if (listItem !== null) {
      flushParagraph();
      list.push(listItem[1] ?? "");
      continue;
    }
    if (/^\s*>\s?/u.test(line)) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${inlineMarkdown(line.replace(/^\s*>\s?/u, ""))}</blockquote>`);
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  if (inCode) flushCode();
  return { html: html.join("\n"), ...(title === undefined ? {} : { title }) };
}

export function textSections(text: string, format: ReaderFormat): ReadonlyArray<ReaderSection> {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  const blocks = normalized
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const sourceBlocks = blocks.length > 0 ? blocks : [normalized || "暂无内容"];
  return sourceBlocks.map((block, order) => ({
    id: `section-${order + 1}`,
    order,
    label: format === "txt" ? `段落 ${order + 1}` : `Section ${order + 1}`,
    kind: "text" as const,
    text: block,
    ...(format === "txt" ? { html: `<p>${escapeHtml(block).replace(/\n/gu, "<br />")}</p>` } : {}),
  }));
}

export function sanitizeHtml(rawHtml: string): { html: string; text: string; title?: string } {
  const parser = new DOMParser();
  const document = parser.parseFromString(rawHtml, "text/html");
  for (const element of document.querySelectorAll(
    "script, style, iframe, object, embed, form, link",
  )) {
    element.remove();
  }
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      const name = attribute.name.toLocaleLowerCase();
      const value = attribute.value;
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
      } else if (name === "style") {
        const safe = sanitizeInlineStyle(value);
        if (safe === undefined) element.removeAttribute(attribute.name);
        else element.setAttribute(attribute.name, safe);
      } else if (name === "href" || name === "src" || name === "poster") {
        element.setAttribute(attribute.name, safeUrl(value));
      }
    }
  }
  const heading = document.querySelector("h1, h2, title")?.textContent?.trim();
  return {
    html: document.body?.innerHTML ?? "",
    text: document.body?.textContent?.replace(/\s+/gu, " ").trim() ?? "",
    ...(heading ? { title: heading } : {}),
  };
}
