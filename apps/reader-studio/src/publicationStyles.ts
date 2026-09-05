import { sanitizeInlineStyle } from "./readerMarkup";

/** Apply only safe local declarations to publication nodes, never the application shell. */
export function applyPublicationStyles(document: Document, css: string): void {
  // Deliberately reject imports, URL values and nested at-rules. Publication
  // CSS is untrusted; no network requests or global styles are installed.
  const rules = css.replace(/\/\*[\s\S]*?\*\//gu, "").matchAll(/([^{}]+)\{([^{}]*)\}/gu);
  for (const [, selector, body] of rules) {
    if (!selector || selector.includes("@") || !body) continue;
    const safe = sanitizeInlineStyle(body);
    if (!safe) continue;
    try {
      for (const node of document.querySelectorAll(selector.trim())) {
        node.setAttribute("style", `${safe};${node.getAttribute("style") ?? ""}`);
      }
    } catch {
      /* Unsupported selectors do not prevent opening a publication. */
    }
  }
}

export async function publicationImageSize(
  blob: Blob,
): Promise<{ width: number; height: number } | undefined> {
  const bytes = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  const view = new DataView(bytes.buffer);
  let width = 0;
  let height = 0;
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1] ?? 0;
      const length = view.getUint16(offset + 2);
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        height = view.getUint16(offset + 5);
        width = view.getUint16(offset + 7);
        break;
      }
      if (length < 2) break;
      offset += length + 2;
    }
  } else if (blob.type === "image/svg+xml") {
    const svg = new DOMParser().parseFromString(
      new TextDecoder().decode(bytes),
      "image/svg+xml",
    ).documentElement;
    const box = svg
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/u)
      .map(Number);
    width = Number.parseFloat(svg.getAttribute("width") ?? "") || box?.[2] || 0;
    height = Number.parseFloat(svg.getAttribute("height") ?? "") || box?.[3] || 0;
  }
  return width > 0 && height > 0 && Number.isFinite(width + height) ? { width, height } : undefined;
}
